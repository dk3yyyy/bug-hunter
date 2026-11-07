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
