#!/usr/bin/env -S npx tsx
// Command-line interface for Bug Hunter.
//
// The CLI reuses the real pipeline (parsePatch → filterFiles → runHunt) but
// takes its input from local git instead of the GitHub API. Two deliberate
// constraints shape this file:
//
//   1. It must never import src/env.ts. That module validates server-only vars
//      (GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, …) and calls process.exit(1) at
//      import time, which would make the CLI unusable in a plain repo. Model
//      settings are read straight from process.env, with the same defaults the
//      server uses.
//   2. parseArgs and the format functions are pure so they can be unit-tested
//      without git, network or a model.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { annotateDiff } from "./diff/annotate";
import { parsePatch } from "./diff/parse";
import { planBudget, trimContext } from "./hunt/budget";
import { filterFiles } from "./hunt/filters";
import { runHunt, type HuntDeps, type HuntResult } from "./hunt/pipeline";
import { formatLintFindings, runLinters } from "./lint";
import { costOf, formatUsd } from "./cost";
import { resolveModelConfig, type LlmProvider, type ModelConfig, type ModelEnv } from "./llm/config";
import { generateStructured } from "./llm/structured";
import { loadAllPrompts } from "./prompts";
import { scrubSecrets } from "./security";
import { ReviewOutput, SeanceOutput, Verdict, type ChangedFile, type KeptFinding } from "./types";

// ---------------------------------------------------------------------------
// Argument parsing (pure — unit-tested)
// ---------------------------------------------------------------------------

export type OutputFormat = "text" | "json" | "prompt-only";

/** Where the diff comes from. */
export type DiffSource =
  | { kind: "staged" }
  | { kind: "base"; ref: string }
  | { kind: "commit"; sha: string };

export type HelpTopic = "review" | "init" | "config" | null;

export type Command =
  | { kind: "help"; topic: HelpTopic }
  | {
      kind: "review";
      source: DiffSource;
      format: OutputFormat;
      model: { provider: LlmProvider; model: string } | null;
      rules: string | null;
    }
  | { kind: "init" }
  | { kind: "config-validate"; path: string }
  | { kind: "error"; message: string };

const FORMATS: readonly OutputFormat[] = ["text", "json", "prompt-only"];

export const PROVIDERS: readonly LlmProvider[] = [
  "google",
  "openai",
  "anthropic",
  "opencode",
  "deepseek",
  "openrouter",
  "ollama",
  "openai-compatible",
];

function isProvider(v: string): v is LlmProvider {
  return (PROVIDERS as readonly string[]).includes(v);
}

function isFormat(v: string): v is OutputFormat {
  return (FORMATS as readonly string[]).includes(v);
}

function usage(message: string): Command {
  return { kind: "error", message };
}

/** Split `--flag=value` into flag + value, leaving `--flag` untouched. */
function splitFlag(token: string): { flag: string; value?: string } {
  const eq = token.indexOf("=");
  if (token.startsWith("--") && eq > 2) {
    return { flag: token.slice(0, eq), value: token.slice(eq + 1) };
  }
  return { flag: token };
}

/** `ref`/`sha`/path values must never look like another flag (git would read it as one). */
function isUnsafeValue(v: string): boolean {
  return v.length === 0 || v.startsWith("-");
}

