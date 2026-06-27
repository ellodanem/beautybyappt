import { PLATFORM_NAME } from "./branding";

/** Placeholder until marketing site URL is finalized. */
export const PLATFORM_MARKETING_URL = "#";

/** Placeholder until signup landing page URL is finalized. */
export const PLATFORM_SIGNUP_URL = "#";

export type SubscriptionPlan = "free" | "pro" | "premium";

export interface PlatformFooterConfig {
  plan: SubscriptionPlan;
  show_footer: boolean;
  show_signup_promo: boolean;
  platform_name: string;
  platform_url: string;
  signup_url: string;
}

export interface PublicBrandingResponse {
  business_name: string;
  business_tagline: string;
  logo_url: string;
  platform: PlatformFooterConfig;
  timezone?: string;
}

export function parseSubscriptionPlan(value: string | undefined | null): SubscriptionPlan {
  if (value === "pro" || value === "premium") return value;
  return "free";
}

/** Free plan shows footer + signup promo; paid plans hide platform branding. */
export function buildPlatformFooterConfig(plan: SubscriptionPlan): PlatformFooterConfig {
  const isFree = plan === "free";
  return {
    plan,
    show_footer: isFree,
    show_signup_promo: isFree,
    platform_name: PLATFORM_NAME,
    platform_url: PLATFORM_MARKETING_URL,
    signup_url: PLATFORM_SIGNUP_URL,
  };
}

export function defaultPlatformFooterConfig(plan: SubscriptionPlan = "free"): PlatformFooterConfig {
  return buildPlatformFooterConfig(plan);
}
