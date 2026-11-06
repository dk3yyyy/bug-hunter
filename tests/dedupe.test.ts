import { describe, expect, it } from "vitest";
import { hasNearbyComment } from "../src/github/api";

describe("hasNearbyComment (re-run dedupe)", () => {
  it("blocks the same line and ±1 drift", () => {
    const positions = new Map([["src/a.ts", [20]]]);
    expect(hasNearbyComment(positions, "src/a.ts", 20)).toBe(true);
    expect(hasNearbyComment(positions, "src/a.ts", 19)).toBe(true);
    expect(hasNearbyComment(positions, "src/a.ts", 21)).toBe(true);
  });

  it("allows further lines, other files, and empty maps", () => {
    const positions = new Map([["src/a.ts", [20]]]);
    expect(hasNearbyComment(positions, "src/a.ts", 23)).toBe(false);
    expect(hasNearbyComment(positions, "src/b.ts", 20)).toBe(false);
    expect(hasNearbyComment(new Map(), "src/a.ts", 1)).toBe(false);
  });
});
