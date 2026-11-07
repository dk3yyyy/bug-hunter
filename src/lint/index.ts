// Deterministic, local linters for the AI reviewer (SPEC §17).
//
// Given the changed files of a PR (path + unified-diff patch), run whichever of
// gitleaks / semgrep / eslint is installed, normalize their output, and return
// advisory findings. Nothing here touches the network for the review step; the
// only network access a tool might attempt is semgrep fetching `p/default` rules
// on its first run, which fails closed as a skip.
//
// This module is intentionally self-contained and never throws. Wiring (gating
// on LINT_ENABLED, merging into the hunt) lives elsewhere — see docs/LINTERS.md.

import { scrubSecrets } from "../security";
import {
  categoryForSemgrep,
  defaultExec,
  hasEslintConfig,
  isToolAvailable,
  parseEslintJson,
  parseGitleaksJson,
  parseSemgrepJson,
  relativePath,
  tryParseJson,
} from "./tools";
import type { ExecFn, LintSeverity } from "./tools";

export type { ExecFn, ExecOpts, ExecResult } from "./tools";

export interface ChangedInput {
  path: string;
  patch: string;
  /** full content when available */
  content?: string;
}

export interface LintFinding {
  tool: "gitleaks" | "semgrep" | "eslint";
  file: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "bug" | "maintainability";
  title: string;
  detail: string;
  rule?: string;
}

export interface LintResult {
  findings: LintFinding[];
  toolsRun: string[];
  skipped: Array<{ tool: string; reason: string }>;
}

export interface RunOpts {
  cwd?: string;
  timeoutMs?: number; // default 20_000
  maxFindings?: number; // default 30, applied after sorting severity
  /** Injectable exec for tests: (cmd, args, opts) => { stdout, exitCode }. Defaults to execFileSync. */
  exec?: ExecFn;
  /** Injectable availability probe; defaults to `command -v <tool>`. */
  available?: (tool: string) => boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_FINDINGS = 30;

const GITLEAKS_ARGS = [
  "detect",
  "--no-git",
  "--pipe",
  "--report-format",
  "json",
  "--report-path",
  "-",
] as const;

const SEMGREP_BASE_ARGS = ["--json", "--quiet", "--config", "p/default", "--error"] as const;

const ESLINT_BASE_ARGS = ["--format", "json", "--no-error-on-unmatched-pattern"] as const;

const SEVERITY_RANK: Record<LintSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turn an exec failure into a short, secret-free skip reason. */
function describeExecError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT" || /timed out|timeout/i.test(error.message)) {
      return `timed out after ${timeoutMs}ms`;
    }
    const signal = (error as { signal?: unknown }).signal;
    if (typeof signal === "string" && signal) return `crashed (${signal})`;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return `exited with code ${status}`;
    const message = scrubSecrets(error.message).replace(/\s+/g, " ").trim().slice(0, 200);
    return `crashed: ${message || error.name}`;
  }
  return `crashed: ${scrubSecrets(String(error)).replace(/\s+/g, " ").trim().slice(0, 200)}`;
}

/**
 * Map a tool-reported path onto a changed file. Accepts absolute paths, `./`
 * prefixes and gitleaks' `a/`/`b/` diff prefixes. Anything else is dropped.
 */
function matchChangedPath(rawPath: string, cwd: string, changed: Set<string>): string | null {
  const rel = relativePath(rawPath, cwd);
  if (changed.has(rel)) return rel;
  for (const prefix of ["b/", "a/"]) {
    if (rel.startsWith(prefix)) {
      const stripped = rel.slice(prefix.length);
      if (changed.has(stripped)) return stripped;
    }
  }
  return null;
}

function compareFindings(a: LintFinding, b: LintFinding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const byFile = a.file.localeCompare(b.file);
  if (byFile !== 0) return byFile;
  const byLine = a.line - b.line;
  if (byLine !== 0) return byLine;
  return a.title.localeCompare(b.title);
}

