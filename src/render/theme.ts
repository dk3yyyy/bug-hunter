// Deterministic theme mapping (§3): creatures, category icons, haunting levels.
// Pure data + one pure function — no I/O, no side effects.

import type { CategoryT, HauntingLevel, HuntCounts, SeverityT } from "../types";

// §3.2 severity creatures, in display/priority order.
export const SEVERITY_ORDER: readonly SeverityT[] = [
  "critical",
  "high",
  "medium",
  "low",
  "nitpick",
];

export const CREATURE: Record<SeverityT, { emoji: string; label: string }> = {
  critical: { emoji: "💀", label: "Demon" },
  high: { emoji: "👻", label: "Ghost" },
  medium: { emoji: "🦇", label: "Bat" },
  low: { emoji: "🕸️", label: "Cobweb" },
  nitpick: { emoji: "🍬", label: "Candy wrapper" },
};

// §3.3 category icons.
export const CATEGORY_ICON: Record<CategoryT, string> = {
  bug: "🐛",
  security: "🧛",
  performance: "🐢",
  concurrency: "🔀",
  "error-handling": "🧯",
  "data-integrity": "🗄️",
  "api-contract": "📜",
  "test-gap": "🧪",
  maintainability: "🧹",
  "prompt-injection": "🪄",
};

// Markers used to upsert/dedupe the report and inline comments.
export const SEANCE_MARKER = "<!-- bughunter:seance -->";
export const FINDING_MARKER_PREFIX = "<!-- bughunter:f=";

// §3.4 haunting-level emoji/title (shared by the report and the status line).
export const LEVEL_EMOJI: Record<HauntingLevel, string> = {
  clear: "🌕",
  whispers: "🕯️",
  restless: "🦇",
  haunted: "👻",
  possessed: "💀",
};

export const LEVEL_TITLE: Record<HauntingLevel, string> = {
  clear: "All clear: no spirits detected",
  whispers: "Faint whispers: minor cleanup only",
  restless: "Restless spirits detected",
  haunted: "This PR is haunted",
  possessed: "Possessed: do not merge",
};

// §3.4: haunting level is computed from the kept findings (highest wins) and a
// possession attempt always forces "possessed".
export function computeHaunting(
  counts: HuntCounts,
  possessionAttempt: boolean,
): { level: HauntingLevel; title: string } {
  let level: HauntingLevel;
  if (possessionAttempt || counts.critical > 0) {
    level = "possessed";
  } else if (counts.high > 0) {
    level = "haunted";
  } else if (counts.medium > 0) {
    level = "restless";
  } else if (counts.low > 0 || counts.nitpick > 0) {
    level = "whispers";
  } else {
    level = "clear";
  }
  return { level, title: LEVEL_TITLE[level] };
}
