/** AES-GCM encrypt/decrypt for stored email credentials (refresh tokens, SMTP passwords). */

function encryptionSecret(env: { SESSION_SECRET?: string; ADMIN_PASSWORD?: string }): string {
  return env.SESSION_SECRET?.trim() || env.ADMIN_PASSWORD?.trim() || "insecure-email-secret";
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSecret(
  plaintext: string,
  env: { SESSION_SECRET?: string; ADMIN_PASSWORD?: string },
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(encryptionSecret(env));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(combined);
}

export async function decryptSecret(
  encoded: string,
  env: { SESSION_SECRET?: string; ADMIN_PASSWORD?: string },
): Promise<string> {
  if (!encoded.trim()) return "";
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const key = await deriveKey(encryptionSecret(env));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
