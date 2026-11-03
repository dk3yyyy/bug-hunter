// Regression guard: GitHub's commit-status API returns 422 "doesn't accept
// 4-byte Unicode" for BOTH context and description. The voice strings are full of
// astral emoji (🎃 in the context, 🔦 pending, 💀 in a level title), so every
// status update failed silently — setCommitStatus swallows the error.
import { describe, expect, it } from "vitest";
import { errorStatus, hauntingToStatus, pendingStatus, statusSafeText } from "../src/render/status";

/** Any code point above the BMP is rejected by GitHub. */
const ASTRAL = /[\u{10000}-\u{10FFFF}]/u;

const zeroCounts = { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 };
const levels = ["possessed", "haunted", "restless", "whispers", "clear"] as const;

describe("statusSafeText", () => {
  it("removes astral code points (emoji) and their variation selectors", () => {
    expect(statusSafeText("Bug Hunter 🎃")).toBe("Bug Hunter");
    expect(statusSafeText("🔦 The hunt has begun…")).toBe("The hunt has begun…");
    // Astral + VS16 leaves no dangling selector behind.
    expect(statusSafeText("🌫️ fog")).toBe("fog");
  });

  it("collapses the gap left behind and trims", () => {
    expect(statusSafeText("💀 Possessed:  do not merge")).toBe("Possessed: do not merge");
    expect(statusSafeText("🎃")).toBe("");
  });

  it("leaves plain text and BMP symbols alone", () => {
    expect(statusSafeText("Bug Hunter")).toBe("Bug Hunter");
    expect(statusSafeText("The hunt has begun…")).toBe("The hunt has begun…");
  });
});

describe("commit statuses are API-safe", () => {
  it("never puts 4-byte Unicode in context or description", () => {
    for (const level of levels) {
      const s = hauntingToStatus(level, { critical: 1, high: 2, medium: 3, low: 4, nitpick: 5 });
      expect(ASTRAL.test(s.context)).toBe(false);
      expect(ASTRAL.test(s.description)).toBe(false);
      expect(s.context.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }

    for (const s of [pendingStatus(), errorStatus()]) {
      expect(ASTRAL.test(s.context)).toBe(false);
      expect(ASTRAL.test(s.description)).toBe(false);
      expect(s.context.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps the 140-character description cap after stripping", () => {
    const s = hauntingToStatus("possessed", {
      critical: 9999,
      high: 9999,
      medium: 9999,
      low: 9999,
      nitpick: 0,
    });
    expect(s.description.length).toBeLessThanOrEqual(140);
  });

  it("uses a stable ASCII context so the same check stays grouped", () => {
    expect(hauntingToStatus("clear", zeroCounts).context).toBe(pendingStatus().context);
    expect(hauntingToStatus("clear", zeroCounts).context).toBe("Bug Hunter");
  });
});
