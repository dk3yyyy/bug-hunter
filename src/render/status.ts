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

  // Commit-status descriptions are capped at 140 characters.
  if (description.length > 140) description = description.slice(0, 139) + "…";

  return {
    context: v.status.context,
    state: v.haunting_levels[level].status === "failure" ? "failure" : "success",
    description,
  };
}

/** Pending status text from voice. */
export function pendingStatus(): { context: string; state: "pending"; description: string } {
  const v = loadVoice();
  return { context: v.status.context, state: "pending", description: v.status.pending };
}
