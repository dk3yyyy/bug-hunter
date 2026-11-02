// Unit tests for the public-URL rule behind the "Connect a repo" button.
// A webhook only works if GitHub can reach the server, so localhost/private
// addresses must be rejected before we ask GitHub to create anything.
import { describe, expect, it } from "vitest";
import { normalizePublicUrl, webhookUrlFor } from "../src/connect";

describe("normalizePublicUrl", () => {
  it("accepts a public tunnel URL and returns its origin", () => {
    expect(normalizePublicUrl("https://abc123.ngrok-free.app/")).toEqual({
      ok: true,
      url: "https://abc123.ngrok-free.app",
    });
  });

  it("drops a pasted path so /webhooks/github is appended to the origin", () => {
    expect(normalizePublicUrl("https://bh.example.com/connect?x=1")).toEqual({
      ok: true,
      url: "https://bh.example.com",
    });
  });

  it("accepts http for a tunnel and normalises the origin", () => {
    expect(normalizePublicUrl("http://bh.example.com:8080")).toEqual({
      ok: true,
      url: "http://bh.example.com:8080",
    });
  });

  it("rejects an empty value with the PUBLIC_URL hint", () => {
    const res = normalizePublicUrl("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("PUBLIC_URL");
  });

  it("rejects non-URL input", () => {
    expect(normalizePublicUrl("not a url").ok).toBe(false);
  });

  it("rejects unsupported schemes", () => {
    expect(normalizePublicUrl("ftp://example.com").ok).toBe(false);
  });

  it("rejects localhost, loopback, private and link-local hosts", () => {
    for (const host of [
      "http://localhost:3000",
      "http://app.localhost",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
      "http://10.0.0.2",
      "http://192.168.1.10",
      "http://172.16.0.1",
      "http://169.254.1.1",
      "http://[::1]:3000",
      "http://printer.local",
    ]) {
      expect(normalizePublicUrl(host).ok, host).toBe(false);
    }
  });

  it("does not over-reject public addresses near private ranges", () => {
    expect(normalizePublicUrl("http://172.32.0.1").ok).toBe(true);
    expect(normalizePublicUrl("https://8.8.8.8").ok).toBe(true);
  });
});

describe("webhookUrlFor", () => {
  it("appends /webhooks/github to a tunnel origin", () => {
    expect(webhookUrlFor("https://abc123.ngrok-free.app/")).toEqual({
      ok: true,
      url: "https://abc123.ngrok-free.app/webhooks/github",
    });
  });

  it("keeps the smee channel path (smee forwards it to the local target)", () => {
    expect(webhookUrlFor("https://smee.io/AbCd1234")).toEqual({
      ok: true,
      url: "https://smee.io/AbCd1234",
    });
  });

  it("rejects a bare smee.io URL with instructions", () => {
    const res = webhookUrlFor("https://smee.io");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("smee.io/<your-channel>");
  });

  it("does not append the path twice when the full webhook URL is pasted", () => {
    expect(webhookUrlFor("https://bh.example.com/webhooks/github")).toEqual({
      ok: true,
      url: "https://bh.example.com/webhooks/github",
    });
  });

  it("rejects a private host before building a webhook URL", () => {
    expect(webhookUrlFor("http://localhost:3000").ok).toBe(false);
  });
});
