import { describe, expect, it } from "vitest";
import {
  isSelfEvent,
  isSkippedAuthor,
  prTarget,
  shouldHunt,
  parseCommand,
  type PrWebhookPayload,
} from "../src/github/webhooks";

function payload(overrides: Partial<PrWebhookPayload> = {}): PrWebhookPayload {
  return {
    action: "opened",
    pull_request: {
      number: 1,
      draft: false,
      state: "open",
      head: { sha: "abc" },
      base: { ref: "main" },
    },
    repository: { full_name: "me/repo", owner: { login: "me" }, name: "repo" },
    sender: { type: "User", login: "alice" },
    ...overrides,
  };
}

describe("webhook guards", () => {
  it("detects self events", () => {
    expect(isSelfEvent(payload({ sender: { type: "Bot", login: "x" } }))).toBe(true);
    expect(isSelfEvent(payload({ sender: { type: "User", login: "bug-hunter[bot]" } }))).toBe(true);
    expect(isSelfEvent(payload({ comment: { body: "thanks <!-- bughunter:seance -->" } }))).toBe(true);
    expect(isSelfEvent(payload())).toBe(false);
  });

  it("skips dependabot/renovate authors", () => {
    expect(isSkippedAuthor(payload({ sender: { type: "Bot", login: "dependabot[bot]" } }))).toBe(true);
    expect(isSkippedAuthor(payload({ sender: { type: "Bot", login: "renovate" } }))).toBe(true);
    expect(isSkippedAuthor(payload({ sender: { type: "User", login: "alice" } }))).toBe(false);
  });

  it("gates hunts", () => {
    expect(shouldHunt(payload()).ok).toBe(true);
    expect(shouldHunt(payload({ pull_request: { number: 1, draft: true, state: "open" } })).ok).toBe(false);
    expect(shouldHunt(payload({ pull_request: { number: 1, draft: false, state: "closed" } })).ok).toBe(false);
    expect(shouldHunt(payload({ pull_request: undefined })).ok).toBe(false);
  });

  it("extracts the target", () => {
    expect(prTarget(payload())).toEqual({ owner: "me", repo: "repo", prNumber: 1, headSha: "abc" });
    expect(prTarget(payload({ repository: undefined }))).toBeNull();
  });

  it("parses commands", () => {
    const b = (s: string) => parseCommand(s, "bughunter");
    expect(b("hey @bughunter hunt this").kind).toBe("hunt");
    expect(b("@bughunter review").kind).toBe("hunt");
    expect(b("@bughunter seance").kind).toBe("seance");
    expect(b("@bughunter spellbook").kind).toBe("spellbook");
    expect(b("@bughunter do a dance").kind).toBe("unknown");
    expect(b("no mention here").kind).toBe("none");
  });
});
