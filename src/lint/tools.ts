// Thin, dependency-free helpers for the deterministic linter runner (SPEC §17).
// Everything here is pure or nearly pure so it can be unit-tested without the
// real gitleaks/semgrep/eslint binaries: exec, availability probe, JSON parsers,
// path normalization and severity mapping.
//
// The parsers deliberately drop fields that could carry a live secret (e.g.
// gitleaks' `Secret`) so callers cannot accidentally forward them.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

export type LintSeverity = "critical" | "high" | "medium" | "low";
export type LintCategory = "security" | "bug" | "maintainability";

export interface ExecResult {
  stdout: string;
  exitCode: number;
}

export interface ExecOpts {
  cwd?: string;
  /** Written to the child's stdin. */
  input?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

/** Injected in tests; defaults to a synchronous execFile wrapper. */
export type ExecFn = (cmd: string, args: string[], opts: ExecOpts) => ExecResult;

interface ExecFailure {
  stdout?: string | Buffer;
  status?: number | null;
  signal?: string | null;
  code?: string;
  message?: string;
}

/**
 * Run a command without a shell. Non-zero exits come back as `exitCode` so the
 * caller can decide whether the output is still usable (gitleaks and eslint both
 * exit non-zero when they *find* something). Timeouts, signals and spawn
 * failures are rethrown for the caller to report as a skip.
 */
export const defaultExec: ExecFn = (cmd, args, opts) => {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: "utf8",
      timeout: opts.timeoutMs,
      maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, exitCode: 0 };
  } catch (e) {
    const failure = e as ExecFailure;
    const stdout =
      typeof failure.stdout === "string" ? failure.stdout : (failure.stdout?.toString("utf8") ?? "");
    if (typeof failure.status === "number") return { stdout, exitCode: failure.status };
    throw e;
  }
};

/** POSIX single-quote a value for the `command -v` shell probe. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Default availability probe: `command -v <tool>`, swallowed to a boolean. */
export function isToolAvailable(tool: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${shellQuote(tool)}`], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** True when a `eslint.config.*` or `.eslintrc*` file sits at the repo root. */
export function hasEslintConfig(cwd: string): boolean {
  try {
    return readdirSync(cwd).some(
      (name) => name.startsWith("eslint.config.") || name.startsWith(".eslintrc"),
    );
  } catch {
    return false;
  }
}

/**
 * Make a path reported by a tool repo-relative: strip the cwd prefix and any
 * leading `./`. Paths outside cwd stay outside (their leading slash is removed
 * so they cannot match a repo file).
 */
export function relativePath(filePath: string, cwd: string): string {
  const p = filePath.trim().replace(/\\/g, "/");
  const base = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  let out = p;
  if (base && (p === base || p.startsWith(base + "/"))) out = p.slice(base.length);
  out = out.replace(/^\/+/, "");
  out = out.replace(/^(?:\.\/)+/, "");
  return out;
}

/** Best-effort JSON parse that never throws. `null` means "not valid JSON". */
export function tryParseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asLine(value: unknown): number {
  const n = asNumber(value);
  if (n === undefined || n < 1) return 1;
  return Math.trunc(n);
}

// ---------------------------------------------------------------------------
// gitleaks
// ---------------------------------------------------------------------------

export interface GitleaksFinding {
  file: string;
  line: number;
  rule: string;
  description: string;
}

/**
 * Parse `gitleaks detect --report-format json` output.
 * The `Secret` field is intentionally never read into the result.
 */
export function parseGitleaksJson(raw: string): GitleaksFinding[] {
  const data = tryParseJson(raw);
  if (!Array.isArray(data)) return [];
  const out: GitleaksFinding[] = [];
  for (const item of data) {
    const record = asRecord(item);
    if (!record) continue;
    const file = asString(record.File);
    if (!file) continue;
    out.push({
      file,
      line: asLine(record.StartLine),
      rule: asString(record.RuleID) ?? "unknown",
      description: asString(record.Description) ?? "hardcoded secret",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// semgrep
// ---------------------------------------------------------------------------

export interface SemgrepFinding {
  file: string;
  line: number;
  checkId: string;
  message: string;
  severity: LintSeverity;
}

/** semgrep severity → our severity. Unknown values degrade to low. */
export function severityForSemgrep(severity: string): LintSeverity {
  switch (severity.toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "low";
  }
}

/** Rule ids that read like security checks become `security`, everything else `bug`. */
export function categoryForSemgrep(checkId: string): LintCategory {
  return /security|injection|secret/i.test(checkId) ? "security" : "bug";
}

/** Parse `semgrep --json` output. Network/config errors produce no results. */
export function parseSemgrepJson(raw: string): SemgrepFinding[] {
  const data = asRecord(tryParseJson(raw));
  if (!data) return [];
  const out: SemgrepFinding[] = [];
  for (const item of asArray(data.results)) {
    const record = asRecord(item);
    if (!record) continue;
    const file = asString(record.path);
    const checkId = asString(record.check_id);
    if (!file || !checkId) continue;
    const start = asRecord(record.start);
    const extra = asRecord(record.extra);
    out.push({
      file,
      line: asLine(start?.line),
      checkId,
      message: asString(extra?.message) ?? checkId,
      severity: severityForSemgrep(asString(extra?.severity) ?? "INFO"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// eslint
// ---------------------------------------------------------------------------

export interface EslintFinding {
  file: string;
  line: number;
  ruleId: string | null;
  message: string;
  severity: LintSeverity;
}

/** Parse `eslint --format json` output. severity 2 → medium, 1 → low. */
export function parseEslintJson(raw: string): EslintFinding[] {
  const data = tryParseJson(raw);
  if (!Array.isArray(data)) return [];
  const out: EslintFinding[] = [];
  for (const item of data) {
    const record = asRecord(item);
    if (!record) continue;
    const file = asString(record.filePath);
    if (!file) continue;
    for (const messageItem of asArray(record.messages)) {
      const message = asRecord(messageItem);
      if (!message) continue;
      const rawSeverity = asNumber(message.severity);
      if (rawSeverity !== 1 && rawSeverity !== 2) continue;
      out.push({
        file,
        line: asLine(message.line),
        ruleId: asString(message.ruleId) ?? null,
        message: asString(message.message) ?? "eslint reported a problem",
        severity: rawSeverity === 2 ? "medium" : "low",
      });
    }
  }
  return out;
}