/** Same (file,line,title) from two rules/passes is one advisory finding. */
function dedupe(findings: LintFinding[]): LintFinding[] {
  const seen = new Set<string>();
  const out: LintFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}\u0000${finding.line}\u0000${finding.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/**
 * Run every locally installed linter over the changed files. A missing tool, a
 * missing eslint config, a crash, an unusable output or a timeout is reported in
 * `skipped`; it is never an exception and never aborts the other tools.
 */
export async function runLinters(files: ChangedInput[], opts: RunOpts = {}): Promise<LintResult> {
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFindings = Math.max(0, Math.trunc(opts.maxFindings ?? DEFAULT_MAX_FINDINGS));
  const exec = opts.exec ?? defaultExec;
  const probe = opts.available ?? isToolAvailable;

  const available = (tool: string): boolean => {
    try {
      return probe(tool);
    } catch {
      return false;
    }
  };

  const changed = new Set<string>();
  const relativeFiles: ChangedInput[] = [];
  for (const file of files) {
    const path = relativePath(file.path, cwd);
    if (!path) continue;
    changed.add(path);
    relativeFiles.push({ path, patch: file.patch, content: file.content });
  }
  const paths = relativeFiles.map((file) => file.path);

  const findings: LintFinding[] = [];
  const toolsRun: string[] = [];
  const skipped: Array<{ tool: string; reason: string }> = [];

  // --- gitleaks -----------------------------------------------------------
  if (!available("gitleaks")) {
    skipped.push({ tool: "gitleaks", reason: "not installed" });
  } else if (relativeFiles.length === 0) {
    skipped.push({ tool: "gitleaks", reason: "no changed files" });
  } else {
    try {
      // `--pipe` expects patch input; `+++ b/` headers give gitleaks the path.
      const input = relativeFiles.map((file) => `+++ b/${file.path}\n${file.patch}`).join("\n");
      const { stdout, exitCode } = exec("gitleaks", [...GITLEAKS_ARGS], {
        cwd,
        input,
        timeoutMs,
      });
      const parsed = tryParseJson(stdout);
      if (!Array.isArray(parsed)) {
        skipped.push({
          tool: "gitleaks",
          reason: exitCode === 0 ? "invalid JSON output" : `exited with code ${exitCode}`,
        });
      } else {
        toolsRun.push("gitleaks");
        for (const hit of parseGitleaksJson(stdout)) {
          const file = matchChangedPath(hit.file, cwd, changed);
          if (!file) continue;
          // The matched Secret is never read from the report. Both the rule id
          // and description are scrubbed before leaving this module.
          findings.push({
            tool: "gitleaks",
            file,
            line: hit.line,
            severity: "critical",
            category: "security",
            title: scrubSecrets(`Hardcoded secret (${hit.rule})`),
            detail: scrubSecrets(
              `gitleaks matched rule ${hit.rule}: ${hit.description}. The value is redacted.`,
            ),
            rule: scrubSecrets(hit.rule),
          });
        }
      }
    } catch (error) {
      skipped.push({ tool: "gitleaks", reason: describeExecError(error, timeoutMs) });
    }
  }

  // --- semgrep ------------------------------------------------------------
  if (!available("semgrep")) {
    skipped.push({ tool: "semgrep", reason: "not installed" });
  } else if (paths.length === 0) {
    skipped.push({ tool: "semgrep", reason: "no changed files" });
  } else {
    try {
      const { stdout, exitCode } = exec(
        "semgrep",
        [...SEMGREP_BASE_ARGS, ...paths],
        { cwd, timeoutMs },
      );
      const parsed = tryParseJson(stdout);
      const results = isRecord(parsed) && Array.isArray(parsed.results) ? parsed.results : null;
      // `--error` makes semgrep exit 1 when it finds something, so a non-zero
      // exit is fine *if* we have a results array. No results + non-zero means
      // the rules could not be loaded (offline first run) or semgrep crashed.
      if (!results || (results.length === 0 && exitCode !== 0)) {
        skipped.push({
          tool: "semgrep",
          reason:
            exitCode === 0
              ? "invalid JSON output"
              : `exited with code ${exitCode} (config/network failure?)`,
        });
      } else {
        toolsRun.push("semgrep");
        for (const hit of parseSemgrepJson(stdout)) {
          const file = matchChangedPath(hit.file, cwd, changed);
          if (!file) continue;
          const category = categoryForSemgrep(hit.checkId);
          findings.push({
            tool: "semgrep",
            file,
            line: hit.line,
            severity: hit.severity,
            category,
            title: scrubSecrets(`Semgrep: ${hit.checkId}`),
            detail: scrubSecrets(hit.message),
            rule: scrubSecrets(hit.checkId),
          });
        }
      }
    } catch (error) {
      skipped.push({ tool: "semgrep", reason: describeExecError(error, timeoutMs) });
    }
  }

  // --- eslint -------------------------------------------------------------
  if (!available("eslint")) {
    skipped.push({ tool: "eslint", reason: "not installed" });
  } else if (!hasEslintConfig(cwd)) {
    skipped.push({ tool: "eslint", reason: "no eslint config found" });
  } else if (paths.length === 0) {
    skipped.push({ tool: "eslint", reason: "no changed files" });
  } else {
    try {
      const { stdout, exitCode } = exec(
        "eslint",
        [...ESLINT_BASE_ARGS, ...paths],
        { cwd, timeoutMs },
      );
      const parsed = tryParseJson(stdout);
      if (!Array.isArray(parsed)) {
        skipped.push({
          tool: "eslint",
          reason: exitCode === 0 ? "invalid JSON output" : `exited with code ${exitCode}`,
        });
      } else {
        toolsRun.push("eslint");
        for (const hit of parseEslintJson(stdout)) {
          const file = matchChangedPath(hit.file, cwd, changed);
          if (!file) continue;
          const title = hit.ruleId ? `ESLint: ${hit.ruleId}` : "ESLint: parse error";
          findings.push({
            tool: "eslint",
            file,
            line: hit.line,
            severity: hit.severity,
            category: "maintainability",
            title: scrubSecrets(title),
            detail: scrubSecrets(hit.message),
            ...(hit.ruleId ? { rule: scrubSecrets(hit.ruleId) } : {}),
          });
        }
      }
    } catch (error) {
      skipped.push({ tool: "eslint", reason: describeExecError(error, timeoutMs) });
    }
  }

  return {
    findings: dedupe(findings).sort(compareFindings).slice(0, maxFindings),
    toolsRun,
    skipped,
  };
}

/**
 * Prompt-ready block for the review prompt: one line per finding, capped.
 * Advisory only — the model is told to verify each against the diff.
 */
export function formatLintFindings(findings: LintFinding[]): string {
  if (findings.length === 0) return "(none)";
  return findings
    .map((f) => `- ${f.file}:${f.line} [${f.severity}] ${f.title}${f.rule ? ` (${f.rule})` : ""}`)
    .join("\n");
}
