// Deterministic evaluation harness for the Bug Hunter pipeline.
//
// Mock mode (default) runs the real pipeline with a fake provider that returns
// each fixture's planted findings, so precision/recall/anchoring wiring is
// proven without a network or an API key. `--live` swaps in the real model.
//
// Run: npx tsx eval/run.ts [--live] [--json]

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { z } from "zod";

import { annotateDiff } from "../src/diff/annotate";
import { resolvePosition } from "../src/diff/commentable";
import { parsePatch } from "../src/diff/parse";
import { runHunt } from "../src/hunt/pipeline";
import type { HuntDeps, HuntInput, HuntResult } from "../src/hunt/pipeline";
import { loadAllPrompts } from "../src/prompts";
import { Category, ReviewOutput, SeanceOutput, Severity, Verdict } from "../src/types";
import type {
  CategoryT,
  ChangedFile,
  FindingT,
  KeptFinding,
  ResolvedPosition,
  ReviewOutputT,
  SeanceOutputT,
  SeverityT,
  VerdictT,
} from "../src/types";

// ---------------------------------------------------------------------------
// Dataset schema
// ---------------------------------------------------------------------------

const GoldenFinding = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: Severity,
  title: z.string().min(1),
  category: Category,
});

export type GoldenFindingT = z.infer<typeof GoldenFinding>;

const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be kebab-case"),
    name: z.string().min(1),
    diff: z.string().min(1),
    golden: z.array(GoldenFinding).max(3),
    clean: z.boolean(),
  })
  .superRefine((c, ctx) => {
    if (c.clean && c.golden.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["golden"], message: "clean case must have no golden findings" });
    }
    if (!c.clean && c.golden.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["golden"], message: "buggy case needs at least one golden finding" });
    }
  });

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** A setup problem (bad flags, bad fixtures, missing live credentials). */
class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

// ---------------------------------------------------------------------------
// Unified-diff parsing (full PR patch -> ChangedFile[])
// ---------------------------------------------------------------------------

function stripPrefix(path: string, prefix: "a/" | "b/"): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Split a whole unified diff into ChangedFile records. `parsePatch` only reads
 * one file's hunk block, so this walks the `diff --git` headers and hands each
 * file's hunks to it.
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let filename = "";
  let status = "modified";
  let isBinary = false;
  let added = 0;
  let deleted = 0;
  let hunks: string[] = [];
  let inHunks = false;

  const flush = (): void => {
    if (!filename) return;
    const patch = hunks.join("\n");
    files.push({
      filename,
      status,
      additions: added,
      deletions: deleted,
      patch: patch || undefined,
      hunks: patch ? parsePatch(patch) : [],
      isBinary,
    });
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      filename = m ? stripPrefix(m[2], "b/") : "";
      status = "modified";
      isBinary = false;
      added = 0;
      deleted = 0;
      hunks = [];
      inHunks = false;
      continue;
    }

    if (!filename) continue;

    if (!inHunks) {
      if (line.startsWith("new file mode")) {
        status = "added";
        continue;
      }
      if (line.startsWith("deleted file mode")) {
        status = "removed";
        continue;
      }
      if (line.startsWith("rename from")) {
        status = "renamed";
        continue;
      }
      if (line.startsWith("Binary files ")) {
        isBinary = true;
        continue;
      }
      if (line.startsWith("--- ")) {
        if (line === "--- /dev/null") status = "added";
        continue;
      }
      if (line.startsWith("+++ ")) {
        if (line !== "+++ /dev/null") filename = stripPrefix(line.slice(4).trim(), "b/");
        continue;
      }
      if (line.startsWith("@@")) {
        inHunks = true;
        hunks.push(line);
      }
      continue;
    }

    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    hunks.push(line);
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }

  flush();
  return files;
}

// ---------------------------------------------------------------------------
// Dataset loading + fixture self-check
// ---------------------------------------------------------------------------

const DATASET_DIR = new URL("./dataset/", import.meta.url);

export function loadDataset(dir: URL = DATASET_DIR): EvalCase[] {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new SetupError(`no fixtures found in ${dir.pathname}`);

  const seen = new Set<string>();
  const cases: EvalCase[] = [];
  for (const name of names) {
    const text = readFileSync(new URL(name, dir), "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new SetupError(`invalid JSON in ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const parsed = EvalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      throw new SetupError(`invalid fixture ${name}: ${issues.join("; ")}`);
    }
    if (seen.has(parsed.data.id)) throw new SetupError(`duplicate case id: ${parsed.data.id}`);
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  }
  return cases;
}

