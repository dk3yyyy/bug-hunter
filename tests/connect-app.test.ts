// App mode: connect happens on GitHub's install page, not through a PAT webhook.
// These tests make sure the button and /api/connect say that instead of failing
// with an Octokit error.
import { beforeAll, describe, expect, it } from "vitest";

process.env.PORT = "3999";
process.env.GITHUB_MODE = "app";
process.env.GITHUB_APP_ID = "12345";
process.env.GITHUB_APP_SLUG = "bug-hunter-test";
process.env.GITHUB_PRIVATE_KEY_PATH = "/tmp/does-not-exist.pem";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";

type HonoApp = { request: (input: string | URL, init?: RequestInit) => Response | Promise<Response> };
let app: HonoApp;

beforeAll(async () => {
  app = (await import("../src/server")).app;
});

describe("GitHub App mode", () => {
  it("sends the landing button to the GitHub App install page", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain(
      'href="https://github.com/apps/bug-hunter-test/installations/new"',
    );
  });

  it("redirects /summon to the install page", async () => {
    const res = await app.request("/summon");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://github.com/apps/bug-hunter-test/installations/new",
    );
  });

  it("shows the install button on /connect", async () => {
    const res = await app.request("/connect");
    const html = await res.text();
    expect(html).toContain("Install the GitHub App");
    expect(html).not.toContain('id="connect-btn"');
  });

  it("explains that /api/connect is not the App flow", async () => {
    const res = await app.request("/api/connect", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-BugHunter-Secret": "this-is-a-long-secret-123",
      },
      body: JSON.stringify({ repo: "a/b" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; install_url?: string };
    expect(json.error).toContain("install page");
    expect(json.install_url).toBe(
      "https://github.com/apps/bug-hunter-test/installations/new",
    );
  });

  it("serves /summoned with the connected-repo list", async () => {
    const res = await app.request("/summoned?installation_id=999");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connected repos");
    expect(html).toContain("999");
  });
});
