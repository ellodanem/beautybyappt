import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { runtimeEnv } from "./runtime-env.js";
import { setMetaValue, getMetaValue } from "./email-meta.js";
import {
  apiBaseUrl,
  buildGoogleCalendarAuthUrl,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  isGoogleOAuthConfigured,
  newGoogleOAuthState,
  type GoogleCalendarEnv,
} from "./calendar-google.js";

const CalendarStatusSchema = z.object({
  google_oauth_available: z.boolean(),
  connected: z.boolean(),
  address: z.string(),
  calendar_id: z.string(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerGoogleCalendarRoutes(app: OpenAPIHono<any>) {
  const ErrorSchema = z.object({ error: z.string() });

  app.openapi(createRoute({
    method: "get",
    path: "/api/settings/calendar",
    responses: {
      200: {
        description: "Google Calendar connection status",
        content: { "application/json": { schema: CalendarStatusSchema } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as GoogleCalendarEnv;
    return c.json(await getGoogleCalendarStatus(env), 200);
  });

  app.get("/api/settings/calendar/google/auth", async (c) => {
    const env = runtimeEnv(c.env) as GoogleCalendarEnv;
    if (!isGoogleOAuthConfigured(env)) {
      return c.redirect("/settings?calendar_error=google_not_configured");
    }
    const state = newGoogleOAuthState();
    await setMetaValue("gcal_oauth_state", state);
    const url = buildGoogleCalendarAuthUrl(env, c.req.url, state);
    if (!url) {
      return c.redirect("/settings?calendar_error=google_not_configured");
    }
    return c.redirect(url);
  });

  app.get("/api/settings/calendar/google/callback", async (c) => {
    const env = runtimeEnv(c.env) as GoogleCalendarEnv;
    const code = c.req.query("code");
    const error = c.req.query("error");
    const state = c.req.query("state") || "";
    const savedState = (await getMetaValue("gcal_oauth_state")).trim();
    await setMetaValue("gcal_oauth_state", "");
    const redirectUri = `${apiBaseUrl(env, c.req.url)}/api/settings/calendar/google/callback`;

    if (error || !code) {
      return c.redirect(`/settings?calendar_error=${encodeURIComponent(error || "google_denied")}`);
    }
    if (!savedState || savedState !== state) {
      return c.redirect("/settings?calendar_error=invalid_oauth_state");
    }

    const result = await connectGoogleCalendar(env, code, redirectUri);
    if (result.error) {
      return c.redirect(`/settings?calendar_error=${encodeURIComponent(result.error)}`);
    }

    return c.redirect("/settings?calendar_connected=1");
  });

  app.openapi(createRoute({
    method: "delete",
    path: "/api/settings/calendar/google",
    responses: {
      200: {
        description: "Google Calendar disconnected",
        content: { "application/json": { schema: CalendarStatusSchema } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as GoogleCalendarEnv;
    await disconnectGoogleCalendar();
    return c.json(await getGoogleCalendarStatus(env), 200);
  });

  app.openapi(createRoute({
    method: "post",
    path: "/api/appointments/{id}/sync-google",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: "Manual re-sync queued",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
      400: { description: "Not connected", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as GoogleCalendarEnv;
    const status = await getGoogleCalendarStatus(env);
    if (!status.connected) {
      return c.json({ error: "Google Calendar is not connected" }, 400);
    }
    const id = Number(c.req.valid("param").id);
    if (!Number.isFinite(id)) return c.json({ error: "Not found" }, 404);

    const { syncAppointmentToGoogle } = await import("./calendar-sync.js");
    await syncAppointmentToGoogle(env, id);
    return c.json({ ok: true }, 200);
  });
}
