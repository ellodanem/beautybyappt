import { get } from "./db.js";
import {
  buildPlatformFooterConfig,
  parseSubscriptionPlan,
  type PlatformFooterConfig,
  type SubscriptionPlan,
} from "../shared/platform-branding.js";

export async function getSubscriptionPlan(): Promise<SubscriptionPlan> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'subscription_plan'");
  return parseSubscriptionPlan(row?.value);
}

export async function getPublicPlatformBranding(): Promise<PlatformFooterConfig> {
  return buildPlatformFooterConfig(await getSubscriptionPlan());
}
