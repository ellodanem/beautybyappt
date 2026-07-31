export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number]["code"];

export const DEFAULT_COUNTRY: CountryCode = "LC";
export const DEFAULT_TIMEZONE = "America/St_Lucia";

export const SUPPORTED_COUNTRIES = [
  { code: "LC", label: "St. Lucia" },
  { code: "VC", label: "St. Vincent & the Grenadines" },
  { code: "GD", label: "Grenada" },
  { code: "BB", label: "Barbados" },
  { code: "DM", label: "Dominica" },
  { code: "AG", label: "Antigua & Barbuda" },
  { code: "TT", label: "Trinidad & Tobago" },
  { code: "JM", label: "Jamaica" },
  { code: "BS", label: "Bahamas" },
  { code: "PR", label: "Puerto Rico" },
  { code: "DO", label: "Dominican Republic" },
  { code: "HT", label: "Haiti" },
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
] as const;

export const TIMEZONES_BY_COUNTRY: Record<CountryCode, { value: string; label: string }[]> = {
  LC: [{ value: "America/St_Lucia", label: "Atlantic Standard Time (UTC−4)" }],
  VC: [{ value: "America/St_Vincent", label: "Atlantic Standard Time (UTC−4)" }],
  GD: [{ value: "America/Grenada", label: "Atlantic Standard Time (UTC−4)" }],
  BB: [{ value: "America/Barbados", label: "Atlantic Standard Time (UTC−4)" }],
  DM: [{ value: "America/Dominica", label: "Atlantic Standard Time (UTC−4)" }],
  AG: [{ value: "America/Antigua", label: "Atlantic Standard Time (UTC−4)" }],
  TT: [{ value: "America/Port_of_Spain", label: "Atlantic Standard Time (UTC−4)" }],
  JM: [{ value: "America/Jamaica", label: "Eastern Standard Time (UTC−5)" }],
  BS: [{ value: "America/Nassau", label: "Eastern Time (UTC−5 / −4 DST)" }],
  PR: [{ value: "America/Puerto_Rico", label: "Atlantic Standard Time (UTC−4)" }],
  DO: [{ value: "America/Santo_Domingo", label: "Atlantic Standard Time (UTC−4)" }],
  HT: [{ value: "America/Port-au-Prince", label: "Eastern Time (UTC−5 / −4 DST)" }],
  US: [
    { value: "America/New_York", label: "Eastern (ET)" },
    { value: "America/Chicago", label: "Central (CT)" },
    { value: "America/Denver", label: "Mountain (MT)" },
    { value: "America/Los_Angeles", label: "Pacific (PT)" },
    { value: "America/Anchorage", label: "Alaska (AKT)" },
    { value: "Pacific/Honolulu", label: "Hawaii (HST)" },
  ],
  CA: [
    { value: "America/Toronto", label: "Eastern (ET)" },
    { value: "America/Winnipeg", label: "Central (CT)" },
    { value: "America/Edmonton", label: "Mountain (MT)" },
    { value: "America/Vancouver", label: "Pacific (PT)" },
    { value: "America/St_Johns", label: "Newfoundland (NT)" },
  ],
  GB: [{ value: "Europe/London", label: "Greenwich Mean / British Summer Time" }],
  AU: [
    { value: "Australia/Sydney", label: "Australian Eastern (AEST/AEDT)" },
    { value: "Australia/Brisbane", label: "Australian Eastern — Queensland (AEST)" },
    { value: "Australia/Adelaide", label: "Australian Central (ACST/ACDT)" },
    { value: "Australia/Perth", label: "Australian Western (AWST)" },
  ],
};

const countryMap = new Map(SUPPORTED_COUNTRIES.map((c) => [c.code, c]));

export function isValidCountry(code: string): code is CountryCode {
  return countryMap.has(code as CountryCode);
}

export function getDefaultTimezoneForCountry(country: CountryCode): string {
  return TIMEZONES_BY_COUNTRY[country][0]?.value ?? DEFAULT_TIMEZONE;
}

export function isValidTimezoneForCountry(country: string, timezone: string): boolean {
  if (!isValidCountry(country)) return false;
  return TIMEZONES_BY_COUNTRY[country].some((tz) => tz.value === timezone);
}

export function countryOptions() {
  return SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label }));
}

export function timezoneOptionsForCountry(country: string) {
  if (!isValidCountry(country)) return [];
  return TIMEZONES_BY_COUNTRY[country];
}

export function utcOffsetHoursForTimezone(timeZone: string, at = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    const sign = match[1] === "+" ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    return sign * (hours + minutes / 60);
  } catch {
    return -4;
  }
}

export function formatOffsetLabel(hours: number): string {
  const sign = hours >= 0 ? "+" : "−";
  const abs = Math.abs(hours);
  const whole = Math.floor(abs);
  const minutes = Math.round((abs - whole) * 60);
  if (minutes === 0) return `UTC${sign}${whole}`;
  return `UTC${sign}${whole}:${String(minutes).padStart(2, "0")}`;
}

export function formatTimeInTimezone(timeZone: string, at = new Date()): string {
  try {
    return at.toLocaleTimeString("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "";
  }
}
