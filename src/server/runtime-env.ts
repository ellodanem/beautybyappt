/** Merge Vercel/Node process.env with Hono context bindings (Workers D1, secrets). */
export function runtimeEnv<T extends Record<string, unknown>>(cEnv: T): T {
  if (typeof process === "undefined") return cEnv;
  return { ...process.env, ...cEnv } as T;
}
