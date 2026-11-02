// Signed + encrypted session cookie payloads.
//
// The app has no database, so "logged in" has to survive across requests in a
// cookie. The session carries the GitHub OAuth token, which must not be readable
// by anything that can see the cookie jar, so this seals it with AES-256-GCM
// (confidentiality + integrity in one pass) rather than a plain HMAC signature.
// Only node:crypto is used — no new dependencies.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type Session = {
  /** GitHub login (lowercased) this session was minted for. */
  login: string;
  /** OAuth access token used for repo/hook calls, so GitHub enforces the user. */
  token: string;
  /** Display name from GET /user, when GitHub returned one. */
  name?: string;
  /** Avatar URL from GET /user, when present. */
  avatar?: string;
  /**
   * When the access token stops working (epoch ms). Absent = GitHub did not say,
   * i.e. a non-expiring token from an OAuth App with short-lived tokens disabled.
   */
  expiresAt?: number;
  /** Refresh token, present when the app issues expiring access tokens. */
  refreshToken?: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
};

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(secret: string): Buffer {
  // Fixed 32-byte key from whatever-length secret the deployment has.
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt a session into a cookie-safe string. */
export function sealSession(session: Session, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Decrypt and validate a session. Returns null for anything malformed, tampered
 * with, encrypted under a different secret, or expired — callers treat null as
 * "not logged in" and never see a partial session.
 */
export function openSession(raw: string, secret: string, now = Date.now()): Session | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64url");
    if (buf.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plain);
    if (typeof parsed !== "object" || parsed === null) return null;
    const s = parsed as Partial<Session>;
    if (typeof s.login !== "string" || !s.login) return null;
    if (typeof s.token !== "string" || !s.token) return null;
    if (typeof s.exp !== "number" || !Number.isFinite(s.exp)) return null;
    if (s.exp <= now) return null;
    return {
      login: s.login,
      token: s.token,
      exp: s.exp,
      ...(typeof s.name === "string" ? { name: s.name } : {}),
      ...(typeof s.avatar === "string" ? { avatar: s.avatar } : {}),
      ...(typeof s.expiresAt === "number" && Number.isFinite(s.expiresAt)
        ? { expiresAt: s.expiresAt }
        : {}),
      ...(typeof s.refreshToken === "string" && s.refreshToken
        ? { refreshToken: s.refreshToken }
        : {}),
    };
  } catch {
    return null;
  }
}