function parseReview(argv: readonly string[]): Command {
  let source: DiffSource | null = null;
  let format: OutputFormat = "text";
  let model: { provider: LlmProvider; model: string } | null = null;
  let rules: string | null = null;

  const setSource = (next: DiffSource): Command | null => {
    if (source) return usage("choose only one of --staged, --base, --commit");
    source = next;
    return null;
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    const { flag, value } = splitFlag(token);

    if (flag === "-h" || flag === "--help") return { kind: "help", topic: "review" };

    // Reads the flag's value from `--flag=value` or the next token.
    const take = (): string | null => {
      if (value !== undefined) return value;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return null;
      i += 1;
      return next;
    };

    switch (flag) {
      case "--staged": {
        if (value !== undefined) return usage("--staged takes no value");
        const err = setSource({ kind: "staged" });
        if (err) return err;
        break;
      }
      case "--base": {
        const v = take();
        if (v === null || isUnsafeValue(v)) return usage("--base needs a git ref, e.g. --base main");
        const err = setSource({ kind: "base", ref: v });
        if (err) return err;
        break;
      }
      case "--commit": {
        const v = take();
        if (v === null || isUnsafeValue(v)) return usage("--commit needs a commit SHA, e.g. --commit HEAD~1");
        const err = setSource({ kind: "commit", sha: v });
        if (err) return err;
        break;
      }
      case "--format": {
        const v = take();
        if (v === null) return usage(`--format needs one of: ${FORMATS.join(", ")}`);
        if (!isFormat(v)) return usage(`unknown --format "${v}" (expected ${FORMATS.join(", ")})`);
        format = v;
        break;
      }
      case "--model": {
        const v = take();
        if (v === null) return usage("--model needs a value shaped like provider:model");
        const colon = v.indexOf(":");
        const provider = colon > 0 ? v.slice(0, colon) : "";
        const name = colon > 0 ? v.slice(colon + 1) : "";
        if (!provider || !name) return usage(`--model "${v}" must be provider:model, e.g. anthropic:claude-sonnet-4-5`);
        if (!isProvider(provider)) {
          return usage(`unknown model provider "${provider}" (expected one of: ${PROVIDERS.join(", ")})`);
        }
        model = { provider, model: name };
        break;
      }
      case "--rules": {
        const v = take();
        if (v === null || isUnsafeValue(v)) return usage("--rules needs a path to a rules file");
        rules = v;
        break;
      }
      default:
        if (flag.startsWith("-")) return usage(`unknown option for review: ${flag}`);
        return usage(`unexpected argument for review: ${token}`);
    }
    i += 1;
  }

  return { kind: "review", source: source ?? { kind: "staged" }, format, model, rules };
}

/** Parse argv (without `node`/script) into a command. Never throws. */
export function parseArgs(argv: readonly string[]): Command {
  const [head, ...rest] = argv;

  // `bughunter` bare, `bughunter --help` and `bughunter -h`.
  if (head === undefined || head === "-h" || head === "--help") {
    return { kind: "help", topic: null };
  }

  if (head.startsWith("-")) return usage(`unknown option: ${head}`);

  switch (head) {
    case "review":
      return parseReview(rest);

    case "init": {
      for (const token of rest) {
        if (token === "-h" || token === "--help") return { kind: "help", topic: "init" };
        return usage(`init takes no arguments (got: ${token})`);
      }
      return { kind: "init" };
    }

    case "config": {
      const [sub, ...tail] = rest;
      if (sub === undefined) return usage('config needs a subcommand: "validate"');
      if (sub === "-h" || sub === "--help") return { kind: "help", topic: "config" };
      if (sub !== "validate") return usage(`unknown config subcommand "${sub}" (expected "validate")`);

      let path = ".bughunter.md";
      for (const token of tail) {
        if (token === "-h" || token === "--help") return { kind: "help", topic: "config" };
        if (token.startsWith("-")) return usage(`unknown option for config validate: ${token}`);
        if (path !== ".bughunter.md") return usage("config validate takes at most one path");
        path = token;
      }
      return { kind: "config-validate", path };
    }

    default:
      return usage(`unknown command "${head}" (try: review, init, config validate, --help)`);
  }
}

// ---------------------------------------------------------------------------
// Human / agent formatting (pure — unit-tested)
// ---------------------------------------------------------------------------

