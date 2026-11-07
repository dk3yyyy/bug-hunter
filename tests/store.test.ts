import { describe, expect, it } from "vitest";
import { createHuntStore } from "../src/store";
import type { HuntRecord } from "../src/types";

function rec(id: string, finishedAt: string): HuntRecord {
  return {
    id,
    repo: "o/r",
    prNumber: 1,
    prTitle: "t",
    prUrl: "https://github.com/o/r/pull/1",
    hauntingLevel: "clear",
    counts: { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 },
    possessionAttempt: false,
    exorcised: 0,
    keptCount: 0,
    topFindings: [],
    finishedAt,
  };
}

describe("HuntStore (in-memory fallback)", () => {
  it("saves, gets, and lists newest first", async () => {
    const store = createHuntStore("");
    await store.save(rec("a", "2026-01-01T00:00:00.000Z"));
    await store.save(rec("b", "2026-01-02T00:00:00.000Z"));
    expect((await store.get("a"))?.id).toBe("a");
    expect((await store.get("missing"))).toBeNull();
    expect((await store.list(10)).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("overwrites an existing id rather than duplicating", async () => {
    const store = createHuntStore("");
    await store.save(rec("a", "2026-01-01T00:00:00.000Z"));
    await store.save({ ...rec("a", "2026-01-01T00:00:00.000Z"), keptCount: 3 });
    expect(await store.list(10)).toHaveLength(1);
    expect((await store.get("a"))?.keptCount).toBe(3);
  });
});

describe("HuntStore learnings", () => {
  const lrn = (id: string, text: string, createdAt = "2026-01-01T00:00:00.000Z") => ({
    id,
    repo: "Acme/App",
    text,
    source: "reply" as const,
    createdAt,
  });

  it("saves, lists newest first, and dedupes by text", async () => {
    const store = createHuntStore("");
    await store.saveLearning(lrn("l1", "Don't flag TODOs", "2026-01-01T00:00:00.000Z"));
    await store.saveLearning(lrn("l2", "Use zod for input", "2026-01-02T00:00:00.000Z"));
    await store.saveLearning(lrn("l3", "dont flag todos", "2026-01-03T00:00:00.000Z"));
    const list = await store.listLearnings("acme/app");
    expect(list.map((l) => l.id)).toEqual(["l3", "l2"]);
    expect(await store.recentLearnings(10)).toHaveLength(2);
  });

  it("scopes learnings per repo", async () => {
    const store = createHuntStore("");
    await store.saveLearning(lrn("l1", "repo A rule"));
    await store.saveLearning({ ...lrn("l2", "repo B rule"), repo: "other/repo" });
    expect((await store.listLearnings("acme/app")).map((l) => l.id)).toEqual(["l1"]);
    expect((await store.listLearnings("OTHER/REPO")).map((l) => l.id)).toEqual(["l2"]);
  });

  it("deletes a learning only from its own repo", async () => {
    const store = createHuntStore("");
    await store.saveLearning(lrn("l1", "rule"));
    expect(await store.deleteLearning("other/repo", "l1")).toBe(false);
    expect(await store.deleteLearning("acme/app", "l1")).toBe(true);
    expect(await store.listLearnings("acme/app")).toEqual([]);
  });
});
