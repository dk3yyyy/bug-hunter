// The hunt button used to show "✗ Error" no matter what went wrong. These pin the
// mapping from an exception to a message + actionable hint, and prove secrets in
// provider error text never reach the user.
import { beforeAll, describe, expect, it } from "vitest";

process.env.PORT = "3999";
process.env.GITHUB_MODE = "pat";
process.env.GITHUB_TOKEN = "test-token";
process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
process.env.LLM_PROVIDER = "google";

type Detail = { message: string; code: string; hint?: string };
let detail: (e: unknown) => Detail;

beforeAll(async () => {
  const mod = await import("../src/server");
  detail = mod.huntErrorDetail;
});

function err(message: string, name = "Error"): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("huntErrorDetail", () => {
  it("surfaces a provider funds failure with a top-up hint", () => {
    const d = detail(
      err(
        "generateStructured (review) failed after 3 attempts and one repair pass: Upstream request failed: Insufficient account funds",
      ),
    );
    expect(d.message).toContain("Insufficient account funds");
    expect(d.hint).toMatch(/out of credit/i);
  });

  it("never reduces the cause to the error name", () => {
    const d = detail(err("something very specific happened"));
    expect(d.message).toBe("something very specific happened");
    expect(d.message).not.toBe("Error");
  });

  it("explains an auth failure", () => {
    const d = detail(err("Bad credentials", "HttpError"));
    expect(d.hint).toMatch(/GITHUB_TOKEN/);
  });

  it("explains a rate limit", () => {
    expect(detail(err("API rate limit exceeded")).hint).toMatch(/rate limit/i);
  });

  it("explains a network failure", () => {
    expect(detail(err("fetch failed")).hint).toMatch(/reach/i);
  });

  it("scrubs secrets out of provider messages", () => {
    const d = detail(err("bad key sk-abcdefghijklmnopqrstuvwxyz0123456789 for request"));
    expect(d.message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("falls back gracefully for an empty message", () => {
    const d = detail(err(""));
    expect(d.message).toContain("hunt failed");
    expect(d.code).toBe("Error");
  });

  it("handles a non-Error throw", () => {
    const d = detail("boom");
    expect(d.code).toBe("UnknownError");
    expect(d.message).toBeTruthy();
  });

  it("truncates a very long message", () => {
    const d = detail(err("x".repeat(2000)));
    expect(d.message.length).toBeLessThanOrEqual(400);
  });
});
