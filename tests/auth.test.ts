// OAuth mechanics are easy to get subtly wrong (GitHub returns failures with
// HTTP 200, and a wrong client secret yields an empty body rather than an error),
// so these pin the parse and the failure messages.
import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, fetchUser, refreshAccessToken, OAUTH_SCOPES } from "../src/auth";

const cfg = {
  clientId: "Iv1.abc123",
  clientSecret: "shhh-secret",
  redirectUri: "https://bug-hunter.example.com/auth/github/callback",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildAuthorizeUrl", () => {
  it("includes client id, redirect, state and scopes", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: cfg.clientId,
        redirectUri: cfg.redirectUri,
        state: "nonce123",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(cfg.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce123");
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPES.join(" "));
    expect(url.searchParams.get("allow_signup")).toBe("false");
  });

  it("asks for exactly read:user + repo, with no redundant hook scope", () => {
    // `repo` already grants repository webhooks; requesting admin:repo_hook adds
    // nothing and would only widen the consent screen.
    expect(OAUTH_SCOPES).toEqual(["read:user", "repo"]);
    const url = new URL(
      buildAuthorizeUrl({ clientId: "x", redirectUri: "https://h/cb", state: "s" }),
    );
    expect(url.searchParams.get("scope")).toBe("read:user repo");
    expect(url.searchParams.get("scope")).not.toContain("repo_hook");
  });

  it("lets the caller narrow scopes", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "x",
        redirectUri: "https://h/cb",
        state: "s",
        scopes: ["read:user"],
      }),
    );
    expect(url.searchParams.get("scope")).toBe("read:user");
  });
});

describe("exchangeCode", () => {
  it("returns the access token on success", async () => {
    const f = vi.fn(async () =>
      jsonResponse({ access_token: "gho_abc", scope: "repo,read:user", token_type: "bearer" }),
    );
    const r = await exchangeCode(cfg, "code-1", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, accessToken: "gho_abc", scope: "repo,read:user", tokenType: "bearer" });

    // The exchange must POST the code and secret as JSON, never in the query.
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String((init as RequestInit).body)).toContain("code-1");
    expect(String((init as RequestInit).body)).toContain(cfg.clientSecret);
  });

  it("surfaces GitHub's error field (HTTP 200 with an error body)", async () => {
    const f = vi.fn(async () =>
      jsonResponse({ error: "bad_verification_code", error_description: "The code expired" }),
    );
    const r = await exchangeCode(cfg, "stale", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("The code expired");
  });

  it("explains a missing token as a client-id/secret problem", async () => {
    const f = vi.fn(async () => jsonResponse({ scope: "" }));
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/GITHUB_OAUTH_CLIENT_ID/);
  });

  it("never echoes the client secret in a failure", async () => {
    const f = vi.fn(async () => jsonResponse({ error: "incorrect_client_credentials" }));
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain(cfg.clientSecret);
      expect(r.reason).not.toContain("code");
    }
  });

  it("reports a network failure as a reachability problem", async () => {
    const f = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Could not reach GitHub/);
  });

  it("reports a non-2xx response", async () => {
    const f = vi.fn(async () => jsonResponse({}, 500));
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("HTTP 500");
  });
});

describe("fetchUser", () => {
  it("maps the profile fields", async () => {
    const f = vi.fn(async () =>
      jsonResponse({ login: "dk3yyyy", name: "Josh", avatar_url: "https://a.example/1" }),
    );
    const u = await fetchUser("gho_abc", f as unknown as typeof fetch);
    expect(u).toEqual({ login: "dk3yyyy", name: "Josh", avatar: "https://a.example/1" });
  });

  it("returns null on an unauthorized token", async () => {
    const f = vi.fn(async () => jsonResponse({ message: "Bad credentials" }, 401));
    expect(await fetchUser("expired", f as unknown as typeof fetch)).toBeNull();
  });

  it("returns null rather than throwing when GitHub is unreachable", async () => {
    const f = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    expect(await fetchUser("gho_abc", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("expiring tokens (default for OAuth Apps created since Aug 2026)", () => {
  it("captures expires_in and refresh_token from the login exchange", async () => {
    const f = vi.fn(async () =>
      jsonResponse({
        access_token: "gho_short",
        scope: "repo",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_refresh",
      }),
    );
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expiresIn).toBe(28800);
      expect(r.refreshToken).toBe("ghr_refresh");
    }
  });

  it("omits expiry fields for a non-expiring token", async () => {
    const f = vi.fn(async () => jsonResponse({ access_token: "gho_long", scope: "repo" }));
    const r = await exchangeCode(cfg, "code", f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expiresIn).toBeUndefined();
      expect(r.refreshToken).toBeUndefined();
    }
  });

  it("refreshes with grant_type=refresh_token", async () => {
    const f = vi.fn(async () =>
      jsonResponse({ access_token: "gho_new", expires_in: 28800, refresh_token: "ghr_rotated" }),
    );
    const r = await refreshAccessToken(cfg, "ghr_old", f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accessToken).toBe("gho_new");
      expect(r.refreshToken).toBe("ghr_rotated");
    }

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("ghr_old");
    expect(body.client_id).toBe(cfg.clientId);
  });

  it("reports a revoked refresh token without leaking it", async () => {
    const f = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant", error_description: "The refresh token is invalid." }),
    );
    const r = await refreshAccessToken(cfg, "ghr_revoked_secret", f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/refresh/i);
      expect(r.reason).not.toContain("ghr_revoked_secret");
    }
  });
});
