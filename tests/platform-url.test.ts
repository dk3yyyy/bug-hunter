// A fresh Render/Railway deploy has no hand-set PUBLIC_URL, and without one
// POST /api/connect returned 400 "PUBLIC_URL not set". The server now derives it
// from the platform's own env var; an explicit PUBLIC_URL still wins.
import { afterEach, describe, expect, it, vi } from "vitest";

function baseEnv(): void {
  process.env.PORT = "3999";
  process.env.GITHUB_MODE = "pat";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
  process.env.LLM_PROVIDER = "google";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  delete process.env.PUBLIC_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
}

async function loadEnv(): Promise<typeof import("../src/env")> {
  vi.resetModules();
  return import("../src/env");
}

afterEach(() => {
  vi.resetModules();
  delete process.env.RENDER_EXTERNAL_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
});

describe("PUBLIC_URL derivation for managed hosts", () => {
  it("uses RENDER_EXTERNAL_URL when PUBLIC_URL is empty", async () => {
    baseEnv();
    process.env.RENDER_EXTERNAL_URL = "https://bug-hunter.onrender.com/";
    const { env } = await loadEnv();
    expect(env.PUBLIC_URL).toBe("https://bug-hunter.onrender.com");
  });

  it("turns Railway's bare host into an https origin", async () => {
    baseEnv();
    process.env.RAILWAY_PUBLIC_DOMAIN = "bug-hunter-production.up.railway.app";
    const { env } = await loadEnv();
    expect(env.PUBLIC_URL).toBe("https://bug-hunter-production.up.railway.app");
  });

  it("prefers an explicit PUBLIC_URL over the platform value", async () => {
    baseEnv();
    process.env.PUBLIC_URL = "https://bugs.example.com";
    process.env.RENDER_EXTERNAL_URL = "https://ignored.onrender.com";
    const { env } = await loadEnv();
    expect(env.PUBLIC_URL).toBe("https://bugs.example.com");
  });

  it("stays empty when neither is set (local dev)", async () => {
    baseEnv();
    const { env } = await loadEnv();
    expect(env.PUBLIC_URL).toBe("");
  });
});
