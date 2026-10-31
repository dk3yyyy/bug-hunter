// Voice copy loader: prompts/voice.json validated with zod, cached at startup.
// All user-facing Halloween copy lives here; renderers look it up, never hardcode.
import { readFileSync } from "node:fs";
import { z } from "zod";

const severityEntry = z.object({
  emoji: z.string(),
  creature: z.string(),
  label: z.string(),
});

const categoryEntry = z.object({
  emoji: z.string(),
  label: z.string(),
});

const hauntingEntry = z.object({
  emoji: z.string(),
  title: z.string(),
  status: z.string(),
});

export const Voice = z.object({
  product: z.object({
    name: z.string(),
    emoji: z.string(),
    tagline: z.string(),
  }),
  severities: z.object({
    critical: severityEntry,
    high: severityEntry,
    medium: severityEntry,
    low: severityEntry,
    nitpick: severityEntry,
  }),
  severity_badge: z.string(),
  categories: z.object({
    bug: categoryEntry,
    security: categoryEntry,
    performance: categoryEntry,
    concurrency: categoryEntry,
    "error-handling": categoryEntry,
    "data-integrity": categoryEntry,
    "api-contract": categoryEntry,
    "test-gap": categoryEntry,
    maintainability: categoryEntry,
    "prompt-injection": categoryEntry,
  }),
  haunting_levels: z.object({
    clear: hauntingEntry,
    whispers: hauntingEntry,
    restless: hauntingEntry,
    haunted: hauntingEntry,
    possessed: hauntingEntry,
  }),
  seance: z.object({
    marker: z.string(),
    title: z.string(),
    haunting_line: z.string(),
    all_clear: z.string(),
    possession_callout: z.string(),
    sections: z.object({
      summary: z.string(),
      findings: z.string(),
      walkthrough: z.string(),
      risk_areas: z.string(),
      outside_diff: z.string(),
      false_alarms: z.string(),
      graveyard: z.string(),
      // Findings dropped by code (cap / >3 per file / file not in diff), not by the verifier.
      trimmed: z.string().default("🪤 Trimmed to keep the report short ({{count}})"),
    }),
    // Shown when the verifier pass failed and findings are unverified.
    verifier_failed: z
      .string()
      .default(
        "> 🌫️ **The verifier was lost in the fog.** These findings were not double-checked, so treat them with care. No one-click fixes were offered.",
      ),
    finding_heading: z.string(),
    location_line: z.string(),
    fix_label: z.string(),
    confidence_line: z.string(),
    false_alarm_item: z.string(),
    graveyard_item: z.string(),
    walkthrough_header: z.string(),
    footer: z.string(),
  }),
  inline: z.object({
    header: z.string(),
    title: z.string(),
    fix_label: z.string(),
    footer: z.string(),
    review_body: z.string(),
  }),
  status: z.object({
    context: z.string(),
    pending: z.string(),
    done: z.string(),
    error: z.string(),
  }),
  graveyard_reasons: z.object({
    lockfile: z.string(),
    generated: z.string(),
    vendored: z.string(),
    binary: z.string(),
    too_large: z.string(),
    limit: z.string(),
  }),
  errors: z.object({
    hunt_failed_comment: z.string(),
  }),
});

export type VoiceT = z.infer<typeof Voice>;

let cached: VoiceT | null = null;

export function loadVoice(): VoiceT {
  if (cached) return cached;
  const url = new URL("../prompts/voice.json", import.meta.url);
  const raw = readFileSync(url, "utf8");
  cached = Voice.parse(JSON.parse(raw));
  return cached;
}

/** Test-only: clear the cached voice so edits to voice.json take effect. */
export function resetVoiceCache(): void {
  cached = null;
}