/** Collapse a fix into one line for the prompt-only list. */
function oneLineFix(f: KeptFinding): string {
  const first = (f.fix_code ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const text =
    first ?? (f.explanation.trim().split(/(?<=[.!?])\s/)[0] ?? f.explanation.trim());
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

function location(f: KeptFinding, withRange: boolean): string {
  const start = f.position?.start_line ?? f.start_line;
  const end = f.position?.end_line ?? f.end_line;
  return withRange && end > start ? `${f.file}:${start}-${end}` : `${f.file}:${start}`;
}

/**
 * Compact, paste-into-an-agent list: `file:line severity title — fix`.
 * Kept findings first, then unanchored (lurking) findings, matching the report.
 */
export function formatPromptOnly(result: HuntResult): string {
  const findings = [...result.kept, ...result.lurking];
  if (findings.length === 0) return "No findings.";
  return findings
    .map((f) => `${location(f, false)} ${f.adjusted_severity} ${f.title} — ${oneLineFix(f)}`)
    .join("\n");
}

function findingBlock(f: KeptFinding): string[] {
  const lines: string[] = [];
  lines.push(
    `[${f.adjusted_severity}] ${location(f, true)}  ${f.title}  (${f.category}, confidence ${f.adjusted_confidence.toFixed(2)})`,
  );
  if (f.explanation.trim()) {
    for (const line of f.explanation.trim().split("\n")) lines.push(`  ${line}`);
  }
  if (f.fix_ok && f.fix_code && f.fix_kind !== "none") {
    lines.push("  fix:");
    for (const line of f.fix_code.split("\n")) lines.push(`    ${line}`);
  }
  return lines;
}

/** Human-readable report, deterministic (no timestamps, no absolute paths). */
export function formatText(result: HuntResult): string {
  const out: string[] = [];
  out.push(`🎃 Bug Hunter — ${result.haunting.title}`);
  out.push("");
  if (result.possessionAttempt) {
    out.push(
      "⚠ Possession attempt detected: hidden instructions in the PR text were withheld from the model.",
      "",
    );
  }
  if (result.verifierFailed) {
    out.push("⚠ Verifier pass failed: findings below are unverified.", "");
  }
  out.push(result.summary.summary.trim() || "(no summary)");
  out.push("");
  const { critical, high, medium, low, nitpick } = result.counts;
  out.push(
    `Findings: ${critical} critical, ${high} high, ${medium} medium, ${low} low, ${nitpick} nitpick.`,
  );

  if (result.kept.length === 0 && result.lurking.length === 0) {
    out.push("");
    out.push("No findings.");
  }

  for (const f of result.kept) {
    out.push("");
    out.push(...findingBlock(f));
  }

  if (result.lurking.length > 0) {
    out.push("");
    out.push("Lurking outside the diff (real findings that could not be anchored to a changed line):");
    for (const f of result.lurking) {
      out.push("");
      out.push(...findingBlock(f));
    }
  }

  if (result.skipped.length > 0) {
    out.push("");
    out.push(`Skipped ${result.skipped.length} file(s):`);
    for (const s of result.skipped) out.push(`  ${s.path} — ${s.reason}`);
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Unified-diff parsing (git output → ChangedFile[])
// ---------------------------------------------------------------------------

/** Decode git's C-style quoted path (`"b/foo\tbar"`). */
function unquote(raw: string): string {
  const s = raw.trim();
  if (!s.startsWith('"')) return s;
  const inner = s.replace(/^"/, "").replace(/"$/, "");
  return inner.replace(/\\([0-7]{3}|x[0-9a-fA-F]{2}|.)/g, (_, esc: string) => {
    if (/^[0-7]{3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    if (esc.startsWith("x")) return String.fromCharCode(parseInt(esc.slice(1), 16));
    const map: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      '"': '"',
      "\\": "\\",
      a: "\x07",
      b: "\b",
      f: "\f",
      v: "\v",
    };
    return map[esc] ?? esc;
  });
}

function pathFromLine(raw: string, prefix: "a" | "b"): string | null {
  const value = unquote(raw);
  if (value === "/dev/null") return null;
  return value.startsWith(`${prefix}/`) ? value.slice(2) : value;
}

function filenameFromHeader(header: string): string {
  const rest = header.slice("diff --git ".length);
  // Quoted pair: `"a/old name" "b/new name"`.
  const quoted = rest.match(/^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/);
  if (quoted) return pathFromLine(quoted[2], "b") ?? "";
  const idx = rest.lastIndexOf(" b/");
  if (idx >= 0) return unquote(rest.slice(idx + 3));
  return rest.replace(/^a\//, "");
}

function parseSection(lines: string[]): ChangedFile | null {
  const header = lines[0] ?? "";
  let status = "modified";
  let minusPath: string | null = null;
  let plusPath: string | null = null;
  let renamedFrom: string | null = null;
  let renamedTo: string | null = null;
  let isBinary = false;
  let firstHunk = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@ ")) {
      firstHunk = i;
      break;
    }
    if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "removed";
    else if (line.startsWith("rename from ")) {
      renamedFrom = unquote(line.slice("rename from ".length));
      status = "renamed";
    } else if (line.startsWith("rename to ")) {
      renamedTo = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("copy from ")) {
      renamedFrom = unquote(line.slice("copy from ".length));
      status = "copied";
    } else if (line.startsWith("copy to ")) {
      renamedTo = unquote(line.slice("copy to ".length));
    } else if (line.startsWith("--- ")) {
      minusPath = pathFromLine(line.slice(4), "a");
    } else if (line.startsWith("+++ ")) {
      plusPath = pathFromLine(line.slice(4), "b");
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      isBinary = true;
    }
  }

  const filename =
    plusPath ?? renamedTo ?? minusPath ?? renamedFrom ?? filenameFromHeader(header);

  if (!filename) return null;

  const patch = firstHunk >= 0 ? lines.slice(firstHunk).join("\n") : undefined;
  const hunks = patch ? parsePatch(patch) : [];

  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions += 1;
      else if (line.type === "del") deletions += 1;
    }
  }

  return {
    filename,
    status,
    previous_filename: renamedFrom ?? undefined,
    additions,
    deletions,
    patch,
    hunks,
    isBinary,
  };
}

/**
 * Split `git diff` / `git show` output into changed files and parse each patch.
 * Sections before the first `diff --git` (commit metadata from `git show`) are
 * ignored.
 */
export function parseUnifiedDiff(raw: string): ChangedFile[] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) sections.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current);

  return sections
    .map(parseSection)
    .filter((file): file is ChangedFile => file !== null);
}

