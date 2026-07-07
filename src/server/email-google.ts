import { decryptSecret, encryptSecret } from "./email-crypto.js";
import { getMetaValue, setMetaValue } from "./email-meta.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleEmailEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
  SESSION_SECRET?: string;
  ADMIN_PASSWORD?: string;
};

export function isGoogleOAuthConfigured(env: GoogleEmailEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function apiBaseUrl(env: GoogleEmailEnv, requestUrl?: string): string {
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }
  if (env.APP_URL?.trim()) return env.APP_URL.replace(/\/$/, "");
  return "http://localhost:8787";
}

export async function getGmailAddress(env: GoogleEmailEnv): Promise<string> {
  return (await getMetaValue("gmail_address")).trim();
}

export async function isGmailConnected(env: GoogleEmailEnv): Promise<boolean> {
  const token = await getMetaValue("gmail_refresh_token_enc");
  return Boolean(token.trim());
}

export function buildGoogleAuthUrl(env: GoogleEmailEnv, requestUrl: string, state: string): string | null {
  if (!isGoogleOAuthConfigured(env)) return null;
  const redirectUri = `${apiBaseUrl(env, requestUrl)}/api/settings/email/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${GMAIL_SCOPE} https://www.googleapis.com/auth/userinfo.email openid`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function newGoogleOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  env: GoogleEmailEnv,
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
  env: GoogleEmailEnv,
): Promise<{ access_token: string; error?: string }> {
  const encrypted = await getMetaValue("gmail_refresh_token_enc");
  if (!encrypted.trim()) return { access_token: "", error: "Gmail not connected" };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(encrypted, env);
  } catch {
    return { access_token: "", error: "Could not decrypt Gmail credentials — reconnect Gmail" };
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

async function resolveGmailAddress(
  accessToken: string,
  idToken?: string,
): Promise<string> {
  if (idToken) {
    const fromJwt = emailFromIdToken(idToken);
    if (fromJwt) return fromJwt;
  }

  const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json() as { emailAddress?: string; error?: { message?: string } };
  if (profile.emailAddress?.trim()) return profile.emailAddress.trim();
  if (!profileRes.ok) {
    console.error("[gmail] profile lookup failed:", profile.error?.message || profileRes.status);
  }

  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as { email?: string; error?: { message?: string } };
  if (data.email?.trim()) return data.email.trim();
  if (!res.ok) {
    console.error("[gmail] userinfo lookup failed:", data.error?.message || res.status);
  }

  return "";
}

export async function connectGmail(
  env: GoogleEmailEnv,
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
    const existing = await getMetaValue("gmail_refresh_token_enc");
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

  const address = await resolveGmailAddress(tokens.access_token, tokens.id_token);
  if (!address) {
    return {
      error: "Could not read your Gmail address. In Google Cloud Console, add the userinfo.email scope on the OAuth consent screen, enable the Gmail API, then revoke app access at myaccount.google.com/permissions and connect again.",
    };
  }

  await setMetaValue("gmail_refresh_token_enc", await encryptSecret(refreshToken, env));
  await setMetaValue("gmail_address", address);
  return { address };
}

export async function disconnectGmail(): Promise<void> {
  await setMetaValue("gmail_refresh_token_enc", "");
  await setMetaValue("gmail_address", "");
}

function buildRfc822Message(
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string,
  replyTo?: string,
): string {
  const boundary = `bba_${crypto.randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (replyTo?.trim()) headers.push(`Reply-To: ${replyTo.trim()}`);

  const lines = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const encoded = btoa(unescape(encodeURIComponent(subject)));
  return `=?UTF-8?B?${encoded}?=`;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendViaGmail(
  env: GoogleEmailEnv,
  to: string,
  fromName: string,
  replyTo: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ providerId?: string; error?: string }> {
  if (!isGoogleOAuthConfigured(env)) {
    return { error: "Google OAuth is not configured" };
  }
  if (!(await isGmailConnected(env))) {
    return { error: "Gmail not connected" };
  }

  const fromAddress = await getGmailAddress(env);
  if (!fromAddress) {
    return { error: "Gmail address missing — reconnect Gmail" };
  }

  const { access_token, error } = await refreshAccessToken(env);
  if (error || !access_token) {
    return { error: error || "Could not refresh Gmail access" };
  }

  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  const raw = buildRfc822Message(from, to, subject, text, html, replyTo);

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  });

  const data = await res.json() as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    return { error: data.error?.message || `Gmail API error ${res.status}` };
  }
  return { providerId: data.id };
}
