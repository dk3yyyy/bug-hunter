import { describe, expect, it } from "vitest";
import {
  formatLearnings,
  learningKey,
  MAX_LEARNINGS_PER_REPO,
  normalizeLearning,
  parseLearningCommand,
  upsertLearning,
  type Learning,
} from "../src/learnings";

function learning(id: string, text: string, createdAt = "2026-01-01T00:00:00.000Z"): Learning {
  return { id, repo: "acme/app", text, source: "reply", createdAt };
}

describe("normalizeLearning", () => {
  it("strips the mention and the correction keyword", () => {
    expect(normalizeLearning("@bughunter wrong: this is validated upstream", "bughunter")).toBe(
      "this is validated upstream",
    );
  });

  it("collapses whitespace and drops trailing niceties", () => {
    expect(normalizeLearning("  learn   use  zod   here, please  ", "bughunter")).toBe(
      "use zod here",
    );
  });

  it("caps the text length", () => {
    expect(normalizeLearning("x".repeat(500), "bughunter").length).toBeLessThanOrEqual(300);
  });
});

describe("learningKey", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(learningKey("Use `Zod` here!")).toBe(learningKey("use zod   here"));
  });
});

describe("upsertLearning", () => {
  it("replaces an existing learning with the same key", () => {
    const a = learning("l1", "Don't flag console.log");
    const b = learning("l2", "dont flag console log", "2026-02-01T00:00:00.000Z");
    const out = upsertLearning([a], b);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("l2");
  });

  it("keeps the newest first and caps the list", () => {
    let list: Learning[] = [];
    for (let i = 0; i < MAX_LEARNINGS_PER_REPO + 5; i++) {
      list = upsertLearning(list, learning(`l${i}`, `rule number ${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:0${i % 10}.000Z`));
    }
    expect(list).toHaveLength(MAX_LEARNINGS_PER_REPO);
  });

  it("ignores empty text", () => {
    expect(upsertLearning([], learning("l1", "   "))).toEqual([]);
  });
});

describe("formatLearnings", () => {
  it("returns (none) when empty", () => {
    expect(formatLearnings([])).toBe("(none)");
  });

  it("renders bullets and respects the char cap", () => {
    const list = [learning("l1", "a".repeat(100)), learning("l2", "b".repeat(100))];
    const out = formatLearnings(list, 120);
    expect(out).toContain("- aaa");
    expect(out).not.toContain("- bbb");
  });
});

describe("parseLearningCommand", () => {
  it("parses learn / wrong / stop flagging", () => {
    expect(parseLearningCommand("@bughunter wrong: validated upstream", "bughunter")).toEqual({
      kind: "learn",
      text: "validated upstream",
    });
    expect(parseLearningCommand("@bughunter learn use zod", "bughunter")).toEqual({
      kind: "learn",
      text: "use zod",
    });
    expect(parseLearningCommand("@bughunter stop flagging TODOs", "bughunter")).toEqual({
      kind: "learn",
      text: "TODOs",
    });
  });

  it("parses forget and list", () => {
    expect(parseLearningCommand("@bughunter forget l_ab12cd34", "bughunter")).toEqual({
      kind: "forget",
      id: "l_ab12cd34",
    });
    expect(parseLearningCommand("@bughunter learnings", "bughunter")).toEqual({ kind: "list" });
  });

  it("returns none for hunt, spellbook and plain comments", () => {
    expect(parseLearningCommand("@bughunter hunt", "bughunter")).toEqual({ kind: "none" });
    expect(parseLearningCommand("looks good to me", "bughunter")).toEqual({ kind: "none" });
    expect(parseLearningCommand("@bughunter wrong", "bughunter")).toEqual({ kind: "none" });
  });

  it("is case-insensitive on the handle", () => {
    expect(parseLearningCommand("@BugHunter learn x", "bughunter")).toEqual({
      kind: "learn",
      text: "x",
    });
  });
});
