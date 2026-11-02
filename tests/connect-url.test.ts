// The landing is also built for GitHub Pages, where there is no server. APP_URL
// is what lets the "Connect a repo" button point at a real hosted /connect page
// instead of a docs anchor. This file pins that behaviour for the server render.
import { beforeAll, describe, expect, it } from "vitest";

process.env.PORT = "3999";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.GITHUB_TOKEN = "test-token";
process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
process.env.LANDING_REPO_URL = "https://github.com/dk3yyyy/bug-hunter";
process.env.APP_URL = "https://bh.example.com/";
process.env.PUBLIC_URL = "https://bh.example.com";

type HonoApp = { request: (input: string | URL, init?: RequestInit) => Response | Promise<Response> };
let app: HonoApp;

beforeAll(async () => {
  app = (await import("../src/server")).app;
});

describe("hosted connect target", () => {
  it("points the landing's Connect buttons at APP_URL/connect", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('href="https://bh.example.com/connect"');
    // No double slash from a trailing slash in APP_URL.
    expect(html).not.toContain("https://bh.example.com//connect");
  });

  it("pre-fills PUBLIC_URL in the connect form", async () => {
    const res = await app.request("/connect");
    const html = await res.text();
    expect(html).toContain('value="https://bh.example.com"');
  });
});
