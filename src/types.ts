// Shared domain types and Zod schemas for Bug Hunter.
// Every module imports from here so the pieces line up (SPEC §0.4).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Diff (§9)
// ---------------------------------------------------------------------------

export type DiffLineType = "add" | "del" | "ctx";

export interface DiffLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  header: string;
  lines: DiffLine[];
}

/** One changed file from GET /pulls/{n}/files, with its patch parsed into hunks. */
export interface ChangedFile {
  filename: string;
  status: string; // added | modified | removed | renamed | copied | changed | unchanged
  previous_filename?: string;
  additions: number;
  deletions: number;
  patch?: string;
  hunks: Hunk[];
  isBinary: boolean;
}

// ---------------------------------------------------------------------------
// Findings (§12.3)
// ---------------------------------------------------------------------------

export const Severity = z.enum(["critical", "high", "medium", "low", "nitpick"]);
export type SeverityT = z.infer<typeof Severity>;

export const Category = z.enum([
  "bug",
  "security",
  "performance",
  "concurrency",
  "error-handling",
  "data-integrity",
  "api-contract",
  "test-gap",
  "maintainability",
  "prompt-injection",
]);
export type CategoryT = z.infer<typeof Category>;

export const Finding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity,
  category: Category,
  confidence: z.number(),
  title: z.string(),
  explanation: z.string(),
  evidence_quote: z.string(),
  fix_kind: z.enum(["suggestion", "snippet", "none"]),
  fix_code: z.string().nullable(),
});
export type FindingT = z.infer<typeof Finding>;

export const ReviewOutput = z.object({
  findings: z.array(Finding).max(40),
  notes_for_summary: z.array(z.string()).max(10),
});
export type ReviewOutputT = z.infer<typeof ReviewOutput>;

// ---------------------------------------------------------------------------
// Verifier (§12.4)
// ---------------------------------------------------------------------------

export const VerdictResult = z.object({
  id: z.string(),
  verdict: z.enum(["keep", "drop", "downgrade"]),
  reason: z.string(),
  adjusted_severity: Severity.nullable(),
  adjusted_confidence: z.number(),
  corrected_start_line: z.number().int().nullable(),
  corrected_end_line: z.number().int().nullable(),
  fix_ok: z.boolean(),
});
export const Verdict = z.object({ results: z.array(VerdictResult) });
export type VerdictT = z.infer<typeof Verdict>;
export type VerdictResultT = z.infer<typeof VerdictResult>;

// ---------------------------------------------------------------------------
// Séance summary (§12.5)
// ---------------------------------------------------------------------------

export const SeanceOutput = z.object({
  summary: z.string(),
  change_type: z.enum(["feature", "bugfix", "refactor", "docs", "tests", "chore", "security"]),
  walkthrough: z.array(z.object({ files: z.array(z.string()), change: z.string() })),
  risk_areas: z.array(z.string()),
  effort: z.number().int().min(1).max(5),
  spooky_tagline: z.string(),
});
export type SeanceOutputT = z.infer<typeof SeanceOutput>;

// ---------------------------------------------------------------------------
// Haunting (§3.4)
// ---------------------------------------------------------------------------

export type HauntingLevel = "clear" | "whispers" | "restless" | "haunted" | "possessed";

export interface HuntCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  nitpick: number;
}

export interface ResolvedPosition {
  file: string;
  start_line: number;
  end_line: number;
}

// ---------------------------------------------------------------------------
// A kept finding after validation + verification + filtering (§11 steps 7-9)
// ---------------------------------------------------------------------------

export interface KeptFinding {
  id: string;
  fingerprint: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: SeverityT;
  adjusted_severity: SeverityT;
  category: CategoryT;
  confidence: number;
  adjusted_confidence: number;
  title: string;
  explanation: string;
  evidence_quote: string;
  fix_kind: FindingT["fix_kind"];
  fix_code: string | null;
  fix_ok: boolean;
  /** Anchored position for inline comments; null when it must live in the report only. */
  position: ResolvedPosition | null;
}

export interface ExorcisedFinding {
  id: string;
  title: string;
  severity: SeverityT;
  reason: string;
  /**
   * "verifier" (default when omitted) = dropped by the skeptical verifier → shown as an
   * Exorcised false alarm. "trimmed" = dropped by code (cap, >3 per file, file not in diff).
   */
  source?: "verifier" | "trimmed";
}

// ---------------------------------------------------------------------------
// A stored hunt (in-memory "dashboard" record).
// ---------------------------------------------------------------------------

export interface HuntRecord {
  id: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  hauntingLevel: HauntingLevel;
  counts: HuntCounts;
  possessionAttempt: boolean;
  exorcised: number;
  keptCount: number;
  topFindings: Array<{ severity: string; title: string; file: string; line: number }>;
  finishedAt: string;
}
