import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { finalizeBookingLinkCheckout } from "./booking-link-payments.js";
import { finalizeAppointmentPaymentCheckout } from "./appointment-payments.js";
import {
  finalizeOfferingBookingCheckout,
  isBookingLinkCheckoutMetadata,
  isOfferingCheckoutMetadata,
} from "./offering-payments.js";
import {
  finalizeAnytimeBookingCheckout,
  isAnytimeCheckoutMetadata,
} from "./anytime-payments.js";
import { scheduleBookingConfirmation } from "./notifications.js";
import { runtimeEnv } from "./runtime-env.js";
import {
  isStripeConfigured,
  parseStripeWebhookEvent,
  verifyStripeWebhook,
  type StripeEnv,
} from "./stripe.js";
import {
  getStripePaymentsEnabled,
  setStripePaymentsEnabled,
} from "./stripe-payments-settings.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPaymentRoutes(app: OpenAPIHono<any>) {
  app.post("/api/webhooks/stripe", async (c) => {
    const env = runtimeEnv(c.env) as StripeEnv;
    const payload = await c.req.text();
    const signature = c.req.header("stripe-signature");

    if (!verifyStripeWebhook(payload, signature, env.STRIPE_WEBHOOK_SECRET)) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const event = parseStripeWebhookEvent(payload);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metaType = session.metadata?.type;
      if (session.metadata?.type === "appointment_payment" && session.id) {
        try {
          const result = await finalizeAppointmentPaymentCheckout(env, session.id);
          if (!result.already_done) {
            scheduleBookingConfirmation(c, result.appointment_id, { receipt: true });
          }
        } catch (err) {
          console.error("Appointment payment webhook failed:", (err as Error).message);
        }
      } else if (isBookingLinkCheckoutMetadata(metaType) && session.id) {
        try {
          const result = await finalizeBookingLinkCheckout(env, session.id);
          if (!result.already_done) {
            scheduleBookingConfirmation(c, result.appointment_id!, { receipt: true });
          }
        } catch (err) {
          console.error("Webhook finalize failed:", (err as Error).message);
        }
      } else if (isOfferingCheckoutMetadata(metaType) && session.id) {
        try {
          const result = await finalizeOfferingBookingCheckout(env, session.id);
          if (!result.already_done) {
            scheduleBookingConfirmation(c, result.appointment_id!, { receipt: true });
          }
        } catch (err) {
          console.error("Offering checkout webhook failed:", (err as Error).message);
        }
      } else if (isAnytimeCheckoutMetadata(metaType) && session.id) {
        try {
          const result = await finalizeAnytimeBookingCheckout(env, session.id);
          if (!result.already_done) {
            scheduleBookingConfirmation(c, result.appointment_id!, { receipt: true });
          }
        } catch (err) {
          console.error("Anytime checkout webhook failed:", (err as Error).message);
        }
      }
    }

    return c.json({ received: true }, 200);
  });

  const getStripeSettings = createRoute({
    method: "get",
    path: "/api/settings/stripe",
    responses: {
      200: {
        description: "Stripe configuration status",
        content: {
          "application/json": {
            schema: z.object({
              configured: z.boolean(),
              webhook_configured: z.boolean(),
              payments_enabled: z.boolean(),
            }),
          },
        },
      },
    },
  });

  app.openapi(getStripeSettings, async (c) => {
    const env = runtimeEnv(c.env) as StripeEnv;
    return c.json({
      configured: isStripeConfigured(env),
      webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
      payments_enabled: await getStripePaymentsEnabled(),
    }, 200);
  });

  const updateStripeSettings = createRoute({
    method: "put",
    path: "/api/settings/stripe",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ payments_enabled: z.boolean() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: z.object({
              configured: z.boolean(),
              webhook_configured: z.boolean(),
              payments_enabled: z.boolean(),
            }),
          },
        },
      },
      400: {
        description: "Stripe keys not configured",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
    },
  });

  app.openapi(updateStripeSettings, async (c) => {
    const env = runtimeEnv(c.env) as StripeEnv;
    const { payments_enabled } = c.req.valid("json");
    if (payments_enabled && !isStripeConfigured(env)) {
      return c.json({ error: "Add STRIPE_SECRET_KEY before enabling online payments" }, 400);
    }
    await setStripePaymentsEnabled(payments_enabled);
    return c.json({
      configured: isStripeConfigured(env),
      webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
      payments_enabled: await getStripePaymentsEnabled(),
    }, 200);
  });
}
