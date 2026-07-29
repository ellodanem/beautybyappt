import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, run } from "./db.js";
import {
  MAX_BUSINESS_NAME,
  MAX_BUSINESS_TAGLINE,
  MAX_LOGO_DATA_URL_BYTES,
  MAX_LOGO_URL_LENGTH,
  type Branding,
} from "../shared/branding.js";
import { getPublicPlatformBranding } from "./platform-branding.js";
import { getBusinessLocale } from "./business-locale.js";

const ALLOWED_DATA_IMAGE_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/webp;base64,",
  "data:image/svg+xml;base64,",
  "data:image/svg+xml,",
];

const BrandingSchema = z.object({
  business_name: z.string(),
  business_tagline: z.string(),
  logo_url: z.string(),
});

async function getMetaValue(key: string): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

async function setMetaValue(key: string, value: string): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [key, value]);
}

export function validateLogoUrl(url: string): string | null {
  if (!url) return "";
  if (url.startsWith("https://") && url.length <= MAX_LOGO_URL_LENGTH) return url;
  const hasAllowedPrefix = ALLOWED_DATA_IMAGE_PREFIXES.some((prefix) => url.startsWith(prefix));
  if (hasAllowedPrefix && url.length <= MAX_LOGO_DATA_URL_BYTES) return url;
  return null;
}

export async function getBranding(): Promise<Branding> {
  return {
    business_name: await getMetaValue("business_name"),
    business_tagline: await getMetaValue("business_tagline"),
    logo_url: await getMetaValue("logo_url"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerBrandingRoutes(app: OpenAPIHono<any>) {
  const getBrandingSettings = createRoute({
    method: "get",
    path: "/api/settings/branding",
    responses: {
      200: {
        description: "Business branding settings",
        content: { "application/json": { schema: BrandingSchema } },
      },
    },
  });

  app.openapi(getBrandingSettings, async (c) => {
    return c.json(await getBranding(), 200);
  });

  const updateBrandingSettings = createRoute({
    method: "put",
    path: "/api/settings/branding",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              business_name: z.string(),
              business_tagline: z.string().optional(),
              logo_url: z.string().nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated branding",
        content: { "application/json": { schema: BrandingSchema } },
      },
      400: {
        description: "Invalid input",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
    },
  });

  app.openapi(updateBrandingSettings, async (c) => {
    const body = c.req.valid("json");
    const name = body.business_name.trim();
    if (!name) {
      return c.json({ error: "Business name is required" }, 400);
    }
    if (name.length > MAX_BUSINESS_NAME) {
      return c.json({ error: `Business name must be ${MAX_BUSINESS_NAME} characters or fewer` }, 400);
    }

    const tagline = (body.business_tagline ?? "").trim();
    if (tagline.length > MAX_BUSINESS_TAGLINE) {
      return c.json({ error: `Tagline must be ${MAX_BUSINESS_TAGLINE} characters or fewer` }, 400);
    }

    let logoUrl = await getMetaValue("logo_url");
    if (body.logo_url !== undefined) {
      const validated = validateLogoUrl(body.logo_url ?? "");
      if (validated === null) {
        return c.json({ error: "Invalid logo. Use PNG, JPEG, WebP, or SVG under 512 KB, or an https URL." }, 400);
      }
      logoUrl = validated;
    }

    await setMetaValue("business_name", name);
    await setMetaValue("business_tagline", tagline);
    await setMetaValue("logo_url", logoUrl);

    return c.json(await getBranding(), 200);
  });

  const uploadLogo = createRoute({
    method: "post",
    path: "/api/settings/branding/logo",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ logo_data_url: z.string() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Logo uploaded",
        content: { "application/json": { schema: BrandingSchema } },
      },
      400: {
        description: "Invalid logo",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
    },
  });

  app.openapi(uploadLogo, async (c) => {
    const { logo_data_url } = c.req.valid("json");
    const validated = validateLogoUrl(logo_data_url);
    if (validated === null) {
      return c.json({ error: "Invalid logo. Use PNG, JPEG, WebP, or SVG under 512 KB." }, 400);
    }
    await setMetaValue("logo_url", validated);
    return c.json(await getBranding(), 200);
  });

  const PublicBrandingSchema = BrandingSchema.extend({
    platform: z.object({
      plan: z.enum(["free", "pro", "premium"]),
      show_footer: z.boolean(),
      show_signup_promo: z.boolean(),
      platform_name: z.string(),
      platform_url: z.string(),
      signup_url: z.string(),
    }),
    timezone: z.string(),
  });

  const getPublicBranding = createRoute({
    method: "get",
    path: "/api/public/branding",
    responses: {
      200: {
        description: "Public branding for client-facing pages",
        content: { "application/json": { schema: PublicBrandingSchema } },
      },
    },
  });

  app.openapi(getPublicBranding, async (c) => {
    const locale = await getBusinessLocale();
    return c.json({
      ...(await getBranding()),
      platform: await getPublicPlatformBranding(),
      timezone: locale.timezone,
    }, 200);
  });
}
