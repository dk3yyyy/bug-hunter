// App mode used to read the private key from a PEM file only. Render, Railway and
// Fly expose secrets as env vars and cannot mount a file, so GITHUB_PRIVATE_KEY
// (inline PEM) is the supported path there. These tests pin that precedence, the
// escaped-newline case that copy-paste produces, and that no key material leaks
// into error messages.
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

const { privateKey: realPem } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}) as { privateKey: string };

function baseEnv(): void {
  process.env.PORT = "3999";
  process.env.GITHUB_MODE = "app";
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_SLUG = "bug-hunter-test";
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  // Deliberately a path that does not exist: inline key must win over the file.
  process.env.GITHUB_PRIVATE_KEY_PATH = "/tmp/bh-private-key-does-not-exist.pem";
  delete process.env.GITHUB_PRIVATE_KEY;
}

/** Fresh module graph so the cached App instance from a previous case is dropped. */
async function loadAppModule(): Promise<typeof import("../src/github/app")> {
  vi.resetModules();
  return import("../src/github/app");
}

afterEach(() => {
  vi.resetModules();
  delete process.env.GITHUB_PRIVATE_KEY;
});

describe("GitHub App private key sourcing", () => {
  it("builds the App from an inline PEM when no file exists", async () => {
    baseEnv();
    process.env.GITHUB_PRIVATE_KEY = realPem;
    const { getApp } = await loadAppModule();
    expect(() => getApp()).not.toThrow();
    // Cached: a second call returns the same instance rather than re-reading.
    expect(getApp()).toBe(getApp());
  });

  it("accepts a single-line PEM with escaped \\n from a dashboard paste", async () => {
    baseEnv();
    const escaped = realPem.replace(/\n/g, "\\n");
    expect(escaped).toContain("\\n");
    expect(escaped).not.toContain("\n");
    process.env.GITHUB_PRIVATE_KEY = escaped;
    const { getApp } = await loadAppModule();
    expect(() => getApp()).not.toThrow();
  });

  it("reports a missing key file and names the env vars when nothing is set", async () => {
    baseEnv();
    const { getApp } = await loadAppModule();
    expect(() => getApp()).toThrow(/GITHUB_PRIVATE_KEY_PATH/);
    expect(() => getApp()).toThrow(/GITHUB_PRIVATE_KEY/);
  });

  it("rejects a non-PEM value without echoing it", async () => {
    baseEnv();
    const secretish = "not-a-pem-but-looks-like-a-secret-abc123";
    process.env.GITHUB_PRIVATE_KEY = secretish;
    const { getApp } = await loadAppModule();
    let message = "";
    try {
      getApp();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/not a PEM private key/);
    expect(message).not.toContain(secretish);
  });
});
