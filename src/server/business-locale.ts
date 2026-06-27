import { get, run } from "./db.js";
import {
  DEFAULT_COUNTRY,
  DEFAULT_TIMEZONE,
  formatOffsetLabel,
  getDefaultTimezoneForCountry,
  isValidCountry,
  isValidTimezoneForCountry,
  utcOffsetHoursForTimezone,
  type CountryCode,
} from "../shared/locale.js";

export type BusinessLocale = {
  country: CountryCode;
  timezone: string;
  utc_offset_hours: number;
  utc_offset_label: string;
};

async function getMetaValue(key: string): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

export async function getBusinessLocale(): Promise<BusinessLocale> {
  const rawCountry = await getMetaValue("business_country");
  const country = isValidCountry(rawCountry) ? rawCountry : DEFAULT_COUNTRY;

  const rawTimezone = await getMetaValue("business_timezone");
  const timezone = isValidTimezoneForCountry(country, rawTimezone)
    ? rawTimezone
    : getDefaultTimezoneForCountry(country);

  const utc_offset_hours = utcOffsetHoursForTimezone(timezone);

  return {
    country,
    timezone,
    utc_offset_hours,
    utc_offset_label: formatOffsetLabel(utc_offset_hours),
  };
}

export async function setBusinessLocale(country: string, timezone: string): Promise<BusinessLocale> {
  if (!isValidCountry(country)) {
    throw new Error("Unsupported country");
  }
  if (!isValidTimezoneForCountry(country, timezone)) {
    throw new Error("Timezone does not match country");
  }

  const utcOffset = utcOffsetHoursForTimezone(timezone);

  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('business_country', ?)", [country]);
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('business_timezone', ?)", [timezone]);
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('business_utc_offset', ?)", [String(utcOffset)]);

  return {
    country,
    timezone,
    utc_offset_hours: utcOffset,
    utc_offset_label: formatOffsetLabel(utcOffset),
  };
}

export async function getBusinessUtcOffsetHours(): Promise<number> {
  const locale = await getBusinessLocale();
  return locale.utc_offset_hours;
}
