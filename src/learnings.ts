// Reviewer corrections ("learnings") — pure helpers.
//
// A maintainer who disagrees with a finding can reply on the review thread with
// `@bughunter wrong: <why>` (or `learn <rule>`). That text is stored per repo and
// injected into later reviews as an untrusted REVIEWER CORRECTIONS block, so the
// same false positive stops coming back. Everything here is pure: no store, no
// network, no env — the server owns persistence.

export interface Learning {
  id: string;
  /** owner/repo, lowercased. */
  repo: string;
  /** The instruction text, already normalized and capped. */
  text: string;
  source: "reply" | "manual";
  /** Link to the comment the learning came from, when known. */
  sourceUrl?: string;
  createdAt: string;
}

/** Keep the prompt block small and the dashboard readable. */
export const MAX_LEARNINGS_PER_REPO = 50;
export const MAX_LEARNING_CHARS = 300;

/** Collapse whitespace, strip the bot mention and a leading correction keyword. */
export function normalizeLearning(text: string, handle = ""): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (handle) {
    out = out.replace(new RegExp(`@${escapeRegExp(handle)}\\b`, "gi"), " ").trim();
  }
  out = out
    .replace(/^(?:wrong|incorrect|false positive|learn|remember|note)\b[\s:,-]*/i, "")
    .replace(/^(?:that['’]?s?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Drop a trailing "please" / "thanks" nicety so the stored rule stays terse.
  out = out
    .replace(/\s*(?:please|thanks|thank you)[.!]*$/i, "")
    .replace(/[,;:.!?\s]+$/, "")
    .trim();
  return out.slice(0, MAX_LEARNING_CHARS).trim();
}

/** Dedupe key: case/space/punctuation-insensitive. */
export function learningKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Insert or replace a learning by key, newest first, capped. Returns a new array
 * (callers persist the result).
 */
export function upsertLearning(existing: Learning[], next: Learning): Learning[] {
  const key = learningKey(next.text);
  if (!key) return existing;
  const rest = existing.filter((l) => learningKey(l.text) !== key);
  return [next, ...rest]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_LEARNINGS_PER_REPO);
}

/**
 * Prompt-ready block. Newest first, `- ` bullets, hard char cap so a repo full
 * of corrections cannot crowd out the diff. Returns "(none)" when empty.
 */
export function formatLearnings(list: Learning[], maxChars = 2000): string {
  if (list.length === 0) return "(none)";
  const lines: string[] = [];
  let used = 0;
  for (const l of list) {
    const line = `- ${l.text}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

export type LearningCommand =
  | { kind: "learn"; text: string }
  | { kind: "forget"; id: string }
  | { kind: "list" }
  | { kind: "none" };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a learning command out of a comment body.
 *
 * - `@handle wrong: <why>` / `@handle learn <rule>` / `@handle stop flagging <x>`
 * - `@handle forget <id>`
 * - `@handle learnings`
 *
 * Returns { kind: "none" } when the comment is not about learnings (so the
 * existing hunt/seance/spellbook parser can take it).
 */
export function parseLearningCommand(body: string, handle: string): LearningCommand {
  const mention = new RegExp(`@${escapeRegExp(handle)}\\b`, "i");
  const m = body.match(mention);
  if (!m) return { kind: "none" };
  const after = body.slice((m.index ?? 0) + m[0].length).trim();
  const lower = after.toLowerCase();

  if (/^(?:learnings?|lessons?)\b/.test(lower)) return { kind: "list" };

  const forget = after.match(/^forget\s+([\w-]+)\s*$/i);
  if (forget) return { kind: "forget", id: forget[1] };

  // `learn` / `wrong` / `stop flagging` / `false positive` — keep the rest.
  const learn = after.match(
    /^(?:learn|wrong|incorrect|false[- ]positive|stop flagging|don'?t flag|do not flag)\b[\s:,-]*(.*)$/is,
  );
  if (learn) {
    const text = normalizeLearning(learn[1] ?? "", handle);
    return text ? { kind: "learn", text } : { kind: "none" };
  }

  return { kind: "none" };
}
