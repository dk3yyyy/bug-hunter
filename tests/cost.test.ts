import { describe, expect, it } from "vitest";
import {
  capMessage,
  costOf,
  formatTokens,
  formatUsd,
  overCap,
  priceFor,
  sumUsage,
} from "../src/cost";

describe("priceFor", () => {
  it("prefers the longest prefix: flash-lite beats flash", () => {
    expect(priceFor("google", "gemini-2.5-flash-lite")).toEqual({
      inputPerM: 0.1,
      outputPerM: 0.4,
      cachedInputPerM: 0.025,
    });
    expect(priceFor("google", "gemini-2.5-flash")?.inputPerM).toBe(0.3);
    // Dated/preview suffixes still resolve to their family.
    expect(priceFor("google", "gemini-2.5-flash-preview-05-20")?.outputPerM).toBe(2.5);
    expect(priceFor("google", "gemini-2.5-flash-lite-preview-06-17")?.inputPerM).toBe(0.1);
  });

  it("matches the documented Google families", () => {
    expect(priceFor("google", "gemini-2.5-pro")).toEqual({
      inputPerM: 1.25,
      outputPerM: 10,
      cachedInputPerM: 0.31,
    });
    expect(priceFor("google", "gemini-2.0-flash")?.inputPerM).toBe(0.3);
    expect(priceFor("google", "gemini-flash-latest")?.outputPerM).toBe(2.5);
  });

  it("matches the Anthropic families", () => {
    expect(priceFor("anthropic", "claude-sonnet-4-5")?.outputPerM).toBe(15);
    expect(priceFor("anthropic", "claude-3-7-sonnet-latest")?.inputPerM).toBe(3);
    expect(priceFor("anthropic", "claude-opus-4-1")?.outputPerM).toBe(75);
    expect(priceFor("anthropic", "claude-haiku-4-5")?.inputPerM).toBe(1);
  });

  it("does not let gpt-5 or gpt-4o shadow their mini/nano variants", () => {
    expect(priceFor("openai", "gpt-5")?.inputPerM).toBe(1.25);
    expect(priceFor("openai", "gpt-5-mini")?.inputPerM).toBe(0.25);
    expect(priceFor("openai", "gpt-5-nano")?.outputPerM).toBe(0.4);
    expect(priceFor("openai", "gpt-4o")?.inputPerM).toBe(2.5);
    expect(priceFor("openai", "gpt-4o-mini")?.inputPerM).toBe(0.15);
    expect(priceFor("openai", "o3")?.outputPerM).toBe(8);
  });

  it("matches the DeepSeek models", () => {
    expect(priceFor("deepseek", "deepseek-chat")).toEqual({
      inputPerM: 0.28,
      outputPerM: 0.42,
      cachedInputPerM: 0.028,
    });
    expect(priceFor("deepseek", "deepseek-reasoner")?.outputPerM).toBe(0.42);
  });

  it("mirrors the same families for router and proxy providers", () => {
    expect(priceFor("openrouter", "anthropic/claude-sonnet-4-5")?.inputPerM).toBe(3);
    expect(priceFor("openrouter", "google/gemini-2.5-flash")?.inputPerM).toBe(0.3);
    expect(priceFor("opencode", "openai/gpt-5-mini")?.outputPerM).toBe(2);
    expect(priceFor("openai-compatible", "deepseek/deepseek-chat-v3:free")?.inputPerM).toBe(0.28);
  });

  it("strips provider:model and provider/model prefixes", () => {
    expect(priceFor("anthropic", "anthropic:claude-opus-4-1")?.outputPerM).toBe(75);
    expect(priceFor("openrouter", "openrouter:google/gemini-2.5-flash")?.outputPerM).toBe(2.5);
  });

  it("is case-insensitive", () => {
    expect(priceFor("openai", "GPT-4O-MINI")?.inputPerM).toBe(0.15);
    expect(priceFor("google", "Gemini-2.5-Pro")?.outputPerM).toBe(10);
  });

  it("returns null for unknown models", () => {
    expect(priceFor("google", "some-local-model")).toBeNull();
    expect(priceFor("openrouter", "meta-llama/llama-3.3-70b-instruct")).toBeNull();
    expect(priceFor("openai", "")).toBeNull();
    // deepseek-v4-pro is served by OpenCode but has no public list price here.
    expect(priceFor("opencode", "deepseek-v4-pro")).toBeNull();
  });

  it("treats ollama as free regardless of the model id", () => {
    expect(priceFor("ollama", "qwen2.5-coder:14b")).toEqual({
      inputPerM: 0,
      outputPerM: 0,
      cachedInputPerM: 0,
    });
  });
});

