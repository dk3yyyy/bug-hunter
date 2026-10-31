// Commit-status / check-run text (§13.3, Step 3).
// Context is fixed; state is "failure" only for a possessed PR; the
// description is the level title plus a compact counts suffix, capped at 140.

import type { HauntingLevel, HuntCounts, SeverityT } from "../types";
import { LEVEL_EMOJI, LEVEL_TITLE } from "./theme";

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

export function hauntingToStatus(
  level: HauntingLevel,
  counts: HuntCounts,
): { context: string; state: "success" | "failure"; description: string } {
  const parts: string[] = [];
  for (const s of SUFFIX_ORDER) {
    const n = counts[s];
    if (n > 0) {
      parts.push(`${n} ${n === 1 ? NOUN[s][0] : NOUN[s][1]}`);
    }
  }

  let description = `${LEVEL_EMOJI[level]} ${LEVEL_TITLE[level]}`;
  if (parts.length > 0) description += ` (${parts.join(", ")})`;

  // Commit-status descriptions are capped at 140 characters.
  if (description.length > 140) description = description.slice(0, 139) + "…";

  return {
    context: "Bug Hunter 🎃",
    state: level === "possessed" ? "failure" : "success",
    description,
  };
}
