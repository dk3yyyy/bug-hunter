// Token accounting and USD cost estimation (SPEC §12 cost controls).
// Pure functions: no env, no network — fully unit-testable. Prices are rough
// public list prices as of 2026-11; see docs/COSTS.md for caveats.

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached input tokens, when the provider reports them. */
  cachedInputTokens?: number;
}

// Mirrors src/llm/config.ts. Kept as a literal union here so this module stays
// dependency-free (and so the price tables below can exhaustively switch on it).
export type LlmProvider =
  | "google"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "opencode"
  | "deepseek"
  | "ollama"
  | "openai-compatible";

export interface PriceRow {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
}

interface PriceEntry {
  /** Lowercase prefix of the bare model id (after any "provider/" prefix). */
  readonly prefix: string;
  readonly price: PriceRow;
}

// USD per 1M tokens. `cachedInputPerM` is the provider's cache-read rate when it
// publishes one; when absent, cached input is charged at the full input rate.
const GOOGLE_PRICES: readonly PriceEntry[] = [
  { prefix: "gemini-2.5-pro", price: { inputPerM: 1.25, outputPerM: 10, cachedInputPerM: 0.31 } },
  {
    prefix: "gemini-2.5-flash-lite",
    price: { inputPerM: 0.1, outputPerM: 0.4, cachedInputPerM: 0.025 },
  },
  {
    prefix: "gemini-2.5-flash",
    price: { inputPerM: 0.3, outputPerM: 2.5, cachedInputPerM: 0.075 },
  },
  {
    prefix: "gemini-2.0-flash",
    price: { inputPerM: 0.3, outputPerM: 2.5, cachedInputPerM: 0.075 },
  },
  // Alias used by the default GEMINI_MODEL_* config; resolves to 2.5 Flash.
  {
    prefix: "gemini-flash-latest",
    price: { inputPerM: 0.3, outputPerM: 2.5, cachedInputPerM: 0.075 },
  },
];

// Anthropic bills cache reads at ~10% of the input rate.
const ANTHROPIC_PRICES: readonly PriceEntry[] = [
  { prefix: "claude-opus", price: { inputPerM: 15, outputPerM: 75, cachedInputPerM: 1.5 } },
  { prefix: "claude-sonnet-4", price: { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 } },
  { prefix: "claude-3-7-sonnet", price: { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 } },
  { prefix: "claude-haiku", price: { inputPerM: 1, outputPerM: 5, cachedInputPerM: 0.1 } },
];

const OPENAI_PRICES: readonly PriceEntry[] = [
  { prefix: "gpt-5-mini", price: { inputPerM: 0.25, outputPerM: 2, cachedInputPerM: 0.025 } },
  { prefix: "gpt-5-nano", price: { inputPerM: 0.05, outputPerM: 0.4, cachedInputPerM: 0.005 } },
  { prefix: "gpt-5", price: { inputPerM: 1.25, outputPerM: 10, cachedInputPerM: 0.125 } },
  { prefix: "gpt-4o-mini", price: { inputPerM: 0.15, outputPerM: 0.6, cachedInputPerM: 0.075 } },
  { prefix: "gpt-4o", price: { inputPerM: 2.5, outputPerM: 10, cachedInputPerM: 1.25 } },
  { prefix: "o3", price: { inputPerM: 2, outputPerM: 8, cachedInputPerM: 0.5 } },
];

// DeepSeek's cache hit rate is ~10% of the cache-miss (input) rate.
const DEEPSEEK_PRICES: readonly PriceEntry[] = [
  {
    prefix: "deepseek-reasoner",
    price: { inputPerM: 0.28, outputPerM: 0.42, cachedInputPerM: 0.028 },
  },
  { prefix: "deepseek-chat", price: { inputPerM: 0.28, outputPerM: 0.42, cachedInputPerM: 0.028 } },
];

/**
 * Aggregators/routers and custom OpenAI-compatible endpoints can serve any of
 * the families above, so match the model id against all of them.
 */
const MIRRORED_PRICES: readonly PriceEntry[] = [
  ...OPENAI_PRICES,
  ...ANTHROPIC_PRICES,
  ...GOOGLE_PRICES,
  ...DEEPSEEK_PRICES,
];

