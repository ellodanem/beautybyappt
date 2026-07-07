import { getConfiguredFromAddress as getResendFromAddress } from "./email-domain.js";
import { getGmailAddress, isGmailConnected, isGoogleOAuthConfigured, sendViaGmail } from "./email-google.js";
import { getMetaValue } from "./email-meta.js";
import { getSmtpSettings, sendViaSmtp } from "./email-smtp.js";

export type EmailProvider = "google" | "resend" | "smtp";

export type EmailEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
  SESSION_SECRET?: string;
  ADMIN_PASSWORD?: string;
};

export async function getEmailProvider(): Promise<EmailProvider> {
  const raw = (await getMetaValue("email_provider")).trim();
  if (raw === "google" || raw === "resend" || raw === "smtp") return raw;
  return "google";
}

export async function isEmailConfigured(env: EmailEnv): Promise<boolean> {
  const provider = await getEmailProvider();
  if (provider === "google") {
    return isGoogleOAuthConfigured(env) && (await isGmailConnected(env));
  }
  if (provider === "smtp") {
    return (await getSmtpSettings(env)).configured;
  }
  return Boolean(env.RESEND_API_KEY?.trim());
}

export async function getConfiguredFromAddress(env: EmailEnv): Promise<string> {
  const provider = await getEmailProvider();
  if (provider === "google") {
    return (await getGmailAddress(env)) || "gmail@connected";
  }
  if (provider === "smtp") {
    return (await getSmtpSettings(env)).from_address || "smtp@configured";
  }
  return getResendFromAddress(env);
}

export async function sendProviderEmail(
  env: EmailEnv,
  to: string,
  fromName: string,
  replyTo: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ providerId?: string; skipped?: boolean; error?: string }> {
  const configured = await isEmailConfigured(env);
  if (!configured) {
    console.log("[notifications] Email (dev — provider not configured):\n", text);
    return { skipped: true };
  }

  const provider = await getEmailProvider();

  if (provider === "google") {
    return sendViaGmail(env, to, fromName, replyTo, subject, text, html);
  }

  if (provider === "smtp") {
    return sendViaSmtp(env, to, fromName, replyTo, subject, text, html);
  }

  const fromAddress = await getResendFromAddress(env);
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text,
    html,
  };
  if (replyTo.trim()) body.reply_to = replyTo.trim();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) {
    return { error: data.message || `Resend error ${res.status}` };
  }
  return { providerId: data.id };
}

export function emailNotConfiguredReason(provider: EmailProvider): string {
  if (provider === "google") return "Gmail not connected";
  if (provider === "smtp") return "SMTP not configured";
  return "RESEND_API_KEY not set";
}

export async function getEmailProviderStatus(env: EmailEnv): Promise<{
  provider: EmailProvider;
  configured: boolean;
  google_oauth_available: boolean;
  gmail_connected: boolean;
  gmail_address: string;
  resend_available: boolean;
  smtp: Awaited<ReturnType<typeof getSmtpSettings>>;
}> {
  const provider = await getEmailProvider();
  return {
    provider,
    configured: await isEmailConfigured(env),
    google_oauth_available: isGoogleOAuthConfigured(env),
    gmail_connected: await isGmailConnected(env),
    gmail_address: await getGmailAddress(env),
    resend_available: Boolean(env.RESEND_API_KEY?.trim()),
    smtp: await getSmtpSettings(env),
  };
}
