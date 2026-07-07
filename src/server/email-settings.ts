import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { runtimeEnv } from "./runtime-env.js";
import { setMetaValue, getMetaValue } from "./email-meta.js";
import {
  apiBaseUrl,
  buildGoogleAuthUrl,
  connectGmail,
  disconnectGmail,
  isGoogleOAuthConfigured,
  newGoogleOAuthState,
  type GoogleEmailEnv,
} from "./email-google.js";
import {
  clearSmtpSettings,
  getSmtpSettings,
  saveSmtpSettings,
  type SmtpEmailEnv,
} from "./email-smtp.js";
import {
  getEmailProvider,
  getEmailProviderStatus,
  sendProviderEmail,
  type EmailEnv,
} from "./email-providers.js";
import { getGmailAddress } from "./email-google.js";
import { getBranding } from "./branding.js";

const ProviderSchema = z.enum(["google", "resend", "smtp"]);

const EmailProviderStatusSchema = z.object({
  provider: ProviderSchema,
  configured: z.boolean(),
  google_oauth_available: z.boolean(),
  gmail_connected: z.boolean(),
  gmail_address: z.string(),
  resend_available: z.boolean(),
  smtp: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    username: z.string(),
    from_address: z.string(),
    configured: z.boolean(),
    has_password: z.boolean(),
  }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEmailProviderRoutes(app: OpenAPIHono<any>) {
  const ErrorSchema = z.object({ error: z.string() });

  app.openapi(createRoute({
    method: "get",
    path: "/api/settings/email",
    responses: {
      200: {
        description: "Email provider status",
        content: { "application/json": { schema: EmailProviderStatusSchema } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as EmailEnv;
    return c.json(await getEmailProviderStatus(env), 200);
  });

  app.openapi(createRoute({
    method: "put",
    path: "/api/settings/email/provider",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ provider: ProviderSchema }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Provider updated",
        content: { "application/json": { schema: EmailProviderStatusSchema } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const { provider } = c.req.valid("json");
    const env = runtimeEnv(c.env) as EmailEnv;

    if (provider === "google") {
      if (!isGoogleOAuthConfigured(env)) {
        return c.json({ error: "Google sign-in is not available on this server yet" }, 400);
      }
    } else if (provider === "resend") {
      if (!env.RESEND_API_KEY?.trim()) {
        return c.json({ error: "Resend is not configured on this server" }, 400);
      }
    } else if (provider === "smtp") {
      const smtp = await getSmtpSettings(env);
      if (!smtp.configured) {
        return c.json({ error: "Save your SMTP settings before switching to SMTP" }, 400);
      }
    }

    await setMetaValue("email_provider", provider);
    return c.json(await getEmailProviderStatus(env), 200);
  });

  app.get("/api/settings/email/google/auth", async (c) => {
    const env = runtimeEnv(c.env) as GoogleEmailEnv;
    const state = newGoogleOAuthState();
    await setMetaValue("google_oauth_state", state);
    const url = buildGoogleAuthUrl(env, c.req.url, state);
    if (!url) {
      return c.redirect("/settings?email_error=google_not_configured");
    }
    return c.redirect(url);
  });

  app.get("/api/settings/email/google/callback", async (c) => {
    const env = runtimeEnv(c.env) as GoogleEmailEnv;
    const code = c.req.query("code");
    const error = c.req.query("error");
    const state = c.req.query("state") || "";
    const savedState = (await getMetaValue("google_oauth_state")).trim();
    await setMetaValue("google_oauth_state", "");
    const redirectUri = `${apiBaseUrl(env, c.req.url)}/api/settings/email/google/callback`;

    if (error || !code) {
      return c.redirect(`/settings?email_error=${encodeURIComponent(error || "google_denied")}`);
    }
    if (!savedState || savedState !== state) {
      return c.redirect("/settings?email_error=invalid_oauth_state");
    }

    const result = await connectGmail(env, code, redirectUri);
    if (result.error) {
      return c.redirect(`/settings?email_error=${encodeURIComponent(result.error)}`);
    }

    await setMetaValue("email_provider", "google");
    return c.redirect("/settings?email_connected=google");
  });

  app.openapi(createRoute({
    method: "delete",
    path: "/api/settings/email/google",
    responses: {
      200: {
        description: "Gmail disconnected",
        content: { "application/json": { schema: EmailProviderStatusSchema } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as EmailEnv;
    await disconnectGmail();
    if ((await getEmailProvider()) === "google") {
      await setMetaValue("email_provider", "google");
    }
    return c.json(await getEmailProviderStatus(env), 200);
  });

  app.openapi(createRoute({
    method: "get",
    path: "/api/settings/email/smtp",
    responses: {
      200: {
        description: "SMTP settings (no password)",
        content: { "application/json": { schema: EmailProviderStatusSchema.shape.smtp } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as SmtpEmailEnv;
    return c.json(await getSmtpSettings(env), 200);
  });

  app.openapi(createRoute({
    method: "put",
    path: "/api/settings/email/smtp",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              host: z.string(),
              port: z.number().int().min(1).max(65535),
              secure: z.boolean(),
              username: z.string(),
              password: z.string().optional(),
              from_address: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "SMTP saved",
        content: { "application/json": { schema: EmailProviderStatusSchema.shape.smtp } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as SmtpEmailEnv;
    const result = await saveSmtpSettings(env, c.req.valid("json"));
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result.settings!, 200);
  });

  app.openapi(createRoute({
    method: "delete",
    path: "/api/settings/email/smtp",
    responses: {
      200: {
        description: "SMTP cleared",
        content: { "application/json": { schema: EmailProviderStatusSchema.shape.smtp } },
      },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as SmtpEmailEnv;
    await clearSmtpSettings();
    if ((await getEmailProvider()) === "smtp") {
      await setMetaValue("email_provider", "google");
    }
    return c.json(await getSmtpSettings(env), 200);
  });

  app.openapi(createRoute({
    method: "post",
    path: "/api/settings/email/test",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ to: z.string().email().optional() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Test email sent",
        content: { "application/json": { schema: z.object({ ok: z.boolean(), provider: ProviderSchema }) } },
      },
      400: { description: "Failed", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const env = runtimeEnv(c.env) as EmailEnv;
    const provider = await getEmailProvider();
    const branding = await getBranding();
    const businessName = branding.business_name.trim() || "Your business";
    const body = c.req.valid("json");
    let to = body.to?.trim() || "";
    if (!to) {
      if (provider === "google") to = await getGmailAddress(env);
      else if (provider === "smtp") to = (await getSmtpSettings(env)).from_address;
    }

    if (!to) {
      return c.json({ error: "Enter a test email address or configure a from address first" }, 400);
    }

    const subject = `Test email from ${businessName}`;
    const text = `This is a test email from ${businessName}. If you received this, your email setup is working.`;
    const html = `<p>This is a test email from <strong>${businessName}</strong>.</p><p>If you received this, your email setup is working.</p>`;

    const result = await sendProviderEmail(env, to, businessName, "", subject, text, html);
    if (result.skipped) {
      return c.json({ error: "Email provider is not configured yet" }, 400);
    }
    if (result.error) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true, provider }, 200);
  });
}
