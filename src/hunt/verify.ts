import { createHash } from "node:crypto";
import type { ExorcisedFinding, FindingT, KeptFinding, VerdictT } from "../types";

/**
 * Stable identity for a finding, used to dedupe across re-runs (SPEC §12.3).
 * Built from the fields that survive line renumbering: file, category, the
 * lowercase/trimmed title, and the trimmed evidence quote.
 */
export function fingerprint(f: FindingT): string {
  const material = `${f.file}|${f.category}|${f.title.toLowerCase().trim()}|${f.evidence_quote.trim()}`;
  return createHash("sha1").update(material).digest("hex");
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
 * A candidate with no matching VerdictResult (by id) is treated as an
 * uncontested keep: adjusted_confidence = confidence, adjusted_severity =
 * severity, fix_ok = true, no line corrections.
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

    // Missing verdict ⇒ treat as keep with the original values.
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
        adjusted_confidence: c.confidence,
        title: c.title,
        explanation: c.explanation,
        evidence_quote: c.evidence_quote,
        fix_kind: c.fix_kind,
        fix_code: c.fix_code,
        fix_ok: true,
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
      });
      continue;
    }

    // "keep" | "downgrade" ⇒ survive, with the verifier's calibration.
    kept.push({
      id: c.id,
      fingerprint: fingerprint(c),
      file: c.file,
      start_line: result.corrected_start_line ?? c.start_line,
      end_line: result.corrected_end_line ?? c.end_line,
      severity: c.severity,
      adjusted_severity: result.adjusted_severity ?? c.severity,
      category: c.category,
      confidence: c.confidence,
      adjusted_confidence: result.adjusted_confidence,
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