/** Local inference has no per-token price. */
const OLLAMA_PRICE: PriceRow = { inputPerM: 0, outputPerM: 0, cachedInputPerM: 0 };

const PROVIDER_IDS: ReadonlySet<string> = new Set<string>([
  "google",
  "anthropic",
  "openai",
  "openrouter",
  "opencode",
  "deepseek",
  "ollama",
  "openai-compatible",
]);

function pricesFor(provider: LlmProvider): readonly PriceEntry[] {
  switch (provider) {
    case "google":
      return GOOGLE_PRICES;
    case "anthropic":
      return ANTHROPIC_PRICES;
    case "openai":
      return OPENAI_PRICES;
    case "deepseek":
      return DEEPSEEK_PRICES;
    case "openrouter":
    case "opencode":
    case "openai-compatible":
      return MIRRORED_PRICES;
    case "ollama":
      return [];
  }
}

/**
 * Strip a `provider:` or `provider/` prefix (e.g. `anthropic/claude-sonnet-4-5`,
 * `openrouter:google/gemini-2.5-flash`). Colon suffixes like OpenRouter's
 * `:free` are preserved because the part before them is not a provider id.
 */
function bareModelId(model: string): string {
  let id = model.trim().toLowerCase();
  const colon = id.indexOf(":");
  if (colon > 0 && PROVIDER_IDS.has(id.slice(0, colon))) id = id.slice(colon + 1);
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

/** USD price for a model id (provider:model or bare model). Returns null when unknown. */
export function priceFor(provider: LlmProvider, model: string): PriceRow | null {
  if (provider === "ollama") return OLLAMA_PRICE;
  const bare = bareModelId(model);
  if (!bare) return null;

  let best: PriceRow | null = null;
  let bestLength = 0;
  // Longest matching prefix wins: "gemini-2.5-flash-lite" beats "gemini-2.5-flash",
  // and "gpt-4o-mini" beats "gpt-4o".
  for (const entry of pricesFor(provider)) {
    if (entry.prefix.length > bestLength && bare.startsWith(entry.prefix)) {
      best = entry.price;
      bestLength = entry.prefix.length;
    }
  }
  return best;
}

/** Cost in USD. Returns null when the model is unknown (caller decides how to display that). */
export function costOf(usage: TokenUsage, provider: LlmProvider, model: string): number | null {
  const price = priceFor(provider, model);
  if (price === null) return null;

  const input = Math.max(0, usage.inputTokens);
  // `cachedInputTokens` is treated as a subset of `inputTokens` (the OpenAI and
  // Google convention). Anything beyond the reported input is ignored.
  const cached = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), input);
  const uncached = input - cached;
  const output = Math.max(0, usage.outputTokens);
  const cachedRate = price.cachedInputPerM ?? price.inputPerM;

  return (uncached * price.inputPerM + cached * cachedRate + output * price.outputPerM) / 1_000_000;
}

export function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const total: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined) {
    total.cachedInputTokens = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  }
  return total;
}

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "$0.0042" for sub-cent amounts, "$1.23" (or "$1,234.56") otherwise. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  const sign = usd < 0 ? "-" : "";
  const abs = Math.abs(usd);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  const [whole, fraction] = abs.toFixed(digits).split(".");
  return `${sign}$${groupDigits(whole ?? "0")}.${fraction ?? "00"}`;
}

/** "12,345" below a million, "1.2M" from a million up. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const value = Math.max(0, Math.round(n));
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return groupDigits(String(value));
}

/** Cap check. `capUsd` <= 0 means unlimited. */
export function overCap(spendUsd: number, capUsd: number): boolean {
  if (!(capUsd > 0)) return false;
  return spendUsd >= capUsd;
}

/** Human message for a refused hunt. */
export function capMessage(spendUsd: number, capUsd: number): string {
  return (
    `Monthly budget reached (${formatUsd(spendUsd)} of ${formatUsd(capUsd)}). ` +
    "Raise MONTHLY_COST_CAP_USD or wait for next month."
  );
}
