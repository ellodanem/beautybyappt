import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, run } from "./db.js";
import { DEFAULT_CURRENCY, isValidCurrency, currencyOptions } from "../shared/currency.js";
import {
  getGlobalBlockRegularOnEventDays,
  setGlobalBlockRegularOnEventDays,
} from "./event-override.js";

async function getDefaultCurrency(): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'default_currency'");
  const code = row?.value || DEFAULT_CURRENCY;
  return isValidCurrency(code) ? code : DEFAULT_CURRENCY;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSettingsRoutes(app: OpenAPIHono<any>) {
  const getCurrencySettings = createRoute({
    method: "get",
    path: "/api/settings/currency",
    responses: {
      200: {
        description: "Default currency and supported list",
        content: {
          "application/json": {
            schema: z.object({
              default_currency: z.string(),
              supported: z.array(z.object({ value: z.string(), label: z.string() })),
            }),
          },
        },
      },
    },
  });

  app.openapi(getCurrencySettings, async (c) => {
    const default_currency = await getDefaultCurrency();
    return c.json({ default_currency, supported: currencyOptions() }, 200);
  });

  const updateCurrencySettings = createRoute({
    method: "put",
    path: "/api/settings/currency",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ default_currency: z.string() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: z.object({ default_currency: z.string() }),
          },
        },
      },
      400: {
        description: "Invalid currency",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
    },
  });

  app.openapi(updateCurrencySettings, async (c) => {
    const { default_currency } = c.req.valid("json");
    if (!isValidCurrency(default_currency)) {
      return c.json({ error: "Unsupported currency" }, 400);
    }
    await run(
      "INSERT OR REPLACE INTO _meta (key, value) VALUES ('default_currency', ?)",
      [default_currency],
    );
    return c.json({ default_currency }, 200);
  });

  const getEventOverrideSettings = createRoute({
    method: "get",
    path: "/api/settings/event-override",
    responses: {
      200: {
        description: "Whether live event days block regular bookings by default",
        content: {
          "application/json": {
            schema: z.object({ block_regular_on_event_days: z.boolean() }),
          },
        },
      },
    },
  });

  app.openapi(getEventOverrideSettings, async (c) => {
    const block_regular_on_event_days = await getGlobalBlockRegularOnEventDays();
    return c.json({ block_regular_on_event_days }, 200);
  });

  const updateEventOverrideSettings = createRoute({
    method: "put",
    path: "/api/settings/event-override",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ block_regular_on_event_days: z.boolean() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: z.object({ block_regular_on_event_days: z.boolean() }),
          },
        },
      },
    },
  });

  app.openapi(updateEventOverrideSettings, async (c) => {
    const { block_regular_on_event_days } = c.req.valid("json");
    await setGlobalBlockRegularOnEventDays(block_regular_on_event_days);
    return c.json({ block_regular_on_event_days }, 200);
  });
}

export { getDefaultCurrency };
