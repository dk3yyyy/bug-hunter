// The session cookie carries the user's GitHub OAuth token, so sealing it has to
// be tamper-proof and unreadable. These tests pin the security properties rather
// than the encoding: round-trip, wrong secret, tampering, expiry, junk input.
import { describe, expect, it } from "vitest";
import { openSession, sealSession, SESSION_TTL_MS, type Session } from "../src/session";

const SECRET = "session-secret-under-test";

function session(overrides: Partial<Session> = {}): Session {
  return {
    login: "dk3yyyy",
    token: "gho_exampletokenvalue",
    exp: Date.now() + SESSION_TTL_MS,
    ...overrides,
  };
}

describe("sealed session cookie", () => {
  it("round-trips a session", () => {
    const s = session({ name: "Josh", avatar: "https://avatars.example/u/1" });
    const sealed = sealSession(s, SECRET);
    const opened = openSession(sealed, SECRET);
    expect(opened).toEqual(s);
  });

  it("does not expose the token in the cookie value", () => {
    const sealed = sealSession(session({ token: "gho_supersecret" }), SECRET);
    expect(sealed).not.toContain("gho_supersecret");
    // The login name must not leak either.
    expect(sealed).not.toContain("dk3yyyy");
  });

  it("rejects a session sealed under a different secret", () => {
    const sealed = sealSession(session(), SECRET);
    expect(openSession(sealed, "another-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const sealed = sealSession(session(), SECRET);
    const buf = Buffer.from(sealed, "base64url");
    // Flip a bit in the ciphertext (not the IV/tag) — GCM must refuse it.
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    expect(openSession(buf.toString("base64url"), SECRET)).toBeNull();
  });

  it("treats an expired session as logged out", () => {
    const now = Date.now();
    const sealed = sealSession(session({ exp: now - 1000 }), SECRET);
    expect(openSession(sealed, SECRET, now)).toBeNull();
  });

  it("returns null for junk instead of throwing", () => {
    for (const raw of ["", "not-a-cookie", "====", "eyJsb2dpbiI6IngifQ"]) {
      expect(openSession(raw, SECRET)).toBeNull();
    }
  });

  it("rejects a decodable-but-incomplete payload", () => {
    // An empty GCM body is structurally valid but decrypts to nothing usable.
    const sealed = sealSession(session(), SECRET);
    const buf = Buffer.from(sealed, "base64url").subarray(0, 28);
    expect(openSession(buf.toString("base64url"), SECRET)).toBeNull();
  });

  it("preserves refresh token and access-token expiry", () => {
    const s = session({ expiresAt: Date.now() + 28_800_000, refreshToken: "ghr_abc" });
    const opened = openSession(sealSession(s, SECRET), SECRET);
    expect(opened?.expiresAt).toBe(s.expiresAt);
    expect(opened?.refreshToken).toBe("ghr_abc");
  });

  it("drops a malformed expiry rather than trusting it", () => {
    const s = session();
    const sealed = sealSession({ ...s, expiresAt: "soon" as unknown as number }, SECRET);
    // Still a valid session, just without an expiry claim.
    expect(openSession(sealed, SECRET)?.expiresAt).toBeUndefined();
  });

});
