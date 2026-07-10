import { decryptSecret, encryptSecret } from "./email-crypto.js";
import { getMetaValue, setMetaValue } from "./email-meta.js";
import {
  apiBaseUrl,
  isGoogleOAuthConfigured,
  newGoogleOAuthState,
  type GoogleEmailEnv,
} from "./email-google.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarEnv = GoogleEmailEnv;

export type GoogleCalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
};

export { isGoogleOAuthConfigured, apiBaseUrl, newGoogleOAuthState };

export async function getGoogleCalendarAddress(): Promise<string> {
  return (await getMetaValue("gcal_address")).trim();
}

export async function getGoogleCalendarId(): Promise<string> {
  const id = (await getMetaValue("gcal_calendar_id")).trim();
  return id || "primary";
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  const token = await getMetaValue("gcal_refresh_token_enc");
  return Boolean(token.trim());
}

export async function getGoogleCalendarStatus(env: GoogleCalendarEnv): Promise<{
  google_oauth_available: boolean;
  connected: boolean;
  address: string;
  calendar_id: string;
}> {
  return {
    google_oauth_available: isGoogleOAuthConfigured(env),
    connected: await isGoogleCalendarConnected(),
    address: await getGoogleCalendarAddress(),
    calendar_id: await getGoogleCalendarId(),
  };
}

export function buildGoogleCalendarAuthUrl(
  env: GoogleCalendarEnv,
  requestUrl: string,
  state: string,
): string | null {
  if (!isGoogleOAuthConfigured(env)) return null;
  const redirectUri = `${apiBaseUrl(env, requestUrl)}/api/settings/calendar/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email openid`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (payload.length % 4 !== 0) payload += "=";
  try {
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function emailFromIdToken(idToken: string): string {
  const payload = decodeJwtPayload(idToken);
  const email = payload.email;
  return typeof email === "string" ? email.trim() : "";
}

async function exchangeCode(
  env: GoogleCalendarEnv,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token?: string; id_token?: string; error?: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    return { access_token: "", error: data.error_description || data.error || `Google token error ${res.status}` };
  }
  return {
    access_token: data.access_token || "",
    refresh_token: data.refresh_token,
    id_token: data.id_token,
  };
}

async function refreshAccessToken(
  env: GoogleCalendarEnv,
): Promise<{ access_token: string; error?: string }> {
  const encrypted = await getMetaValue("gcal_refresh_token_enc");
  if (!encrypted.trim()) return { access_token: "", error: "Google Calendar not connected" };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(encrypted, env);
  } catch {
    return { access_token: "", error: "Could not decrypt Google Calendar credentials — reconnect" };
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok) {
    return { access_token: "", error: data.error_description || data.error || `Google refresh error ${res.status}` };
  }
  return { access_token: data.access_token || "" };
}

async function resolveGoogleAddress(accessToken: string, idToken?: string): Promise<string> {
  if (idToken) {
    const fromJwt = emailFromIdToken(idToken);
    if (fromJwt) return fromJwt;
  }

  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as { email?: string; error?: { message?: string } };
  if (data.email?.trim()) return data.email.trim();
  if (!res.ok) {
    console.error("[gcal] userinfo lookup failed:", data.error?.message || res.status);
  }
  return "";
}

export async function connectGoogleCalendar(
  env: GoogleCalendarEnv,
  code: string,
  redirectUri: string,
): Promise<{ error?: string; address?: string }> {
  if (!isGoogleOAuthConfigured(env)) {
    return { error: "Google OAuth is not configured on this server" };
  }

  const tokens = await exchangeCode(env, code, redirectUri);
  if (tokens.error || !tokens.access_token) {
    return { error: tokens.error || "Failed to get Google access token" };
  }

  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const existing = await getMetaValue("gcal_refresh_token_enc");
    if (existing.trim()) {
      try {
        refreshToken = await decryptSecret(existing, env);
      } catch {
        refreshToken = undefined;
      }
    }
  }
  if (!refreshToken) {
    return { error: "Google did not return a refresh token — revoke app access in your Google account and try again" };
  }

  const address = await resolveGoogleAddress(tokens.access_token, tokens.id_token);
  if (!address) {
    return {
      error: "Could not read your Google account email. Enable the Calendar API and userinfo.email scope, then reconnect.",
    };
  }

  await setMetaValue("gcal_refresh_token_enc", await encryptSecret(refreshToken, env));
  await setMetaValue("gcal_address", address);
  const calendarId = (await getMetaValue("gcal_calendar_id")).trim();
  if (!calendarId) await setMetaValue("gcal_calendar_id", "primary");
  return { address };
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await setMetaValue("gcal_refresh_token_enc", "");
  await setMetaValue("gcal_address", "");
}

function toEventBody(input: GoogleCalendarEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description || "",
    location: input.location || "",
    start: { dateTime: input.startDateTime, timeZone: input.timeZone },
    end: { dateTime: input.endDateTime, timeZone: input.timeZone },
  };
}

export async function upsertGoogleCalendarEvent(
  env: GoogleCalendarEnv,
  input: GoogleCalendarEventInput,
  existingEventId?: string | null,
): Promise<{ eventId?: string; error?: string }> {
  if (!isGoogleOAuthConfigured(env)) return { error: "Google OAuth is not configured" };
  if (!(await isGoogleCalendarConnected())) return { error: "Google Calendar not connected" };

  const { access_token, error } = await refreshAccessToken(env);
  if (error || !access_token) return { error: error || "Could not refresh Google Calendar access" };

  const calendarId = encodeURIComponent(await getGoogleCalendarId());
  const body = JSON.stringify(toEventBody(input));
  const eventId = existingEventId?.trim();

  if (eventId) {
    const res = await fetch(`${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body,
    });
    const data = await res.json() as { id?: string; error?: { message?: string; code?: number } };
    if (res.ok && data.id) return { eventId: data.id };
    // Event missing on Google — create a fresh one
    if (res.status !== 404 && data.error?.code !== 404) {
      return { error: data.error?.message || `Google Calendar update error ${res.status}` };
    }
  }

  const createRes = await fetch(`${CALENDAR_API}/calendars/${calendarId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const created = await createRes.json() as { id?: string; error?: { message?: string } };
  if (!createRes.ok || !created.id) {
    return { error: created.error?.message || `Google Calendar create error ${createRes.status}` };
  }
  return { eventId: created.id };
}

export async function deleteGoogleCalendarEvent(
  env: GoogleCalendarEnv,
  eventId: string | null | undefined,
): Promise<{ error?: string }> {
  const id = eventId?.trim();
  if (!id) return {};
  if (!isGoogleOAuthConfigured(env)) return { error: "Google OAuth is not configured" };
  if (!(await isGoogleCalendarConnected())) return { error: "Google Calendar not connected" };

  const { access_token, error } = await refreshAccessToken(env);
  if (error || !access_token) return { error: error || "Could not refresh Google Calendar access" };

  const calendarId = encodeURIComponent(await getGoogleCalendarId());
  const res = await fetch(`${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (res.ok || res.status === 404 || res.status === 410) return {};
  const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
  return { error: data.error?.message || `Google Calendar delete error ${res.status}` };
}
