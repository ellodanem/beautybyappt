import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { runtimeEnv } from "./runtime-env.js";

export type AuthEnv = {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
};

const SESSION_COOKIE = "bba_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const PUBLIC_API_EXACT = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

const PUBLIC_API_PREFIXES = [
  "/api/book/public/",
  "/api/anytime/public",
  "/api/offer/public/",
  "/api/public/",
  "/api/payments/complete",
  "/api/webhooks/stripe",
  "/api/cron/reminders",
];

export function isAuthConfigured(env: AuthEnv): boolean {
  return Boolean(env.ADMIN_PASSWORD);
}

function sessionSecret(env: AuthEnv): string {
  return env.SESSION_SECRET || env.ADMIN_PASSWORD || "insecure-default";
}

export function isPublicApiPath(pathname: string): boolean {
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function cookieSecure(c: { req: { url: string } }): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

async function createSessionToken(env: AuthEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: "admin", iat: now, exp: now + SESSION_MAX_AGE_SEC }, sessionSecret(env));
}

async function verifySessionToken(token: string, env: AuthEnv): Promise<boolean> {
  try {
    const payload = await verify(token, sessionSecret(env));
    return payload.sub === "admin";
  } catch {
    return false;
  }
}

export function createAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (!pathname.startsWith("/api/") || isPublicApiPath(pathname)) {
      await next();
      return;
    }

    const env = runtimeEnv(c.env) as AuthEnv;
    if (!isAuthConfigured(env)) {
      return c.json({ error: "ADMIN_PASSWORD is not configured" }, 503);
    }

    const token = getCookie(c, SESSION_COOKIE);
    if (!token || !(await verifySessionToken(token, env))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuthRoutes(app: OpenAPIHono<any>) {
  const MeSchema = z.object({
    authenticated: z.boolean(),
    configured: z.boolean(),
  });

  const getMe = createRoute({
    method: "get",
    path: "/api/auth/me",
    responses: {
      200: {
        description: "Current session status",
        content: { "application/json": { schema: MeSchema } },
      },
    },
  });

  app.openapi(getMe, async (c) => {
    const env = runtimeEnv(c.env) as AuthEnv;
    const configured = isAuthConfigured(env);
    if (!configured) {
      return c.json({ authenticated: false, configured: false }, 200);
    }

    const token = getCookie(c, SESSION_COOKIE);
    const authenticated = Boolean(token && (await verifySessionToken(token, env)));
    return c.json({ authenticated, configured: true }, 200);
  });

  const login = createRoute({
    method: "post",
    path: "/api/auth/login",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ password: z.string() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Logged in",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
      401: {
        description: "Invalid password",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
      503: {
        description: "Auth not configured",
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
      },
    },
  });

  app.openapi(login, async (c) => {
    const env = runtimeEnv(c.env) as AuthEnv;
    if (!isAuthConfigured(env)) {
      return c.json({ error: "ADMIN_PASSWORD is not configured" }, 503);
    }

    const { password } = c.req.valid("json");
    if (!timingSafeEqual(password, env.ADMIN_PASSWORD!)) {
      return c.json({ error: "Invalid password" }, 401);
    }

    const token = await createSessionToken(env);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure(c),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    });

    return c.json({ ok: true }, 200);
  });

  const logout = createRoute({
    method: "post",
    path: "/api/auth/logout",
    responses: {
      200: {
        description: "Logged out",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
    },
  });

  app.openapi(logout, async (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true }, 200);
  });
}
