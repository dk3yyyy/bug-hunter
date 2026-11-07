import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLinters } from "../src/lint";
import type { ChangedInput } from "../src/lint";
import {
  parseEslintJson,
  parseGitleaksJson,
  parseSemgrepJson,
  relativePath,
  severityForSemgrep,
} from "../src/lint/tools";
import type { ExecFn, ExecOpts, ExecResult } from "../src/lint/tools";

interface Call {
  cmd: string;
  args: string[];
  opts: ExecOpts;
}

/** Fake exec driven by tool name; records every call for assertions. */
function makeExec(
  handlers: Partial<Record<string, (call: Call) => ExecResult>>,
): { exec: ExecFn; calls: Call[] } {
  const calls: Call[] = [];
  const exec: ExecFn = (cmd, args, opts) => {
    const call = { cmd, args, opts };
    calls.push(call);
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unexpected command: ${cmd}`);
    return handler(call);
  };
  return { exec, calls };
}

const files: ChangedInput[] = [
  {
    path: "src/app.ts",
    patch: "@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n",
  },
];

function runWith(handler: Partial<Record<string, (call: Call) => ExecResult>>, overrides = {}) {
  const fake = makeExec(handler);
  return { fake, promise: runLinters(files, { exec: fake.exec, ...overrides }) };
}

describe("runLinters — graceful degradation", () => {
  it("reports all three tools as skipped when none are installed", async () => {
    const { exec } = makeExec({});
    const result = await runLinters(files, {
      available: () => false,
      exec,
    });

    expect(result.findings).toEqual([]);
    expect(result.toolsRun).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.map((s) => s.tool)).toEqual(["gitleaks", "semgrep", "eslint"]);
  });

  it("skips a tool that crashes instead of throwing", async () => {
    const { exec } = makeExec({
      gitleaks: () => {
        const error = new Error("spawn gitleaks ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    const result = await runLinters(files, { available: (t) => t === "gitleaks", exec });

    expect(result.findings).toEqual([]);
    expect(result.toolsRun).toEqual([]);
    expect(result.skipped.find((s) => s.tool === "gitleaks")?.reason).toContain("crashed");
  });

  it("skips a tool that returns a non-zero exit and no usable JSON", async () => {
    const { exec } = makeExec({
      gitleaks: () => ({ stdout: "fatal: not a git repository", exitCode: 2 }),
    });

    const result = await runLinters(files, { available: (t) => t === "gitleaks", exec });

    expect(result.findings).toEqual([]);
    expect(result.toolsRun).toEqual([]);
    expect(result.skipped.find((s) => s.tool === "gitleaks")?.reason).toBe("exited with code 2");
  });

  it("skips a timed-out tool with the timeout in the reason", async () => {
    const { exec } = makeExec({
      gitleaks: () => {
        const error = new Error("spawnSync gitleaks ETIMEDOUT") as NodeJS.ErrnoException;
        error.code = "ETIMEDOUT";
        throw error;
      },
    });

    const result = await runLinters(files, {
      available: (t) => t === "gitleaks",
      exec,
      timeoutMs: 1234,
    });

    expect(result.findings).toEqual([]);
    expect(result.skipped.find((s) => s.tool === "gitleaks")?.reason).toBe(
      "timed out after 1234ms",
    );
  });

  it("skips semgrep when its config/network fetch fails (non-zero, no results)", async () => {
    const { exec } = makeExec({
      semgrep: () => ({ stdout: "", exitCode: 2 }),
    });

    const result = await runLinters(files, { available: (t) => t === "semgrep", exec });

    expect(result.findings).toEqual([]);
    expect(result.toolsRun).toEqual([]);
    expect(result.skipped.find((s) => s.tool === "semgrep")?.reason).toContain(
      "exited with code 2",
    );
  });

  it("skips eslint when an executable exists but no config does", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lint-no-config-"));
    try {
      const { exec, calls } = makeExec({});
      const result = await runLinters(files, {
        cwd,
        available: (t) => t === "eslint",
        exec,
      });

      expect(result.skipped.find((s) => s.tool === "eslint")?.reason).toBe(
        "no eslint config found",
      );
      expect(calls).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("runLinters — gitleaks", () => {
  const secret = "sk-live-" + "SUPERSECRET0123456789";
  const report = JSON.stringify([
    {
      File: "src/app.ts",
      StartLine: 12,
      RuleID: "stripe-secret-key",
      Description: "Stripe secret key",
      Secret: secret,
    },
  ]);

  it("parses findings and never puts the matched secret in detail", async () => {
    const { exec, calls } = makeExec({ gitleaks: () => ({ stdout: report, exitCode: 1 }) });

    const result = await runLinters(files, { available: (t) => t === "gitleaks", exec });

    expect(result.toolsRun).toEqual(["gitleaks"]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.tool).toBe("gitleaks");
    expect(finding.severity).toBe("critical");
    expect(finding.category).toBe("security");
    expect(finding.line).toBe(12);
    expect(finding.detail).toContain("matched rule stripe-secret-key");
    expect(finding.detail).not.toContain(secret);
    expect(finding.detail).not.toContain("SUPERSECRET");
    expect(finding.title).not.toContain(secret);

    expect(calls[0].args).toEqual([
      "detect",
      "--no-git",
      "--pipe",
      "--report-format",
      "json",
      "--report-path",
      "-",
    ]);
    expect(calls[0].opts.input).toContain("+++ b/src/app.ts");
    expect(calls[0].opts.input).toContain("+const b = 2;");
  });

  it("drops findings for files outside the changed set", async () => {
    const mixed = JSON.stringify([
      { File: "src/app.ts", StartLine: 2, RuleID: "keep-me", Description: "changed file" },
      { File: "src/other.ts", StartLine: 3, RuleID: "drop-me", Description: "not changed" },
    ]);
    const { exec } = makeExec({ gitleaks: () => ({ stdout: mixed, exitCode: 1 }) });

    const result = await runLinters(files, { available: (t) => t === "gitleaks", exec });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/app.ts");
    expect(result.findings[0].rule).toBe("keep-me");
  });
});

describe("runLinters — semgrep", () => {
  const report = JSON.stringify({
    results: [
      {
        path: "src/app.ts",
        start: { line: 10 },
        check_id: "javascript.lang.security.audit.eval",
        extra: { message: "Avoid eval", severity: "ERROR" },
      },
      {
        path: "src/app.ts",
        start: { line: 4 },
        check_id: "javascript.lang.correctness.eqeqeq",
        extra: { message: "Use ===", severity: "WARNING" },
      },
      {
        path: "src/app.ts",
        start: { line: 5 },
        check_id: "javascript.lang.style.info",
        extra: { message: "Style note", severity: "INFO" },
      },
    ],
  });

  it("maps ERROR/WARNING/INFO and tags security rules", async () => {
    const { exec } = makeExec({ semgrep: () => ({ stdout: report, exitCode: 1 }) });

    const result = await runLinters(files, { available: (t) => t === "semgrep", exec });

    expect(result.toolsRun).toEqual(["semgrep"]);
    // Sorted by severity: ERROR, WARNING, INFO.
    expect(result.findings.map((f) => f.line)).toEqual([10, 4, 5]);
    expect(result.findings.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
    expect(result.findings[0].category).toBe("security");
    expect(result.findings[1].category).toBe("bug");
    expect(result.findings[2].category).toBe("bug");
    expect(result.findings[0].detail).toBe("Avoid eval");
  });

  it("dedupes identical (file,line,title) hits", async () => {
    const dup = JSON.stringify({
      results: [
        {
          path: "src/app.ts",
          start: { line: 7 },
          check_id: "dup.rule",
          extra: { message: "one", severity: "WARNING" },
        },
        {
          path: "src/app.ts",
          start: { line: 7 },
          check_id: "dup.rule",
          extra: { message: "two", severity: "WARNING" },
        },
      ],
    });
    const { exec } = makeExec({ semgrep: () => ({ stdout: dup, exitCode: 1 }) });

    const result = await runLinters(files, { available: (t) => t === "semgrep", exec });

    expect(result.findings).toHaveLength(1);
  });
});

describe("runLinters — eslint", () => {
  it("maps severity 2 → medium and 1 → low, normalizing absolute paths", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lint-eslint-"));
    writeFileSync(join(cwd, "eslint.config.js"), "export default [];\n");
    try {
      const report = JSON.stringify([
        {
          filePath: join(cwd, "src/app.ts"),
          messages: [
            { line: 3, severity: 2, ruleId: "no-unused-vars", message: "unused variable" },
            { line: 9, severity: 1, ruleId: "prefer-const", message: "use const" },
          ],
        },
      ]);
      const { exec, calls } = makeExec({ eslint: () => ({ stdout: report, exitCode: 1 }) });

      const result = await runLinters(files, {
        cwd,
        available: (t) => t === "eslint",
        exec,
      });

      expect(result.toolsRun).toEqual(["eslint"]);
      expect(result.findings.map((f) => f.file)).toEqual(["src/app.ts", "src/app.ts"]);
      expect(result.findings.map((f) => f.severity)).toEqual(["medium", "low"]);
      expect(result.findings.map((f) => f.category)).toEqual([
        "maintainability",
        "maintainability",
      ]);
      expect(result.findings[0].title).toBe("ESLint: no-unused-vars");
      expect(calls[0].args).toEqual([
        "--format",
        "json",
        "--no-error-on-unmatched-pattern",
        "src/app.ts",
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("runLinters — ordering and cap", () => {
  it("sorts by severity before applying maxFindings", async () => {
    const gitleaksReport = JSON.stringify([
      { File: "src/app.ts", StartLine: 2, RuleID: "second", Description: "b" },
      { File: "src/app.ts", StartLine: 1, RuleID: "first", Description: "a" },
    ]);
    const semgrepReport = JSON.stringify({
      results: [
        {
          path: "src/app.ts",
          start: { line: 30 },
          check_id: "high.rule",
          extra: { message: "high", severity: "ERROR" },
        },
        {
          path: "src/app.ts",
          start: { line: 40 },
          check_id: "medium.rule",
          extra: { message: "medium", severity: "WARNING" },
        },
      ],
    });

    const { exec } = makeExec({
      gitleaks: () => ({ stdout: gitleaksReport, exitCode: 1 }),
      semgrep: () => ({ stdout: semgrepReport, exitCode: 1 }),
    });

    const result = await runLinters(files, {
      available: (t) => t === "gitleaks" || t === "semgrep",
      exec,
      maxFindings: 2,
    });

    expect(result.findings).toHaveLength(2);
    // Both critical findings survive; the high finding is cut by the cap.
    expect(result.findings.map((f) => f.severity)).toEqual(["critical", "critical"]);
    expect(result.findings.map((f) => f.line)).toEqual([1, 2]);
    expect(result.toolsRun).toEqual(["gitleaks", "semgrep"]);
  });
});

describe("tools helpers", () => {
  it("relativePath strips cwd prefix, leading ./ and stray slashes", () => {
    expect(relativePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativePath("./src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativePath("/repo/./src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(relativePath("src\\a.ts", "/repo")).toBe("src/a.ts");
    expect(relativePath("/tmp/outside.ts", "/repo")).toBe("tmp/outside.ts");
  });

  it("severityForSemgrep maps the documented levels", () => {
    expect(severityForSemgrep("ERROR")).toBe("high");
    expect(severityForSemgrep("WARNING")).toBe("medium");
    expect(severityForSemgrep("INFO")).toBe("low");
    expect(severityForSemgrep("SOMETHING")).toBe("low");
  });

  it("parsers tolerate malformed JSON instead of throwing", () => {
    expect(parseGitleaksJson("not json")).toEqual([]);
    expect(parseGitleaksJson("{}")).toEqual([]);
    expect(parseSemgrepJson("[]")).toEqual([]);
    expect(parseSemgrepJson('{"results": "nope"}')).toEqual([]);
    expect(parseEslintJson("nope")).toEqual([]);
  });

  it("parseGitleaksJson never exposes the Secret field", () => {
    const parsed = parseGitleaksJson(
      JSON.stringify([
        {
          File: "src/app.ts",
          StartLine: 1,
          RuleID: "rule",
          Description: "desc",
          Secret: "do-not-leak",
        },
      ]),
    );
    expect(parsed).toEqual([
      { file: "src/app.ts", line: 1, rule: "rule", description: "desc" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("do-not-leak");
  });

  it("parseEslintJson ignores severity 0 messages", () => {
    const parsed = parseEslintJson(
      JSON.stringify([
        {
          filePath: "src/app.ts",
          messages: [
            { line: 1, severity: 0, ruleId: null, message: "disabled" },
            { line: 2, severity: 2, ruleId: "r", message: "on" },
          ],
        },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ line: 2, severity: "medium", ruleId: "r" });
  });
});
