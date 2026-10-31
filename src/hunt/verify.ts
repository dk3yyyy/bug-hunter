import { createHash } from "node:crypto";
import type { ExorcisedFinding, FindingT, KeptFinding, SeverityT, VerdictT } from "../types";

/**
 * Stable identity for a finding, used to dedupe across re-runs. Built from the
 * fields that identify one occurrence: file, lines, category, the
 * lowercase/trimmed title, and the trimmed evidence quote. Lines are included
 * so the same snippet reported at two locations posts twice.
 */
export function fingerprint(f: FindingT): string {
  const material = `${f.file}|${f.start_line}|${f.end_line}|${f.category}|${f.title.toLowerCase().trim()}|${f.evidence_quote.trim()}`;
  return createHash("sha1").update(material).digest("hex");
}

/** Clamp model-reported confidence into [0, 1] (verifiers sometimes emit 90). */
export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

const SEVERITY_LADDER = ["critical", "high", "medium", "low", "nitpick"] as const;

/**
 * A "downgrade" with null severity steps one rung down the ladder instead of
 * silently keeping the original severity.
 */
export function downgradeSeverity(
  current: SeverityT,
  adjusted: SeverityT | null,
): SeverityT {
  if (adjusted) return adjusted;
  const i = SEVERITY_LADDER.indexOf(current);
  return SEVERITY_LADDER[Math.min(SEVERITY_LADDER.length - 1, i + 1)];
}

/**
 * Apply the verifier's verdict to each candidate.
 *
 * Corrected-line note: `KeptFinding` carries a single `start_line`/`end_line`
 * pair (there is no separate "original" vs "corrected" field). We store the
 * *corrected* lines there (falling back to the candidate's original lines when
 * the verifier returned no correction), while preserving the original
 * evidence_quote, severity, category and confidence untouched. The original
 * severity is kept in `severity`; the verifier's recalibration goes in
 * `adjusted_severity` / `adjusted_confidence`. `position` is left `null` here —
 * it is resolved later in the pipeline against the commentable diff.
 *
 * A candidate with no matching VerdictResult (by id) is kept with its
 * original values, but fix_ok = false: an unverified fix must never become a
 * one-click ```suggestion block. Confidence is clamped into [0, 1].
 */
export function applyVerdict(
  candidates: Array<FindingT & { id: string }>,
  verdict: VerdictT,
): { kept: KeptFinding[]; exorcised: ExorcisedFinding[] } {
  const byId = new Map(verdict.results.map((r) => [r.id, r] as const));

  const kept: KeptFinding[] = [];
  const exorcised: ExorcisedFinding[] = [];

  for (const c of candidates) {
    const result = byId.get(c.id);

    // Missing verdict ⇒ keep unverified: original confidence (clamped),
    // original severity, but fix_ok = false so it can never render as a
    // one-click suggestion. The report banner (verifierFailed) marks these.
    if (!result) {
      kept.push({
        id: c.id,
        fingerprint: fingerprint(c),
        file: c.file,
        start_line: c.start_line,
        end_line: c.end_line,
        severity: c.severity,
        adjusted_severity: c.severity,
        category: c.category,
        confidence: c.confidence,
        adjusted_confidence: clampConfidence(c.confidence),
        title: c.title,
        explanation: c.explanation,
        evidence_quote: c.evidence_quote,
        fix_kind: c.fix_kind,
        fix_code: c.fix_code,
        fix_ok: false,
        position: null,
      });
      continue;
    }

    if (result.verdict === "drop") {
      exorcised.push({
        id: c.id,
        title: c.title,
        severity: c.severity,
        reason: result.reason,
        source: "verifier",
      });
      continue;
    }

    // "keep" | "downgrade" ⇒ survive, with the verifier's calibration.
    // Confidence is clamped into [0, 1]; a null severity on downgrade steps
    // one rung down instead of silently keeping the original.
    kept.push({
      id: c.id,
      fingerprint: fingerprint(c),
      file: c.file,
      start_line: result.corrected_start_line ?? c.start_line,
      end_line: result.corrected_end_line ?? c.end_line,
      severity: c.severity,
      adjusted_severity:
        result.verdict === "downgrade"
          ? downgradeSeverity(c.severity, result.adjusted_severity)
          : (result.adjusted_severity ?? c.severity),
      category: c.category,
      confidence: c.confidence,
      adjusted_confidence: clampConfidence(result.adjusted_confidence),
      title: c.title,
      explanation: c.explanation,
      evidence_quote: c.evidence_quote,
      fix_kind: c.fix_kind,
      fix_code: c.fix_code,
      fix_ok: result.fix_ok,
      position: null,
    });
  }

  return { kept, exorcised };
}
