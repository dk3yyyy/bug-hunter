// CLI tests: pure argument parsing + report formatting. No git, no network, no
// model calls — everything here runs from fixtures.

import { describe, expect, it } from "vitest";
import {
  formatPromptOnly,
  formatText,
  parseArgs,
  parseUnifiedDiff,
  type Command,
} from "../src/cli";
import type { HuntResult } from "../src/hunt/pipeline";
import type { KeptFinding } from "../src/types";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function keptFinding(over: Partial<KeptFinding> = {}): KeptFinding {
  return {
    id: "f1",
    fingerprint: "a".repeat(40),
    file: "src/candy.ts",
    start_line: 15,
    end_line: 15,
    severity: "critical",
    adjusted_severity: "critical",
    category: "security",
    confidence: 0.95,
    adjusted_confidence: 0.95,
    title: "Hard-coded secret",
    explanation: "A password is committed in source.",
    evidence_quote: 'const password = "hunter2";',
    fix_kind: "suggestion",
    fix_code: "const password = process.env.PASSWORD;",
    fix_ok: true,
    position: { file: "src/candy.ts", start_line: 15, end_line: 15 },
    ...over,
  };
}

function huntResult(over: Partial<HuntResult> = {}): HuntResult {
  return {
    possessionAttempt: false,
    hiddenContent: [],
    kept: [keptFinding()],
    lurking: [],
    verifierFailed: false,
    exorcised: [],
    skipped: [{ path: "package-lock.json", reason: "lockfile" }],
    summary: {
      summary: "Adds candy endpoints.",
      change_type: "feature",
      walkthrough: [],
      risk_areas: [],
      effort: 2,
      spooky_tagline: "Trick or treat",
    },
    counts: { critical: 1, high: 0, medium: 0, low: 0, nitpick: 0 },
    haunting: { level: "possessed", title: "Possessed: do not merge" },
    notes: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// parseArgs — review
// ---------------------------------------------------------------------------

describe("parseArgs review", () => {
  it("defaults to --staged and text output", () => {
    expect(parseArgs(["review"])).toEqual({
      kind: "review",
      source: { kind: "staged" },
      format: "text",
      model: null,
      rules: null,
    });
  });

  it("parses --base, --format json and --rules", () => {
    expect(parseArgs(["review", "--base", "main", "--format", "json", "--rules", "RULES.md"])).toEqual({
      kind: "review",
      source: { kind: "base", ref: "main" },
      format: "json",
      model: null,
      rules: "RULES.md",
    });
  });

  it("parses --commit and the --format=value form", () => {
    expect(parseArgs(["review", "--commit", "abc1234", "--format=prompt-only"])).toEqual({
      kind: "review",
      source: { kind: "commit", sha: "abc1234" },
      format: "prompt-only",
      model: null,
      rules: null,
    });
  });

  it("parses --staged explicitly", () => {
    const cmd = parseArgs(["review", "--staged"]);
    expect(cmd).toMatchObject({ kind: "review", source: { kind: "staged" } });
  });

  it("parses --model provider:model, keeping colons inside the model name", () => {
    expect(parseArgs(["review", "--model", "anthropic:claude-sonnet-4-5"])).toMatchObject({
      model: { provider: "anthropic", model: "claude-sonnet-4-5" },
    });
    expect(parseArgs(["review", "--model", "ollama:llama3:8b"])).toMatchObject({
      model: { provider: "ollama", model: "llama3:8b" },
    });
  });

  it("accepts --base=main (equals form) and rejects a ref that looks like a flag", () => {
    expect(parseArgs(["review", "--base=main"])).toMatchObject({
      source: { kind: "base", ref: "main" },
    });
    expect(parseArgs(["review", "--base", "-x"])).toMatchObject({ kind: "error" });
  });

  it("rejects conflicting change sources", () => {
    const cmd = parseArgs(["review", "--staged", "--base", "main"]);
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toMatch(/choose only one/);
  });

  it("rejects unknown flags", () => {
    const cmd = parseArgs(["review", "--nope"]);
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toMatch(/unknown option/);
  });

  it("rejects a flag with a missing value", () => {
    expect(parseArgs(["review", "--base"]).kind).toBe("error");
    expect(parseArgs(["review", "--format"]).kind).toBe("error");
    expect(parseArgs(["review", "--model"]).kind).toBe("error");
  });

  it("rejects an unknown --format", () => {
    const cmd = parseArgs(["review", "--format", "yaml"]);
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toMatch(/unknown --format/);
  });

  it("rejects a --model without provider:model or with an unknown provider", () => {
    expect(parseArgs(["review", "--model", "gpt-4.1"]).kind).toBe("error");
    expect(parseArgs(["review", "--model", "nope:x"]).kind).toBe("error");
  });

  it("rejects stray positionals", () => {
    expect(parseArgs(["review", "src/foo.ts"]).kind).toBe("error");
  });

  it("returns command help for review --help", () => {
    expect(parseArgs(["review", "--help"])).toEqual({ kind: "help", topic: "review" });
    expect(parseArgs(["review", "-h"])).toEqual({ kind: "help", topic: "review" });
  });
});

// ---------------------------------------------------------------------------
// parseArgs — init / config / top level
// ---------------------------------------------------------------------------

describe("parseArgs init and config", () => {
  it("parses init", () => {
    expect(parseArgs(["init"])).toEqual({ kind: "init" });
    expect(parseArgs(["init", "--help"])).toEqual({ kind: "help", topic: "init" });
  });

  it("rejects arguments after init", () => {
    expect(parseArgs(["init", "extra"]).kind).toBe("error");
  });

  it("defaults config validate to .bughunter.md and accepts a path", () => {
    expect(parseArgs(["config", "validate"])).toEqual({
      kind: "config-validate",
      path: ".bughunter.md",
    });
    expect(parseArgs(["config", "validate", "docs/RULES.md"])).toEqual({
      kind: "config-validate",
      path: "docs/RULES.md",
    });
    expect(parseArgs(["config", "validate", "--help"])).toEqual({
      kind: "help",
      topic: "config",
    });
  });

  it("rejects config without a subcommand or with an unknown one", () => {
    expect(parseArgs(["config"]).kind).toBe("error");
    expect(parseArgs(["config", "lint"]).kind).toBe("error");
  });

  it("rejects a second path for config validate", () => {
    expect(parseArgs(["config", "validate", "a", "b"]).kind).toBe("error");
  });

  it("shows top-level help for bare/--help and errors on unknown commands", () => {
    expect(parseArgs([])).toEqual({ kind: "help", topic: null });
    expect(parseArgs(["--help"])).toEqual({ kind: "help", topic: null });
    expect(parseArgs(["-h"])).toEqual({ kind: "help", topic: null });
    expect(parseArgs(["wat"]).kind).toBe("error");
    expect(parseArgs(["--wat"]).kind).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// formatters
// ---------------------------------------------------------------------------

describe("formatPromptOnly", () => {
  it("renders one compact line per finding", () => {
    expect(formatPromptOnly(huntResult())).toBe(
      "src/candy.ts:15 critical Hard-coded secret — const password = process.env.PASSWORD;",
    );
  });

  it("includes lurking findings and uses the first sentence when there is no fix", () => {
    const result = huntResult({
      kept: [],
      lurking: [
        keptFinding({
          id: "f2",
          severity: "low",
          adjusted_severity: "low",
          adjusted_confidence: 0.72,
          file: "src/other.ts",
          start_line: 3,
          end_line: 3,
          title: "Unchecked return",
          explanation: "The return value is ignored. Check it.",
          fix_kind: "none",
          fix_code: null,
          fix_ok: false,
          position: null,
        }),
      ],
      counts: { critical: 0, high: 0, medium: 0, low: 1, nitpick: 0 },
    });

    expect(formatPromptOnly(result)).toBe(
      "src/other.ts:3 low Unchecked return — The return value is ignored.",
    );
  });

  it("says No findings when nothing survived", () => {
    const result = huntResult({
      kept: [],
      lurking: [],
      counts: { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 },
    });
    expect(formatPromptOnly(result)).toBe("No findings.");
  });
});

describe("formatText", () => {
  it("renders a deterministic report", () => {
    expect(formatText(huntResult())).toBe(
      [
        "🎃 Bug Hunter — Possessed: do not merge",
        "",
        "Adds candy endpoints.",
        "",
        "Findings: 1 critical, 0 high, 0 medium, 0 low, 0 nitpick.",
        "",
        "[critical] src/candy.ts:15  Hard-coded secret  (security, confidence 0.95)",
        "  A password is committed in source.",
        "  fix:",
        "    const password = process.env.PASSWORD;",
        "",
        "Skipped 1 file(s):",
        "  package-lock.json — lockfile",
      ].join("\n"),
    );
  });

  it("banners possession + verifier failure and reports a clean pass", () => {
    const result = huntResult({
      possessionAttempt: true,
      verifierFailed: true,
      kept: [],
      lurking: [],
      skipped: [],
      counts: { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 },
      haunting: { level: "possessed", title: "Possessed: do not merge" },
    });

    expect(formatText(result)).toBe(
      [
        "🎃 Bug Hunter — Possessed: do not merge",
        "",
        "⚠ Possession attempt detected: hidden instructions in the PR text were withheld from the model.",
        "",
        "⚠ Verifier pass failed: findings below are unverified.",
        "",
        "Adds candy endpoints.",
        "",
        "Findings: 0 critical, 0 high, 0 medium, 0 low, 0 nitpick.",
        "",
        "No findings.",
      ].join("\n"),
    );
  });

  it("shows a line range for multi-line findings, but no nitpick fix when unverified", () => {
    const result = huntResult({
      kept: [
        keptFinding({
          adjusted_severity: "high",
          start_line: 20,
          end_line: 24,
          position: { file: "src/candy.ts", start_line: 20, end_line: 24 },
          fix_ok: false,
          title: "Unvalidated input",
          explanation: "Input reaches the query unchecked.",
        }),
      ],
      counts: { critical: 0, high: 1, medium: 0, low: 0, nitpick: 0 },
      skipped: [],
    });

    expect(formatText(result)).toContain("[high] src/candy.ts:20-24  Unvalidated input");
    expect(formatText(result)).not.toContain("  fix:");
  });
});

// ---------------------------------------------------------------------------
// local git diff parsing
// ---------------------------------------------------------------------------

const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = 2;",
  " const c = 3;",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "diff --git a/old.ts b/new.ts",
  "similarity index 100%",
  "rename from old.ts",
  "rename to new.ts",
  "diff --git a/img/logo.png b/img/logo.png",
  "index 4444444..5555555 100644",
  "Binary files a/img/logo.png and b/img/logo.png differ",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("parses modified, added, renamed and binary files", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files.map((f) => f.filename)).toEqual([
      "src/a.ts",
      "src/new.ts",
      "new.ts",
      "img/logo.png",
    ]);

    const modified = files[0];
    expect(modified).toMatchObject({ status: "modified", additions: 1, deletions: 0, isBinary: false });
    expect(modified.hunks).toHaveLength(1);

    expect(files[1]).toMatchObject({ status: "added", additions: 2, deletions: 0 });
    expect(files[1].patch).toContain("@@ -0,0 +1,2 @@");

    expect(files[2]).toMatchObject({ status: "renamed", previous_filename: "old.ts" });
    expect(files[2].patch).toBeUndefined();

    expect(files[3]).toMatchObject({ isBinary: true });
    expect(files[3].patch).toBeUndefined();
  });

  it("ignores commit metadata before the first diff section", () => {
    const shown = ["commit abc", "Author: nobody", "", SAMPLE_DIFF].join("\n");
    expect(parseUnifiedDiff(shown).map((f) => f.filename)).toEqual([
      "src/a.ts",
      "src/new.ts",
      "new.ts",
      "img/logo.png",
    ]);
  });

  it("returns [] for output with no diff sections", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("commit abc\n\nnothing here\n")).toEqual([]);
  });
});

// Type-level guard: the union is exported and discriminated as documented.
const _typing: Command = parseArgs(["init"]);
void _typing;