// ---------------------------------------------------------------------------
// Repo rules + local context
// ---------------------------------------------------------------------------

// Mirrors src/hunt/context.ts. Those constants can't be imported here because
// that module pulls in the GitHub client, which imports src/env.ts (server-only
// vars, process.exit on failure).
const RULE_FILES = [".bughunter.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"] as const;
const BUGHUNTER_MAX = 2000;
const REPO_RULES_MAX = 6000;

const MAX_CONTEXT_FILES = 12;
const FULL_FILE_LINES = 400;
const CONTEXT_WINDOW = 40;

/**
 * Repo rules from the working tree. Unlike the server (which reads the PR's
 * base branch), the CLI cannot know the base branch, so it reads what is on
 * disk. `--rules` replaces the automatic lookup with a single file.
 */
export function readLocalRules(root: string, explicitPath?: string | null): string {
  const read = (path: string): string =>
    readFileSync(resolve(root, path), "utf8").slice(0, BUGHUNTER_MAX);

  if (explicitPath) {
    const content = readFileSync(resolve(explicitPath), "utf8").slice(0, REPO_RULES_MAX);
    return content.trim() ? `### From ${explicitPath}\n${content}` : "(none)";
  }

  const parts: string[] = [];
  for (const path of RULE_FILES) {
    if (!existsSync(resolve(root, path))) continue;
    const capped = read(path);
    if (!capped.trim()) continue;
    parts.push(`### From ${path}\n${capped}`);
    if (parts.join("\n\n").length >= REPO_RULES_MAX) break;
  }
  const out = parts.join("\n\n").slice(0, REPO_RULES_MAX);
  return out.trim() ? out : "(none)";
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.filter(([s, e]) => s <= e).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Read context from the working tree: whole small files, hunk windows for large
 * ones. Approximates the server's buildContext without any GitHub calls.
 */
export function buildLocalContext(root: string, files: ChangedFile[]): string {
  const rootAbs = resolve(root);
  const parts: string[] = [];

  for (const file of files.slice(0, MAX_CONTEXT_FILES)) {
    if (file.isBinary || !file.patch) continue;
    const abs = resolve(rootAbs, file.filename);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) continue; // no path escape
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue; // deleted file
    }

    const lines = content.split("\n");
    if (lines.length <= FULL_FILE_LINES) {
      parts.push(`### [file] ${file.filename}\n${content}`);
      continue;
    }

    const ranges = mergeRanges(
      file.hunks.map((hunk) => {
        let end = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.newLine !== undefined && line.newLine > end) end = line.newLine;
        }
        return [Math.max(1, hunk.newStart - CONTEXT_WINDOW), end + CONTEXT_WINDOW] as [number, number];
      }),
    );
    for (const [start, end] of ranges) {
      const slice = lines
        .slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join("\n");
      parts.push(`### [file] ${file.filename} (lines ${start}-${end})\n${slice}`);
    }
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Git access
// ---------------------------------------------------------------------------

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Run git with an argument array (never a shell string) and return stdout. */
function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Best-effort git query: null instead of throwing. */
function gitOrNull(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd).trim();
  } catch {
    return null;
  }
}

