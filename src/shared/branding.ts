/** Product/platform name when no custom business branding is set. */
export const PLATFORM_NAME = "Beauty By Appointment";

export const PLATFORM_TAGLINE = "Beauty, by appointment.";

export const DEFAULT_BUSINESS_NAME = PLATFORM_NAME;

export const MAX_BUSINESS_NAME = 100;
export const MAX_BUSINESS_TAGLINE = 200;
export const MAX_LOGO_DATA_URL_BYTES = 512 * 1024;
export const MAX_LOGO_URL_LENGTH = 2000;

export interface Branding {
  business_name: string;
  business_tagline: string;
  logo_url: string;
}

export function businessDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || DEFAULT_BUSINESS_NAME;
}

export function businessInitials(name: string): string {
  const display = businessDisplayName(name);
  if (display === DEFAULT_BUSINESS_NAME) return "BBA";
  return display
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
