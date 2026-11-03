// Commit-status / check-run text. Context, pending, done and error strings
// come from voice.json; the counts summary ("1 demon, 2 ghosts") is computed
// here and filled into the voice "done" template.
import type { HauntingLevel, HuntCounts, SeverityT } from "../types";
import { loadVoice } from "../voice";
import { fillTemplate } from "../prompts";

// Singular/plural creature nouns, lowercase, for the counts suffix.
const NOUN: Record<SeverityT, [string, string]> = {
  critical: ["demon", "demons"],
  high: ["ghost", "ghosts"],
  medium: ["bat", "bats"],
  low: ["cobweb", "cobwebs"],
  nitpick: ["candy wrapper", "candy wrappers"],
};

/**
 * GitHub's commit-status API rejects 4-byte (astral) Unicode in BOTH `context`
 * and `description` with a 422 "doesn't accept 4-byte Unicode", so the pumpkin in
 * the context and the emoji in every status line silently broke every status
 * update. Strip them here; the Séance comment body is a different API and keeps
 * its emoji.
 */
export function statusSafeText(s: string): string {
  return s
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/\uFE0F/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Nitpicks are hidden by default, so they never appear in the status counts.
const SUFFIX_ORDER: readonly SeverityT[] = ["critical", "high", "medium", "low"];

export function countsSummary(counts: HuntCounts): string {
  const parts: string[] = [];
  for (const s of SUFFIX_ORDER) {
    const n = counts[s];
    if (n > 0) {
      parts.push(`${n} ${n === 1 ? NOUN[s][0] : NOUN[s][1]}`);
    }
  }
  return parts.join(", ");
}

export function hauntingToStatus(
  level: HauntingLevel,
  counts: HuntCounts,
): { context: string; state: "success" | "failure"; description: string } {
  const v = loadVoice();
  const summary = countsSummary(counts);

  let description = fillTemplate(v.status.done, {
    level_emoji: v.haunting_levels[level].emoji,
    level_title: v.haunting_levels[level].title,
    counts_summary: summary,
  });
  if (summary.length === 0) {
    // No counts: "🌕 Title ()" -> "🌕 Title".
    description = `${v.haunting_levels[level].emoji} ${v.haunting_levels[level].title}`;
  }

  // GitHub rejects 4-byte Unicode here too, so the level emoji has to go before
  // the length check (the ellipsis counts toward the 140-character cap).
  description = statusSafeText(description);

  // Commit-status descriptions are capped at 140 characters.
  if (description.length > 140) description = description.slice(0, 139) + "…";

  return {
    context: statusSafeText(v.status.context),
    // Policy: possessed (critical / possession) and haunted (high findings)
    // block the PR red; lesser hauntings stay green. Commit statuses have no
    // "neutral", so voice "neutral" maps to success with the haunted title in
    // the description carrying the warning.
    state: level === "possessed" || level === "haunted" ? "failure" : "success",
    description,
  };
}

/** Pending status text from voice. */
export function pendingStatus(): { context: string; state: "pending"; description: string } {
  const v = loadVoice();
  return {
    context: statusSafeText(v.status.context),
    state: "pending",
    description: statusSafeText(v.status.pending),
  };
}

/** Error status text from voice: a failed hunt must never leave the PR stuck on "pending". */
export function errorStatus(): { context: string; state: "error"; description: string } {
  const v = loadVoice();
  return {
    context: statusSafeText(v.status.context),
    state: "error",
    description: statusSafeText(v.status.error).slice(0, 140),
  };
}

/**
 * Used when a PR contains no reviewable files (lockfile-only, generated, binary,
 * pure rename). Deliberately NOT the "all clear" copy: claiming the hunter
 * "searched every changed line" when it searched none is a false negative.
 */
export function nothingToHuntStatus(): {
  context: string;
  state: "success";
  description: string;
} {
  const v = loadVoice();
  return {
    context: statusSafeText(v.status.context),
    state: "success",
    description: "Nothing to hunt: no reviewable files",
  };
}