function diffArgs(source: DiffSource): string[] {
  switch (source.kind) {
    case "staged":
      return ["diff", "--staged", "--no-color", "--no-ext-diff"];
    case "base":
      return ["diff", "--no-color", "--no-ext-diff", `${source.ref}...HEAD`];
    case "commit":
      return ["show", "--format=", "--no-color", "--no-ext-diff", "--patch", source.sha];
  }
}

interface RepoInfo {
  root: string;
  owner: string;
  repo: string;
  headSha: string;
  title: string;
  body: string;
}

function repoInfo(cwd: string): RepoInfo {
  const root = gitOrNull(["rev-parse", "--show-toplevel"], cwd) ?? cwd;
  const remote = gitOrNull(["remote", "get-url", "origin"], root) ?? "";
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  const headSha = gitOrNull(["rev-parse", "HEAD"], root) ?? "local";
  const title = gitOrNull(["log", "-1", "--format=%s"], root) ?? "Local review";
  const body = gitOrNull(["log", "-1", "--format=%b"], root) ?? "";
  return {
    root,
    owner: match?.[1] ?? "local",
    repo: match?.[2] ?? (root.split(sep).pop() || "repo"),
    headSha,
    title,
    body,
  };
}

// ---------------------------------------------------------------------------
// Model wiring (env only — no src/env.ts import)
// ---------------------------------------------------------------------------

export interface ModelEnvResult {
  env: ModelEnv;
  error?: string;
}

/** Build the model env from process.env, applying an optional `--model` override. */
export function buildModelEnv(
  override: { provider: LlmProvider; model: string } | null,
  source: NodeJS.ProcessEnv = process.env,
): ModelEnvResult {
  const read = (name: string): string => (source[name] ?? "").trim();

  const rawProvider = override?.provider ?? read("LLM_PROVIDER") ?? "";
  const providerName = rawProvider || "google";
  if (!isProvider(providerName)) {
    return {
      env: {
        LLM_PROVIDER: "google",
        LLM_MODEL_REVIEW: "",
        LLM_MODEL_FAST: "",
        GEMINI_MODEL_REVIEW: "",
        GEMINI_MODEL_FAST: "",
        LLM_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        LLM_BASE_URL: "",
      },
      error: `unknown LLM_PROVIDER "${providerName}" (expected one of: ${PROVIDERS.join(", ")})`,
    };
  }

  const apiKey = read("LLM_API_KEY");
  const googleKey = read("GOOGLE_GENERATIVE_AI_API_KEY");
  const baseUrl = read("LLM_BASE_URL");
  const reviewModel = override?.model || read("LLM_MODEL_REVIEW");
  const fastModel = override?.model || read("LLM_MODEL_FAST") || reviewModel;
  const geminiReview = override?.model || read("GEMINI_MODEL_REVIEW") || "gemini-flash-latest";
  const geminiFast = override?.model || read("GEMINI_MODEL_FAST") || geminiReview;

  const env: ModelEnv = {
    LLM_PROVIDER: providerName,
    LLM_MODEL_REVIEW: reviewModel,
    LLM_MODEL_FAST: fastModel,
    GEMINI_MODEL_REVIEW: geminiReview,
    GEMINI_MODEL_FAST: geminiFast,
    LLM_API_KEY: apiKey,
    GOOGLE_GENERATIVE_AI_API_KEY: googleKey,
    LLM_BASE_URL: baseUrl,
  };

  if (providerName === "google" && !googleKey) {
    return {
      env,
      error:
        "GOOGLE_GENERATIVE_AI_API_KEY is not set. Set it, or pick another provider with " +
        "--model <provider:model> and LLM_API_KEY.",
    };
  }
  if (providerName !== "google" && providerName !== "ollama" && !apiKey) {
    return { env, error: `LLM_API_KEY is not set (required for LLM_PROVIDER=${providerName}).` };
  }
  if (providerName !== "google" && !reviewModel) {
    return {
      env,
      error:
        `LLM_MODEL_REVIEW is not set (required for LLM_PROVIDER=${providerName}); ` +
        `pass --model ${providerName}:<model> or set LLM_MODEL_REVIEW.`,
    };
  }
  if (providerName === "openai-compatible" && !baseUrl) {
    return { env, error: "LLM_BASE_URL is not set (required for LLM_PROVIDER=openai-compatible)." };
  }

  return { env };
}

