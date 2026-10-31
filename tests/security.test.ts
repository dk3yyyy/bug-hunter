import { describe, expect, it } from "vitest";
import { scrubSecrets } from "../src/security";

describe("scrubSecrets", () => {
  it("redacts Google AI keys", () => {
    const out = scrubSecrets("key=AIzaSyA0abcdefghijklmnopqrstuvwxyz1234 here");
    expect(out).not.toContain("AIzaSyA");
    expect(out).toContain("[redacted]");
  });

  it("redacts OpenAI and GitHub tokens", () => {
    const s = "sk-abcdefghijklmnopqrstuvwxyz123456 ghp_abcdefghijklmnopqrstuvwxyz1234";
    const out = scrubSecrets(s);
    expect(out).not.toContain("sk-");
    expect(out).not.toContain("ghp_");
  });

  it("redacts fine-grained PATs and PEM blocks", () => {
    const pat = "github_pat_abcdefghijklmnopqrstuvwxyz_1234567890";
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----";
    const out = scrubSecrets(`${pat}\n${pem}`);
    expect(out).not.toContain("github_pat_");
    expect(out).not.toContain("PRIVATE KEY");
    expect(out).toContain("[redacted]");
  });

  it("leaves normal text alone", () => {
    const text = "const x = 1; // a normal comment about keys";
    expect(scrubSecrets(text)).toBe(text);
  });
});
