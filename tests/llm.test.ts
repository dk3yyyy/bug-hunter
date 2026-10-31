// Unit tests for the pure LLM-layer helpers (SPEC §10).
// No network access; only isRetryable, backoffMs and repairJson are exercised.

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { isRetryable, backoffMs, repairJson } from "../src/llm/structured";

describe("isRetryable", () => {
  it("returns true for HTTP 429", () => {
    expect(isRetryable({ statusCode: 429 })).toBe(true);
  });

  it("returns true for HTTP 503", () => {
    expect(isRetryable({ statusCode: 503 })).toBe(true);
  });

  it("returns true for an 'overloaded' message", () => {
    expect(isRetryable({ message: "model is overloaded" })).toBe(true);
  });

  it("returns true for a 'rate limit' message", () => {
    expect(isRetryable({ message: "rate limit exceeded" })).toBe(true);
  });

  it("returns false for HTTP 400", () => {
    expect(isRetryable({ statusCode: 400 })).toBe(false);
  });

  it("returns false for HTTP 401", () => {
    expect(isRetryable({ statusCode: 401 })).toBe(false);
  });

  it("returns false for a TypeError", () => {
    expect(isRetryable(new TypeError("boom"))).toBe(false);
  });

  it("returns false for a plain object with no status/message", () => {
    expect(isRetryable({})).toBe(false);
  });
});

describe("backoffMs", () => {
  it("never exceeds the 8000ms cap", () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(backoffMs(attempt)).toBeLessThanOrEqual(8000);
    }
  });

  it("stays within [base, base+250] (or the cap) for every attempt", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const base = 250 * 2 ** attempt;
      for (let i = 0; i < 100; i++) {
        const v = backoffMs(attempt);
        expect(v).toBeGreaterThanOrEqual(Math.min(base, 8000));
        expect(v).toBeLessThanOrEqual(Math.min(base + 250, 8000));
      }
    }
  });

  it("is non-decreasing when jitter is fixed (monotonic-ish)", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      let previous = -1;
      for (let attempt = 0; attempt < 6; attempt++) {
        const v = backoffMs(attempt);
        expect(v).toBeGreaterThanOrEqual(previous);
        previous = v;
      }
    } finally {
      random.mockRestore();
    }
  });
});

describe("repairJson", () => {
  const schema = z.object({ count: z.number() });

  it("parses fenced JSON", () => {
    expect(repairJson(schema, '```json\n{"count": 3}\n```')).toEqual({
      ok: true,
      value: { count: 3 },
    });
  });

  it("parses bare JSON with leading prose", () => {
    expect(repairJson(schema, 'Sure! Here you go:\n{"count": 5}')).toEqual({
      ok: true,
      value: { count: 5 },
    });
  });

  it("parses a valid bare object", () => {
    expect(repairJson(schema, '{"count": 7}')).toEqual({ ok: true, value: { count: 7 } });
  });

  it("returns ok:false for invalid JSON", () => {
    const result = repairJson(schema, '{"count": }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok:false for a schema mismatch", () => {
    const result = repairJson(schema, '{"count": "not a number"}');
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when no JSON object is present", () => {
    const result = repairJson(schema, "no json here at all");
    expect(result.ok).toBe(false);
  });
});