/**
 * Provider clients, mirroring src/llm/models.ts. That module cannot be imported
 * here: it imports src/env.ts, which exits on missing server-only vars.
 */
function createModel(cfg: ModelConfig, sessionId: string): LanguageModel {
  switch (cfg.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined })(cfg.model);
    case "openrouter":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
    case "opencode":
      return createOpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
        headers: {
          // Required by the Go endpoint (400 MissingSessionID otherwise).
          "x-opencode-session": sessionId,
          "user-agent": "bug-hunter/1.0",
        },
      })(cfg.model);
    case "deepseek":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
    case "ollama":
      return createOpenAI({ apiKey: cfg.apiKey || "ollama", baseURL: cfg.baseUrl })(cfg.model);
    case "openai-compatible":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
  }
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

let dotEnvLoaded = false;

/** Node 22+: load .env from the current directory, once. Missing file is fine. */
function loadDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  const nodeProc = process as unknown as { loadEnvFile?: (p?: string) => void };
  try {
    nodeProc.loadEnvFile?.();
  } catch {
    // No .env — the environment is used as-is.
  }
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    err(`bughunter: ignoring ${name}="${raw}" (expected an integer ${min}..${max}); using ${fallback}`);
    return fallback;
  }
  return value;
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    err(`bughunter: ignoring ${name}="${raw}" (expected a number ${min}..${max}); using ${fallback}`);
    return fallback;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function err(text: string): void {
  process.stderr.write(`${text}\n`);
}

