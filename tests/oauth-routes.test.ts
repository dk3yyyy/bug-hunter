// The login flow: redirect shape, CSRF state rejection, and that a sealed session
// cookie is enough to reach /api/* without the shared secret. GitHub itself is
// never called here — the callback cases stop before the token exchange.
import { beforeAll, describe, expect, it } from "vitest";
import { sealSession, SESSION_TTL_MS } from "../src/session";

process.env.PORT = "3999";
process.env.GITHUB_MODE = "pat";
process.env.GITHUB_TOKEN = "test-token";
process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
process.env.SESSION_SECRET = "session-secret-for-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
process.env.LLM_PROVIDER = "google";
process.env.PUBLIC_URL = "https://oauth.example.com";
process.env.GITHUB_OAUTH_CLIENT_ID = "Iv1.testclient";
process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-client-secret";

type HonoApp = {
  request: (input: string | URL, init?: RequestInit) => Response | Promise<Response>;
};
let app: HonoApp;

function sessionCookie(login = "dk3yyyy"): string {
  const sealed = sealSession(
    { login, token: "gho_test_token", exp: Date.now() + SESSION_TTL_MS },
    process.env.SESSION_SECRET as string,
  );
  return `bh_session=${sealed}`;
}

beforeAll(async () => {
  app = (await import("../src/server")).app;
});

describe("GET /auth/github", () => {
  it("redirects to GitHub with the client id, callback and a state cookie", async () => {
    const res = await app.request("/auth/github");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("Iv1.testclient");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://oauth.example.com/auth/github/callback");
    expect(loc.searchParams.get("state")).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bh_oauth_state=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    // State must not be readable by page scripts.
    expect(setCookie.toLowerCase()).toContain("secure");
  });
});

describe("GET /auth/github/callback", () => {
  it("rejects a callback whose state does not match the cookie", async () => {
    const res = await app.request("/auth/github/callback?code=abc&state=tampered", {
      headers: { cookie: "bh_oauth_state=expected-state" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/connect?login=state");
    // No session may be minted on a failed state check.
    expect(res.headers.get("set-cookie") ?? "").not.toContain("bh_session=");
  });

  it("rejects a callback with no state cookie at all", async () => {
    const res = await app.request("/auth/github/callback?code=abc&state=anything");
    expect(res.headers.get("location")).toBe("/connect?login=state");
  });

  it("reports a cancelled authorisation without minting a session", async () => {
    const res = await app.request("/auth/github/callback?error=access_denied&state=s", {
      headers: { cookie: "bh_oauth_state=s" },
    });
    expect(res.headers.get("location")).toBe("/connect?login=cancelled");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("bh_session=");
  });
});

describe("session cookie authorises the API without the shared secret", () => {
  it("lets /api/connect through (validation error, not unauthorised)", async () => {
    const res = await app.request("/api/connect", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie() },
      body: JSON.stringify({}),
    });
    // Passed auth; failed on the empty body before any network call.
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/owner\/name/);
  });

  it("still rejects an unauthenticated /api/connect and points at login", async () => {
    const res = await app.request("/api/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "a/b" }),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string; login_url: string | null };
    expect(json.login_url).toBe("/auth/github");
  });

  it("ignores a session cookie sealed under a different secret", async () => {
    const forged = sealSession(
      { login: "attacker", token: "t", exp: Date.now() + SESSION_TTL_MS },
      "some-other-secret",
    );
    const res = await app.request("/api/connect", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `bh_session=${forged}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/me and /logout", () => {
  it("reports the signed-in user", async () => {
    const res = await app.request("/api/me", { headers: { cookie: sessionCookie("dk3yyyy") } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { logged_in: boolean; login: string };
    expect(json.logged_in).toBe(true);
    expect(json.login).toBe("dk3yyyy");
  });

  it("is 401 when anonymous", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("clears the session cookie on logout", async () => {
    const res = await app.request("/logout", { headers: { cookie: sessionCookie() } });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bh_session=");
    // Deletion is expressed as an empty value with Max-Age=0.
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("GET /connect", () => {
  it("offers the GitHub login button to anonymous visitors", async () => {
    const res = await app.request("/connect");
    const html = await res.text();
    expect(html).toContain("Connect with GitHub");
    expect(html).toContain('href="/auth/github"');
    // The legacy form must survive for scripts and tests.
    expect(html).toContain('id="secret"');
    expect(html).toContain('id="connect-btn"');
  });

  it("shows who is signed in and a way out", async () => {
    const res = await app.request("/connect", { headers: { cookie: sessionCookie("octocat") } });
    const html = await res.text();
    expect(html).toContain("Signed in as @octocat");
    expect(html).toContain('href="/logout"');
  });

  it("renders the login failure reason from the redirect", async () => {
    const res = await app.request("/connect?login=state");
    const html = await res.text();
    expect(html).toMatch(/expired|did not match/i);
  });
});