describe("costOf", () => {
  it("prices 1M input + 1M output at the list rate", () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "openai", "gpt-4o")).toBe(
      12.5,
    );
    expect(
      costOf({ inputTokens: 1_000_000, outputTokens: 0 }, "anthropic", "claude-sonnet-4-5"),
    ).toBeCloseTo(3, 10);
  });

  it("handles fractional millions", () => {
    // 1,000 * 0.30/M + 500 * 2.50/M
    expect(
      costOf({ inputTokens: 1_000, outputTokens: 500 }, "google", "gemini-2.5-flash"),
    ).toBeCloseTo(0.00155, 10);
  });

  it("prices cached input at the cache-read rate", () => {
    expect(
      costOf(
        { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 },
        "google",
        "gemini-2.5-pro",
      ),
    ).toBeCloseTo(0.31, 10);

    // 750k uncached at 1.25 + 250k cached at 0.31
    expect(
      costOf(
        { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 250_000 },
        "google",
        "gemini-2.5-pro",
      ),
    ).toBeCloseTo(1.015, 10);
  });

  it("clamps cached tokens to the reported input", () => {
    expect(
      costOf(
        { inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 5_000 },
        "google",
        "gemini-2.5-pro",
      ),
    ).toBeCloseTo(0.00031, 10);
  });

  it("returns 0 for ollama", () => {
    expect(
      costOf({ inputTokens: 50_000, outputTokens: 8_000 }, "ollama", "qwen2.5-coder:14b"),
    ).toBe(0);
  });

  it("returns null for an unknown model", () => {
    expect(
      costOf({ inputTokens: 1_000, outputTokens: 1_000 }, "google", "mystery-model"),
    ).toBeNull();
  });
});

describe("sumUsage", () => {
  it("adds both token counts and cached tokens", () => {
    expect(
      sumUsage(
        { inputTokens: 100, outputTokens: 20, cachedInputTokens: 30 },
        { inputTokens: 50, outputTokens: 5, cachedInputTokens: 10 },
      ),
    ).toEqual({ inputTokens: 150, outputTokens: 25, cachedInputTokens: 40 });
  });

  it("keeps cached tokens when only one side reports them", () => {
    expect(
      sumUsage(
        { inputTokens: 100, outputTokens: 20 },
        { inputTokens: 50, outputTokens: 5, cachedInputTokens: 5 },
      ),
    ).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      cachedInputTokens: 5,
    });
  });

  it("omits cached tokens when neither side reports them", () => {
    expect(
      sumUsage({ inputTokens: 1, outputTokens: 2 }, { inputTokens: 3, outputTokens: 4 }),
    ).not.toHaveProperty("cachedInputTokens");
  });
});

describe("formatUsd", () => {
  it("uses four decimals below one cent", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.00001)).toBe("$0.0000");
  });

  it("uses two decimals at or above one cent", () => {
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(1.2345)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("formatTokens", () => {
  it("groups thousands and abbreviates millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_345)).toBe("12,345");
    expect(formatTokens(999_999)).toBe("999,999");
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });
});

describe("overCap", () => {
  it("refuses at or above the cap", () => {
    expect(overCap(5, 5)).toBe(true);
    expect(overCap(5.01, 5)).toBe(true);
    expect(overCap(4.99, 5)).toBe(false);
  });

  it("treats a non-positive cap as unlimited", () => {
    expect(overCap(0, 0)).toBe(false);
    expect(overCap(100, 0)).toBe(false);
    expect(overCap(100, -1)).toBe(false);
  });
});

describe("capMessage", () => {
  it("names the spend, the cap, and the env var to raise", () => {
    expect(capMessage(5, 5)).toBe(
      "Monthly budget reached ($5.00 of $5.00). Raise MONTHLY_COST_CAP_USD or wait for next month.",
    );
    expect(capMessage(5.5, 5)).toContain("$5.50 of $5.00");
  });
});
