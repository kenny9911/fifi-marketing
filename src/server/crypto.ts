import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password / secret hashing (scrypt) + recovery-code generation.
 * This module must stay dependency-free (node:crypto only) so it can be
 * imported from anywhere, including src/proxy.ts.
 */

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Hash a plaintext secret → "saltHex:hashHex". */
export function hashSecret(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verification of a plaintext against a stored "salt:hash" value. */
export function verifySecret(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Unambiguous charset: no I/L/O/0/1 lookalikes. */
const RECOVERY_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** One-time recovery code, format FIFI-XXXX-XXXX-XXXX (crypto-random). */
export function generateRecoveryCode(): string {
  const group = (): string => {
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += RECOVERY_CHARS[randomInt(RECOVERY_CHARS.length)];
    }
    return out;
  };
  return `FIFI-${group()}-${group()}-${group()}`;
}

/** Minimum AUTH_SECRET length enforced in production (bytes of UTF-8 text). */
const MIN_AUTH_SECRET_LENGTH = 16;

/**
 * HS256 signing key for session JWTs: env AUTH_SECRET (required in
 * production), or — outside production only — a stable dev fallback derived
 * from a constant + cwd. Shared by src/server/auth.ts and src/proxy.ts so
 * both sides verify the same tokens.
 */
export function getAuthSecretKey(): Uint8Array {
  const env = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!env || env.length === 0) {
      throw new Error(
        "AUTH_SECRET must be set in production — refusing to fall back to a predictable derived signing key.",
      );
    }
    if (env.length < MIN_AUTH_SECRET_LENGTH) {
      throw new Error(
        `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters in production.`,
      );
    }
  }
  if (env && env.length > 0) return new TextEncoder().encode(env);
  const derived = createHash("sha256")
    .update(`fifi-dev-auth-secret:${process.cwd()}`)
    .digest("hex");
  return new TextEncoder().encode(derived);
}
