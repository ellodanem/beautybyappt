/** Merge Vercel/Node process.env with Hono context bindings (Workers D1, secrets). */
export function runtimeEnv<T extends Record<string, unknown>>(cEnv: T): T {
  if (typeof process === "undefined") return cEnv;
  const merged = { ...process.env, ...cEnv } as Record<string, unknown>;
  // Wrangler/Workers bindings can be non-enumerable — copy known keys explicitly.
  for (const [key, value] of Object.entries(cEnv)) {
    if (value !== undefined && value !== null && value !== "") {
      merged[key] = value;
    }
  }
  return merged as T;
}

export function bindingString(
  bindings: Record<string, unknown>,
  key: string,
): string | undefined {
  const fromBinding = bindings[key];
  if (typeof fromBinding === "string" && fromBinding.length > 0) {
    return fromBinding;
  }
  if (typeof process !== "undefined") {
    const fromProcess = process.env[key];
    if (typeof fromProcess === "string" && fromProcess.length > 0) {
      return fromProcess;
    }
  }
  return undefined;
}
