// Deterministic theme mapping: creatures, category icons, haunting levels.
// All user-facing Halloween copy comes from prompts/voice.json (validated);
// this module re-exports it in the shapes renderers and tests expect.
import type { CategoryT, HauntingLevel, HuntCounts, SeverityT } from "../types";
import { fillTemplate } from "../prompts";
import { loadVoice } from "../voice";

function voice() {
  return loadVoice();
}

// Severity creatures, in display/priority order.
export const SEVERITY_ORDER: readonly SeverityT[] = [
  "critical",
  "high",
  "medium",
  "low",
  "nitpick",
];

function creatures(): Record<SeverityT, { emoji: string; label: string }> {
  const v = voice();
  return {
    critical: { emoji: v.severities.critical.emoji, label: v.severities.critical.creature },
    high: { emoji: v.severities.high.emoji, label: v.severities.high.creature },
    medium: { emoji: v.severities.medium.emoji, label: v.severities.medium.creature },
    low: { emoji: v.severities.low.emoji, label: v.severities.low.creature },
    nitpick: { emoji: v.severities.nitpick.emoji, label: v.severities.nitpick.creature },
  };
}

export const CREATURE: Record<SeverityT, { emoji: string; label: string }> = new Proxy(
  {} as Record<SeverityT, { emoji: string; label: string }>,
  {
    get: (_t, prop: string) => creatures()[prop as SeverityT],
    ownKeys: () => [...SEVERITY_ORDER],
    getOwnPropertyDescriptor: (_t, prop: string) => {
      const c = creatures()[prop as SeverityT];
      return c ? { enumerable: true, configurable: true, value: c } : undefined;
    },
  },
);

function categoryIcons(): Record<CategoryT, string> {
  const v = voice();
  return {
    bug: v.categories.bug.emoji,
    security: v.categories.security.emoji,
    performance: v.categories.performance.emoji,
    concurrency: v.categories.concurrency.emoji,
    "error-handling": v.categories["error-handling"].emoji,
    "data-integrity": v.categories["data-integrity"].emoji,
    "api-contract": v.categories["api-contract"].emoji,
    "test-gap": v.categories["test-gap"].emoji,
    maintainability: v.categories.maintainability.emoji,
    "prompt-injection": v.categories["prompt-injection"].emoji,
  };
}

export const CATEGORY_ICON: Record<CategoryT, string> = new Proxy(
  {} as Record<CategoryT, string>,
  {
    get: (_t, prop: string) => categoryIcons()[prop as CategoryT],
    ownKeys: () => Object.keys(categoryIcons()),
    getOwnPropertyDescriptor: (_t, prop: string) => {
      const c = categoryIcons()[prop as CategoryT];
      return c !== undefined ? { enumerable: true, configurable: true, value: c } : undefined;
    },
  },
);

/** Category display labels from voice (e.g. "Error handling", "API contract"). */
export function categoryLabel(c: CategoryT): string {
  const v = voice();
  return v.categories[c].label;
}

/** Severity display label from voice (e.g. "Critical"). */
export function severityLabel(s: SeverityT): string {
  const v = voice();
  return v.severities[s].label;
}

/** "💀 Demon · Critical" style badge from voice.severity_badge. */
export function severityBadge(s: SeverityT): string {
  const v = voice();
  const e = v.severities[s];
  // fillTemplate throws on renamed vars instead of rendering "{{...}}" literally.
  return fillTemplate(v.severity_badge, {
    emoji: e.emoji,
    creature: e.creature,
    label: e.label,
  });
}

// Markers used to upsert/dedupe the report and inline comments.
export function seanceMarker(): string {
  return voice().seance.marker;
}
export const SEANCE_MARKER = "<!-- bughunter:seance -->";
export const FINDING_MARKER_PREFIX = "<!-- bughunter:f=";

/** Regex matching inline finding markers; single source with FINDING_MARKER_PREFIX. */
export function findingMarkerRegex(): RegExp {
  return /<!--\s*bughunter:f=([a-f0-9]{40})\s*-->/g;
}

// Haunting-level emoji/title from voice (shared by report + status line).
function levelMaps(): {
  emoji: Record<HauntingLevel, string>;
  title: Record<HauntingLevel, string>;
} {
  const v = voice();
  return {
    emoji: {
      clear: v.haunting_levels.clear.emoji,
      whispers: v.haunting_levels.whispers.emoji,
      restless: v.haunting_levels.restless.emoji,
      haunted: v.haunting_levels.haunted.emoji,
      possessed: v.haunting_levels.possessed.emoji,
    },
    title: {
      clear: v.haunting_levels.clear.title,
      whispers: v.haunting_levels.whispers.title,
      restless: v.haunting_levels.restless.title,
      haunted: v.haunting_levels.haunted.title,
      possessed: v.haunting_levels.possessed.title,
    },
  };
}

export const LEVEL_EMOJI: Record<HauntingLevel, string> = new Proxy(
  {} as Record<HauntingLevel, string>,
  {
    get: (_t, prop: string) => levelMaps().emoji[prop as HauntingLevel],
    ownKeys: () => ["clear", "whispers", "restless", "haunted", "possessed"],
    getOwnPropertyDescriptor: (_t, prop: string) => {
      const c = levelMaps().emoji[prop as HauntingLevel];
      return c !== undefined ? { enumerable: true, configurable: true, value: c } : undefined;
    },
  },
);

export const LEVEL_TITLE: Record<HauntingLevel, string> = new Proxy(
  {} as Record<HauntingLevel, string>,
  {
    get: (_t, prop: string) => levelMaps().title[prop as HauntingLevel],
    ownKeys: () => ["clear", "whispers", "restless", "haunted", "possessed"],
    getOwnPropertyDescriptor: (_t, prop: string) => {
      const c = levelMaps().title[prop as HauntingLevel];
      return c !== undefined ? { enumerable: true, configurable: true, value: c } : undefined;
    },
  },
);

// Haunting level is computed from the kept findings (highest wins) and a
// possession attempt always forces "possessed".
export function computeHaunting(
  counts: HuntCounts,
  possessionAttempt: boolean,
): { level: HauntingLevel; title: string } {
  const titles = levelMaps().title;
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
  return { level, title: titles[level] };
}