/** Every golden line must be an added/context line the pipeline can anchor to. */
export function checkCase(c: EvalCase): string[] {
  const problems: string[] = [];
  const files = parseUnifiedDiff(c.diff);
  if (files.length === 0) problems.push(`${c.id}: no files parsed from diff`);

  for (const g of c.golden) {
    const file = files.find((f) => f.filename === g.file);
    if (!file) {
      problems.push(`${c.id}: golden file not in diff: ${g.file}`);
      continue;
    }
    const position = resolvePosition(files, {
      file: g.file,
      start_line: g.line,
      end_line: g.line,
      evidence_quote: "",
    });
    if (!position) {
      problems.push(`${c.id}: golden line is not commentable: ${g.file}:${g.line}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Pipeline input + mock provider
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.5;

function buildInput(c: EvalCase, files: ChangedFile[], prompts: HuntInput["prompts"]): HuntInput {
  return {
    owner: "bug-hunter",
    repo: "eval",
    prNumber: 1,
    headSha: "0".repeat(40),
    prTitle: c.name,
    prBody: "",
    files,
    repoRules: "(none)",
    context: "",
    annotatedDiff: annotateDiff(files).text,
    prompts,
    maxFindings: 40,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
  };
}

function mockSeance(c: EvalCase): SeanceOutputT {
  return {
    summary: `Eval fixture: ${c.name}`,
    change_type: "chore",
    walkthrough: [],
    risk_areas: [],
    effort: 1,
    spooky_tagline: "Deterministic eval run.",
  };
}

/**
 * Fake provider: echoes the fixture's golden findings. The review pass must
 * return them, the verifier keeps them at full confidence, and the séance pass
 * returns a safe summary.
 */
export function mockDeps(c: EvalCase): HuntDeps {
  let findings: FindingT[] = [];
  return {
    review: async () => {
      findings = c.golden.map((g) => ({
        file: g.file,
        start_line: g.line,
        end_line: g.line,
        severity: g.severity,
        category: g.category,
        confidence: 0.95,
        title: g.title,
        explanation: `Planted bug (${g.category}): ${g.title}`,
        evidence_quote: "",
        fix_kind: "none",
        fix_code: null,
      }));
      const out: ReviewOutputT = { findings, notes_for_summary: [] };
      return out;
    },
    verify: async () => {
      const out: VerdictT = {
        results: findings.map((f, i) => ({
          id: `f${i + 1}`,
          verdict: "keep",
          reason: "mock verifier: planted finding kept",
          adjusted_severity: f.severity,
          adjusted_confidence: 1,
          corrected_start_line: null,
          corrected_end_line: null,
          fix_ok: false,
        })),
      };
      return out;
    },
    seance: async () => mockSeance(c),
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<SeverityT, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  nitpick: 4,
};

/** One finding as scored: the resolved line, not the model's raw line. */
export interface ScoredFinding {
  file: string;
  line: number;
  severity: SeverityT;
  title: string;
  category: CategoryT;
  position: ResolvedPosition | null;
}

export function toPrediction(f: KeptFinding): ScoredFinding {
  return {
    file: f.file,
    line: f.position?.start_line ?? f.start_line,
    severity: f.adjusted_severity,
    title: f.title,
    category: f.category,
    position: f.position,
  };
}

/**
 * Keep only findings the commentable-line map can anchor. Anything without a
 * valid position is counted as invalid and removed before matching, which is
 * what makes the post-validation invalid-position rate exactly zero.
 */
export function validateFindings(
  predictions: ScoredFinding[],
  files: ChangedFile[],
): { valid: ScoredFinding[]; invalid: ScoredFinding[] } {
  const valid: ScoredFinding[] = [];
  const invalid: ScoredFinding[] = [];
  for (const p of predictions) {
    const position = resolvePosition(files, {
      file: p.file,
      start_line: p.line,
      end_line: p.line,
      evidence_quote: "",
    });
    if (position) valid.push({ ...p, position });
    else invalid.push(p);
  }
  return { valid, invalid };
}

/** Same file, line within ±3, and severity at most one rung off. */
export function isMatch(pred: ScoredFinding, gold: GoldenFindingT): boolean {
  if (pred.file !== gold.file) return false;
  if (Math.abs(pred.line - gold.line) > 3) return false;
  return Math.abs(SEVERITY_ORDER[pred.severity] - SEVERITY_ORDER[gold.severity]) <= 1;
}

export interface CaseMetrics {
  id: string;
  name: string;
  clean: boolean;
  golden: number;
  predicted: number;
  invalidPositions: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  pass: boolean;
  error?: string;
}

export function scoreCase(c: EvalCase, result: HuntResult, files: ChangedFile[]): CaseMetrics {
  // Findings in "Lurking outside the diff" are still predictions; validation
  // drops them when they have no anchor and counts them as invalid.
  const raw = [...result.kept, ...result.lurking].map(toPrediction);
  const { valid, invalid } = validateFindings(raw, files);

  const used = new Set<number>();
  let truePositives = 0;
  for (const gold of c.golden) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    valid.forEach((pred, i) => {
      if (used.has(i) || !isMatch(pred, gold)) return;
      const distance = Math.abs(pred.line - gold.line);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      used.add(best);
      truePositives += 1;
    }
  }

  const falsePositives = valid.length - truePositives;
  const falseNegatives = c.golden.length - truePositives;

  return {
    id: c.id,
    name: c.name,
    clean: c.clean,
    golden: c.golden.length,
    predicted: valid.length,
    invalidPositions: invalid.length,
    truePositives,
    falsePositives,
    falseNegatives,
    pass: falsePositives === 0 && falseNegatives === 0 && invalid.length === 0,
  };
}

function failedCase(c: EvalCase, error: string): CaseMetrics {
  return {
    id: c.id,
    name: c.name,
    clean: c.clean,
    golden: c.golden.length,
    predicted: 0,
    invalidPositions: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: c.golden.length,
    pass: false,
    error,
  };
}

export interface EvalMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  golden: number;
  validPredictions: number;
  invalidPositions: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositivesPerCleanPr: number;
  cleanFalsePositives: number;
  cleanCases: number;
  invalidPositionRate: number;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

export function aggregate(rows: CaseMetrics[]): EvalMetrics {
  const tp = rows.reduce((n, r) => n + r.truePositives, 0);
  const fp = rows.reduce((n, r) => n + r.falsePositives, 0);
  const fn = rows.reduce((n, r) => n + r.falseNegatives, 0);
  const golden = rows.reduce((n, r) => n + r.golden, 0);
  const validPredictions = rows.reduce((n, r) => n + r.predicted, 0);
  const invalidPositions = rows.reduce((n, r) => n + r.invalidPositions, 0);
  const cleanRows = rows.filter((r) => r.clean);
  const cleanFalsePositives = cleanRows.reduce((n, r) => n + r.falsePositives, 0);

  const precision = ratio(tp, tp + fp, 1);
  const recall = ratio(tp, tp + fn, 1);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    golden,
    validPredictions,
    invalidPositions,
    precision,
    recall,
    f1,
    falsePositivesPerCleanPr: ratio(cleanFalsePositives, cleanRows.length, 0),
    cleanFalsePositives,
    cleanCases: cleanRows.length,
    invalidPositionRate: ratio(invalidPositions, validPredictions + invalidPositions, 0),
  };
}

// ---------------------------------------------------------------------------
// Live provider
// ---------------------------------------------------------------------------

function loadDotEnv(): void {
  const proc = process as unknown as { loadEnvFile?: (p?: string) => void };
  try {
    proc.loadEnvFile?.();
  } catch {
    // .env is optional.
  }
}

/** Preflight credentials before importing src/env.ts (which exits on bad config). */
async function loadLiveRuntime(): Promise<() => HuntDeps> {
  loadDotEnv();

  const provider = (process.env.LLM_PROVIDER ?? "google").trim() || "google";
  const googleKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim();
  const llmKey = (process.env.LLM_API_KEY ?? "").trim();
  const reviewModel = (process.env.LLM_MODEL_REVIEW ?? "").trim();
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();

  if (provider === "google" && !googleKey) {
    throw new SetupError(
      "--live has no model key: set GOOGLE_GENERATIVE_AI_API_KEY (LLM_PROVIDER=google). " +
        "Mock mode needs no key: npx tsx eval/run.ts",
    );
  }
  if (provider !== "google" && !llmKey) {
    throw new SetupError(
      `--live has no model key: set LLM_API_KEY (LLM_PROVIDER=${provider}). ` +
        "Mock mode needs no key: npx tsx eval/run.ts",
    );
  }
  if (provider !== "google" && !reviewModel) {
    throw new SetupError(`--live needs LLM_MODEL_REVIEW when LLM_PROVIDER=${provider}.`);
  }
  if (provider === "openai-compatible" && !baseUrl) {
    throw new SetupError("--live needs LLM_BASE_URL when LLM_PROVIDER=openai-compatible.");
  }

  const [{ getModel }, { generateStructured }] = await Promise.all([
    import("../src/llm/models"),
    import("../src/llm/structured"),
  ]);

  return () => {
    const sessionId = `bh-eval-${randomUUID()}`;
    return {
      review: ({ system, user }) =>
        generateStructured({
          model: getModel("review", { sessionId }),
          schema: ReviewOutput,
          system,
          prompt: user,
          label: "eval review",
        }),
      verify: ({ system, user }) =>
        generateStructured({
          model: getModel("verify", { sessionId }),
          schema: Verdict,
          system,
          prompt: user,
          label: "eval verify",
        }),
      seance: ({ system, user }) =>
        generateStructured({
          model: getModel("fast", { sessionId }),
          schema: SeanceOutput,
          system,
          prompt: user,
          label: "eval séance",
        }),
    };
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  live: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { live: false, json: false, help: false };
  for (const a of argv) {
    if (a === "--live") args.live = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new SetupError(`unknown argument: ${a} (try --help)`);
  }
  return args;
}

function usage(): string {
  return [
    "Bug Hunter eval harness",
    "",
    "Usage:",
    "  npx tsx eval/run.ts            deterministic mock run (no network)",
    "  npx tsx eval/run.ts --live     run the real model on the fixtures",
    "  npx tsx eval/run.ts --json     machine-readable output",
    "",
    "Options:",
    "  --live   use getModel/generateStructured + the real prompts",
    "  --json   print one JSON object instead of the metrics table",
    "  --help   show this help",
  ].join("\n");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padStart(value: string | number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function printReport(rows: CaseMetrics[], metrics: EvalMetrics, live: boolean): void {
  const clean = rows.filter((r) => r.clean).length;
  const buggy = rows.length - clean;

  console.log("");
  console.log(
    live
      ? "Bug Hunter eval — live mode (real model, network required)"
      : "Bug Hunter eval — mock mode (deterministic, no network)",
  );
  console.log(`Cases: ${rows.length} (${buggy} buggy, ${clean} clean) · Golden findings: ${metrics.golden}`);
  console.log("");
  console.log(
    `${pad("Case", 26)} ${pad("Clean", 5)} ${padStart("TP", 4)} ${padStart("FP", 4)} ${padStart("FN", 4)} ${padStart("Invalid", 7)}  Result`,
  );
  for (const r of rows) {
    const verdict = r.pass ? "PASS" : "FAIL";
    const suffix = r.error ? `  (${r.error})` : "";
    console.log(
      `${pad(r.id, 26)} ${pad(r.clean ? "yes" : "no", 5)} ${padStart(r.truePositives, 4)} ${padStart(
        r.falsePositives,
        4,
      )} ${padStart(r.falseNegatives, 4)} ${padStart(r.invalidPositions, 7)}  ${verdict}${suffix}`,
    );
  }
  console.log("");
  console.log(
    `Precision: ${metrics.precision.toFixed(3)}   Recall: ${metrics.recall.toFixed(3)}   F1: ${metrics.f1.toFixed(3)}`,
  );
  console.log(
    `False positives per clean PR: ${metrics.falsePositivesPerCleanPr.toFixed(2)} ` +
      `(${metrics.cleanFalsePositives} FP over ${metrics.cleanCases} clean cases)`,
  );
  console.log(
    `Invalid positions: ${metrics.invalidPositions} of ${metrics.validPredictions + metrics.invalidPositions} ` +
      `predictions (${(metrics.invalidPositionRate * 100).toFixed(1)}%; 0 after validateFindings)`,
  );
  console.log("");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  let liveFactory: (() => HuntDeps) | null = null;
  if (args.live) {
    try {
      liveFactory = await loadLiveRuntime();
    } catch (e) {
      if (e instanceof SetupError) {
        if (args.json) console.log(JSON.stringify({ mode: "live", error: e.message }, null, 2));
        else console.error(`✗ ${e.message}`);
        return 1;
      }
      throw e;
    }
  }

  const cases = loadDataset();
  const problems = cases.flatMap(checkCase);
  if (problems.length > 0) {
    if (args.json) {
      console.log(JSON.stringify({ mode: args.live ? "live" : "mock", error: "invalid dataset", problems }, null, 2));
    } else {
      console.error("✗ dataset check failed:");
      for (const p of problems) console.error(`  - ${p}`);
    }
    return 1;
  }

  const prompts = loadAllPrompts();
  const rows: CaseMetrics[] = [];
  for (const c of cases) {
    const files = parseUnifiedDiff(c.diff);
    try {
      const deps = liveFactory ? liveFactory() : mockDeps(c);
      const result = await runHunt(buildInput(c, files, prompts), deps);
      rows.push(scoreCase(c, result, files));
    } catch (e) {
      rows.push(failedCase(c, e instanceof Error ? e.message : String(e)));
    }
  }

  const metrics = aggregate(rows);
  if (args.json) {
    const clean = rows.filter((r) => r.clean).length;
    console.log(
      JSON.stringify(
        {
          mode: args.live ? "live" : "mock",
          dataset: {
            cases: rows.length,
            buggy: rows.length - clean,
            clean,
            golden: metrics.golden,
          },
          cases: rows,
          metrics,
        },
        null,
        2,
      ),
    );
  } else {
    printReport(rows, metrics, args.live);
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
