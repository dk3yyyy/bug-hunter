// Real local integration test: boots the Hono app in-process (no network) and
// exercises the landing, /connect, and the guarded API endpoints.
// This is what "test locally before pushing" looks like.
import { beforeAll, describe, expect, it } from "vitest";

// env.ts validates + exits at import time, so set env BEFORE importing the app.
process.env.PORT = "3999";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.GITHUB_TOKEN = "test-token";
process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
process.env.LANDING_REPO_URL = "https://github.com/dk3yyyy/bug-hunter";

type HonoApp = { request: (input: string | URL, init?: RequestInit) => Response | Promise<Response> };

let app: HonoApp;

beforeAll(async () => {
  app = (await import("../src/server")).app;
});

describe("server (in-process)", () => {
  it("serves the landing with 'Connect a repo' pointing at /connect (not GitHub)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connect a repo");
    expect(html).toContain('href="/connect"');
    // "View the repo" still points at GitHub.
    expect(html).toContain('href="https://github.com/dk3yyyy/bug-hunter"');
  });

  it("serves the /connect page with the hunt form", async () => {
    const res = await app.request("/connect");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="hunt-btn"');
    expect(html).toContain('id="pr_url"');
    expect(html).toContain('id="secret"');
  });

  it("health endpoint responds", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("rejects /api/hunt without the shared secret (401)", async () => {
    const res = await app.request("/api/hunt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pr_url: "https://github.com/a/b/pull/1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects /api/hunt with a malformed body (400, no network)", async () => {
    const res = await app.request("/api/hunt", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BugHunter-Secret": "this-is-a-long-secret-123" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("explains /api/connect needs PUBLIC_URL (400, no network)", async () => {
    const res = await app.request("/api/connect", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BugHunter-Secret": "this-is-a-long-secret-123" },
      body: JSON.stringify({ repo: "a/b" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("PUBLIC_URL");
  });

  it("serves the dashboard", async () => {
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
  });
});
