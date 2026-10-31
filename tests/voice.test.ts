import { describe, expect, it } from "vitest";
import { loadVoice, resetVoiceCache, Voice } from "../src/voice";
import { fillTemplate, loadAllPrompts, loadPrompt } from "../src/prompts";
import { buildRepoRules } from "../src/hunt/context";
import { severityBadge } from "../src/render/theme";
import { providerDisplayName } from "../src/llm/config";
import { renderSeance } from "../src/render/seance";
import type { KeptFinding, SeanceOutputT } from "../src/types";
import { readFileSync } from "node:fs";

describe("voice.json", () => {
  it("validates against the zod schema", () => {
    const raw = JSON.parse(readFileSync(new URL("../prompts/voice.json", import.meta.url), "utf8"));
    expect(() => Voice.parse(raw)).not.toThrow();
    expect(loadVoice().severities.critical.creature).toBe("Demon");
  });

  it("drives the report: severity badge comes from voice, not hardcoded copy", () => {
    resetVoiceCache();
    const badge = severityBadge("critical");
    expect(badge).toBe(
      loadVoice().severity_badge
        .replace("{{emoji}}", "💀")
        .replace("{{creature}}", "Demon")
        .replace("{{label}}", "Critical"),
    );
    expect(badge).toContain("Demon");
  });

  it("changing a creature label changes the posted report with no code change", () => {    resetVoiceCache();
    const f: KeptFinding = {
      id: "f1",
      fingerprint: "abc",
      file: "src/candy.ts",
      start_line: 9,
      end_line: 9,
      severity: "critical",
      adjusted_severity: "critical",
      category: "security",
      confidence: 0.95,
      adjusted_confidence: 0.94,
      title: "SQL injection in `/kids` lookup",
      explanation: "`req.query.name` breaks.",
      evidence_quote: "q",
      fix_kind: "none",
      fix_code: null,
      fix_ok: true,
      position: { file: "src/candy.ts", start_line: 9, end_line: 9 },
    };
    const summary: SeanceOutputT = {
      summary: "Does things.",
      change_type: "feature",
      walkthrough: [],
      risk_areas: [],
      effort: 2,
      spooky_tagline: "Boo.",
    };
    const out = renderSeance({
      owner: "o",
      repo: "r",
      headSha: "abcdef123456",
      summary,
      kept: [f],
      exorcised: [],
      skipped: [],
      lurking: [],
      possessionAttempt: false,
      counts: { critical: 1, high: 0, medium: 0, low: 0, nitpick: 0 },
      level: "possessed",
      title: "Possessed: do not merge",
    });
    // The creature word in the heading must equal the voice.json value.
    expect(out).toContain(loadVoice().severities.critical.creature);
  });
});

describe("prompts", () => {
  it("loads all four templates at startup and fills every placeholder", () => {
    const p = loadAllPrompts();
    for (const [name, text] of Object.entries(p)) {
      expect(typeof text, name).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
    expect(loadPrompt("review.system")).toBe(p.system);
    // Full fill: no {{...}} may survive.
    const filled = fillTemplate(p.user, {
      repo_rules: "(none)",
      pr_title: "t",
      pr_body: "b",
      hidden_content_or_none: "(none)",
      context: "c",
      annotated_diff: "d",
    });
    expect(filled).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("throws on missing vars and on leftover placeholders", () => {
    expect(() => fillTemplate("hi {{name}}", {})).toThrow(/missing template vars/);
    expect(() => fillTemplate("hi {{name}} {{other}}", { name: "x" })).toThrow();
  });

  it("seance template exposes {{changed_files_list}}, {{repo_rules}} and {{summary_hint}}", () => {
    const seance = loadPrompt("seance");
    expect(seance).toContain("{{changed_files_list}}");
    expect(seance).toContain("{{repo_rules}}");
    expect(seance).toContain("{{summary_hint}}");
    // Fully fillable with what the pipeline passes: no {{...}} may survive.
    const filled = fillTemplate(seance, {
      pr_title: "t",
      pr_body: "b",
      repo_rules: "(none)",
      summary_hint: "",
      changed_files_list: "a.ts",
      annotated_diff: "d",
    });
    expect(filled).not.toMatch(/\{\{[^}]+\}\}/);
  });
});

describe("buildRepoRules (base branch only)", () => {
  function fakeOctokit(files: Record<string, string>, calls: string[]) {
    return {
      rest: {
        repos: {
          getContent: async ({ path, ref }: { path: string; ref: string }) => {
            calls.push(`${ref}:${path}`);
            const key = `${ref}:${path}`;
            if (!(key in files)) throw new Error("not found");
            return {
              data: { content: Buffer.from(files[key]).toString("base64") },
            };
          },
        },
      },
    } as never;
  }

  it("reads .bughunter.md from the base ref, never head", async () => {
    const calls: string[] = [];
    const octokit = fakeOctokit(
      {
        "main:.bughunter.md": "Always check division by zero.",
        "main:AGENTS.md": "Use parameterized queries.",
      },
      calls,
    );
    const out = await buildRepoRules(octokit, "o", "r", "main");
    expect(out).toContain("### From .bughunter.md");
    expect(out).toContain("division by zero");
    expect(out).toContain("### From AGENTS.md");
    expect(calls.every((c) => c.startsWith("main:"))).toBe(true);
    // A rule added only in the PR branch is ignored: head ref never queried.
    expect(calls.some((c) => c.startsWith("feature"))).toBe(false);
  });

  it("returns (none) when no rule files exist", async () => {
    const octokit = fakeOctokit({}, []);
    expect(await buildRepoRules(octokit, "o", "r", "main")).toBe("(none)");
  });

  it("caps .bughunter.md at 2000 chars and all rules at 6000", async () => {
    const big = "x".repeat(5000);
    const octokit = fakeOctokit(
      {
        "main:.bughunter.md": big,
        "main:AGENTS.md": "y".repeat(5000),
      },
      [],
    );
    const out = await buildRepoRules(octokit, "o", "r", "main");
    expect(out.length).toBeLessThanOrEqual(6000);
    expect(out).toContain("x".repeat(100));
    expect(out).not.toContain("x".repeat(2001));
  });
});

describe("provider-agnostic footer", () => {
  const summary: SeanceOutputT = {
    summary: "Does things.",
    change_type: "feature",
    walkthrough: [],
    risk_areas: [],
    effort: 2,
    spooky_tagline: "Boo.",
  };
  const base = {
    owner: "o",
    repo: "r",
    headSha: "abcdef123456",
    summary,
    kept: [],
    exorcised: [],
    skipped: [],
    lurking: [],
    possessionAttempt: false,
    counts: { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 },
    level: "clear" as const,
    title: "All clear: no spirits detected",
  };

  it("names the configured provider in the footer", () => {
    const out = renderSeance({ ...base, provider: "Claude" });
    expect(out).toContain("powered by Claude");
    expect(out).not.toContain("Google Gemini");
  });

  it("falls back to a generic label with no provider", () => {
    const out = renderSeance(base);
    expect(out).toContain("powered by AI");
  });

  it("maps every provider id to a display name", () => {
    expect(providerDisplayName("google")).toBe("Google Gemini");
    expect(providerDisplayName("anthropic")).toBe("Claude");
    expect(providerDisplayName("openai")).toBe("OpenAI");
    expect(providerDisplayName("opencode")).toBe("OpenCode Go");
    expect(providerDisplayName("openrouter")).toBe("OpenRouter");
    expect(providerDisplayName("ollama")).toBe("Ollama");
    expect(providerDisplayName("openai-compatible")).toBe("AI");
  });
});
