import type { FindingT } from "../types";

/**
 * Assign deterministic ids ("f1", "f2", …) to candidate findings before the
 * verifier pass runs, so the verifier can refer to each finding by id
 * (SPEC §12.3).
 */
export function withIds(findings: FindingT[]): Array<FindingT & { id: string }> {
  return findings.map((f, i) => ({ ...f, id: `f${i + 1}` }));
}

/**
 * Serialize candidates into the JSON text inserted into the verifier prompt.
 * Only the fields the verifier needs are emitted, in a stable order.
 */
export function candidatesJson(candidates: Array<FindingT & { id: string }>): string {
  return JSON.stringify(
    candidates.map((c) => ({
      id: c.id,
      file: c.file,
      start_line: c.start_line,
      end_line: c.end_line,
      severity: c.severity,
      category: c.category,
      confidence: c.confidence,
      title: c.title,
      explanation: c.explanation,
      evidence_quote: c.evidence_quote,
      fix_kind: c.fix_kind,
      fix_code: c.fix_code,
    })),
  );
}