function errorMessage(e: unknown): string {
  return scrubSecrets(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const TEMPLATE = `# .bughunter.md

Instructions Bug Hunter follows when reviewing this repository. Keep it short
(2000 characters max) and specific — this file is injected into every review.

## Prioritise
- Correctness, security, data integrity and concurrency bugs.
- Missing error handling on I/O, network and database calls.
- Breaking changes to public APIs or on-disk formats.

## Ignore
- Style and formatting already enforced by the linter/formatter.
- Generated, vendored, lockfile and minified files (skipped automatically).

## Conventions
- Example: "Use parameterised SQL, never string interpolation."
- Example: "New endpoints must validate input with zod."
`;

export interface RulesValidation {
  ok: boolean;
  message: string;
}

/** Validate a rules file: exists, non-empty, within the 2000-character cap. */
export function validateRulesFile(path: string): RulesValidation {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (code === "ENOENT") return { ok: false, message: `${path} not found` };
    if (code === "EISDIR") return { ok: false, message: `${path} is a directory, not a file` };
    return { ok: false, message: `${path} could not be read: ${errorMessage(e)}` };
  }
  if (!content.trim()) return { ok: false, message: `${path} is empty` };
  if (content.length > BUGHUNTER_MAX) {
    return {
      ok: false,
      message: `${path} is ${content.length} characters; the limit is ${BUGHUNTER_MAX}. Trim ${content.length - BUGHUNTER_MAX}.`,
    };
  }
  return { ok: true, message: `OK: ${path} (${content.length} characters, limit ${BUGHUNTER_MAX})` };
}

function runInit(): number {
  const target = resolve(process.cwd(), ".bughunter.md");
  if (existsSync(target)) {
    out(`.bughunter.md already exists at ${target} — leaving it untouched.`);
    return 0;
  }
  writeFileSync(target, TEMPLATE, "utf8");
  out(`Created ${target}`);
  out("Edit it to tell Bug Hunter what to prioritise (max 2000 characters).");
  return 0;
}

function runConfigValidate(path: string): number {
  const result = validateRulesFile(resolve(process.cwd(), path));
  if (!result.ok) {
    err(`✗ ${result.message}`);
    return 1;
  }
  out(`✓ ${result.message}`);
  return 0;
}

async function runReview(cmd: Extract<Command, { kind: "review" }>): Promise<number> {
  const info = repoInfo(process.cwd());

  let rawDiff: string;
  try {
    rawDiff = git(diffArgs(cmd.source), info.root);
  } catch (e) {
    err(`bughunter: git failed: ${errorMessage(e)}`);
    return 1;
  }

  const files = parseUnifiedDiff(rawDiff);
  if (files.length === 0) {
    out("No changes to review.");
    return 0;
  }

  // Same filter the server applies: lockfiles, generated, vendored, binaries,
  // minified files and the 40-file cap never reach the model.
  const { kept: hunted, skipped } = filterFiles(files);
  if (hunted.length === 0) {
    const reasons = new Map<string, number>();
    for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    const summary = [...reasons.entries()].map(([reason, n]) => `${n} × ${reason}`).join(", ");
    out(`Nothing to review: no reviewable files changed${summary ? ` (${summary})` : ""}.`);
    return 0;
  }

  // Rules first: a missing --rules file is a usage error, not a model failure.
  let repoRules: string;
  try {
    repoRules = cmd.rules ? readLocalRules(info.root, cmd.rules) : readLocalRules(info.root);
  } catch (e) {
    err(`bughunter: cannot read rules: ${errorMessage(e)}`);
    return 1;
  }

  // Model config is validated before any spend.
  const modelEnv = buildModelEnv(cmd.model);
  if (modelEnv.error) {
    err(`bughunter: ${modelEnv.error}`);
    return 1;
  }
  const modelEnvValue = modelEnv.env;

  const fullDiff = annotateDiff(hunted).text;
  const { diffMaxChars, contextMaxChars } = planBudget(fullDiff.length);
  const annotatedDiff = annotateDiff(hunted, { maxChars: diffMaxChars }).text;
  const context = trimContext(buildLocalContext(info.root, hunted), contextMaxChars);

  // Deterministic linters run only where a real checkout exists (the CLI), and
  // only when explicitly enabled. Findings are advisory prompt context.
  let lintFindings = "(none)";
  if (process.env.LINT_ENABLED === "true") {
    const lint = await runLinters(
      hunted.map((f) => ({ path: f.filename, patch: f.patch ?? "" })),
      { cwd: info.root },
    );
    lintFindings = formatLintFindings(lint.findings);
    const tools = lint.toolsRun.length ? lint.toolsRun.join(", ") : "none";
    const skipped = lint.skipped.map((s) => `${s.tool} (${s.reason})`).join(", ");
    err(
      `bughunter: linters ran: ${tools}; ${lint.findings.length} finding(s)` +
        (skipped ? `; skipped: ${skipped}` : ""),
    );
  }

  const sessionId = `bh-${randomUUID()}`;
  const tokens = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (u: { inputTokens: number; outputTokens: number }): void => {
    tokens.inputTokens += u.inputTokens;
    tokens.outputTokens += u.outputTokens;
  };
  const deps: HuntDeps = {
    review: ({ system, user }) =>
      generateStructured({
        model: createModel(resolveModelConfig(modelEnvValue, "review"), sessionId),
        schema: ReviewOutput,
        system,
        prompt: user,
        label: "review",
        onUsage: addUsage,
      }),
    verify: ({ system, user }) =>
      generateStructured({
        model: createModel(resolveModelConfig(modelEnvValue, "verify"), sessionId),
        schema: Verdict,
        system,
        prompt: user,
        label: "verify",
        onUsage: addUsage,
      }),
    seance: ({ system, user }) =>
      generateStructured({
        model: createModel(resolveModelConfig(modelEnvValue, "fast"), sessionId),
        schema: SeanceOutput,
        system,
        prompt: user,
        label: "seance",
        onUsage: addUsage,
      }),
  };

  let result: HuntResult;
  try {
    result = await runHunt(
      {
        owner: info.owner,
        repo: info.repo,
        prNumber: 0,
        headSha: info.headSha,
        prTitle: info.title,
        prBody: info.body,
        lintFindings,
        files,
        repoRules,
        context,
        annotatedDiff,
        prompts: loadAllPrompts(),
        maxFindings: envInt("MAX_FINDINGS", 12, 1, 40),
        confidenceThreshold: envFloat("CONFIDENCE_THRESHOLD", 0.7, 0, 1),
      },
      deps,
    );
  } catch (e) {
    err(`bughunter: model call failed: ${errorMessage(e)}`);
    return 2;
  }

  const modelCfg = resolveModelConfig(modelEnvValue, "review");
  const costUsd = costOf(tokens, modelCfg.provider, modelCfg.model);
  if (tokens.inputTokens + tokens.outputTokens > 0) {
    err(
      `bughunter: ${tokens.inputTokens + tokens.outputTokens} tokens` +
        (costUsd === null ? " (price unknown for this model)" : ` · ${formatUsd(costUsd)}`),
    );
  }

  const formatted =
    cmd.format === "json"
      ? JSON.stringify(result, null, 2)
      : cmd.format === "prompt-only"
        ? formatPromptOnly(result)
        : formatText(result);
  out(formatted);
  return 0;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP_MAIN = `bughunter — run Bug Hunter's AI review on local changes.

Usage:
  bughunter review [options]        Review the current git changes
  bughunter init                    Write a .bughunter.md template
  bughunter config validate [path]  Check .bughunter.md (default: .bughunter.md)
  bughunter --help                  Show this help

Run "bughunter <command> --help" for command options.

Exit codes: 0 ok (findings included) · 1 usage/config error · 2 model call failed.`;

const HELP_REVIEW = `Review local git changes with the same pipeline the server uses.

Usage:
  bughunter review [--staged | --base <ref> | --commit <sha>]
                   [--format text|json|prompt-only]
                   [--model <provider:model>]
                   [--rules <path>]

Change source (default: --staged):
  --staged              git diff --staged
  --base <ref>          git diff <ref>...HEAD
  --commit <sha>        git show <sha>

Output:
  --format text         human-readable report (default)
  --format json         the full HuntResult as JSON
  --format prompt-only  compact "file:line severity title — fix" list for an agent

Model (defaults come from the environment):
  --model <provider:model>   e.g. anthropic:claude-sonnet-4-5, deepseek:deepseek-chat
  Providers: ${PROVIDERS.join(", ")}

Rules:
  --rules <path>        use one rules file instead of .bughunter.md / AGENTS.md /
                        CLAUDE.md / .cursorrules from the repo root

Environment: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL_REVIEW, LLM_MODEL_FAST,
LLM_BASE_URL, GEMINI_MODEL_REVIEW, GEMINI_MODEL_FAST, GOOGLE_GENERATIVE_AI_API_KEY,
MAX_FINDINGS, CONFIDENCE_THRESHOLD. A .env in the current directory is loaded.

Exit codes: 0 ok (findings included) · 1 usage/config error · 2 model call failed.`;

const HELP_INIT = `Write a .bughunter.md template into the current repository.

Usage:
  bughunter init

Never overwrites an existing .bughunter.md. The file is capped at 2000 characters.`;

const HELP_CONFIG = `Validate a .bughunter.md rules file.

Usage:
  bughunter config validate [path]   (default: .bughunter.md)

Checks that the file exists, is not empty, and is within the 2000-character cap.
Exit code 0 when valid, 1 otherwise.`;

function helpFor(topic: HelpTopic): string {
  switch (topic) {
    case "review":
      return HELP_REVIEW;
    case "init":
      return HELP_INIT;
    case "config":
      return HELP_CONFIG;
    default:
      return HELP_MAIN;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Run one command and return the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  loadDotEnv();
  const command = parseArgs(argv);

  switch (command.kind) {
    case "help":
      out(helpFor(command.topic));
      return 0;
    case "error":
      err(`bughunter: ${command.message}`);
      err('Run "bughunter --help" for usage.');
      return 1;
    case "init":
      return runInit();
    case "config-validate":
      return runConfigValidate(command.path);
    case "review":
      return runReview(command);
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      err(`bughunter: ${errorMessage(e)}`);
      process.exitCode = 2;
    },
  );
}
