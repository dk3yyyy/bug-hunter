// Prompt input budget (SPEC §11 step 5: cap context at ~30k tokens, chars / 3.5)
// and the per-PR hunt rate limit (SPEC §17: max 10 hunts per PR per hour).
// Pure functions: no env, no network — fully unit-testable.

/** ~30k tokens at 3.5 chars/token. Shared by the annotated diff and the context. */
export const INPUT_BUDGET_CHARS = 105_000;

/** The diff is what gets reviewed, so it gets most of the budget; context is trimmed first. */
export const MIN_CONTEXT_CHARS = 15_000;

const CONTEXT_TRUNCATION_MARKER = "\n...[CONTEXT TRUNCATED]";

/**
 * Split the input budget between the annotated diff and the context.
 * Returns the max chars the diff may use (pass to annotateDiff) and a
 * function that trims context to whatever the diff left over.
 */
export function planBudget(
  diffChars: number,
  budget: number = INPUT_BUDGET_CHARS,
): { diffMaxChars: number; contextMaxChars: number } {
  const diffMaxChars = Math.min(diffChars, budget - MIN_CONTEXT_CHARS);
  const contextMaxChars = Math.max(MIN_CONTEXT_CHARS, budget - diffMaxChars);
  return { diffMaxChars, contextMaxChars };
}

/** Trim context text to `maxChars`, cutting at a line boundary when possible. */
export function trimContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) return context;
  const keep = Math.max(0, maxChars - CONTEXT_TRUNCATION_MARKER.length);
  const cut = context.slice(0, keep);
  const lastNewline = cut.lastIndexOf("\n");
  return (lastNewline > keep * 0.8 ? cut.slice(0, lastNewline) : cut) + CONTEXT_TRUNCATION_MARKER;
}

/** Sliding-window rate limiter keyed by PR ("owner/repo#123"). */
export class HuntRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow = 10,
    private readonly windowMs = 60 * 60 * 1000,
  ) {}

  /** Record a hunt for `key` if allowed. Returns false when the PR is over its limit. */
  tryAcquire(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** Bounded set for webhook delivery-id dedupe (the old Set grew forever). */
export class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly max = 5000) {}

  has(v: string): boolean {
    return this.items.has(v);
  }

  add(v: string): void {
    this.items.add(v);
    if (this.items.size > this.max) {
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
  }
}
