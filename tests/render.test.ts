import { describe, expect, it } from "vitest";
import type {
  ExorcisedFinding,
  HuntCounts,
  KeptFinding,
  SeanceOutputT,
} from "../src/types";
import { computeHaunting } from "../src/render/theme";
import { escapeHtml, langFromPath, renderSeance, sanitizeFixCode } from "../src/render/seance";
import { renderInline } from "../src/render/inline";
import { hauntingToStatus } from "../src/render/status";

const zeroCounts: HuntCounts = { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 };

function finding(overrides: Partial<KeptFinding> = {}): KeptFinding {
  return {
    id: "f1",
    fingerprint: "abc123",
    file: "src/candy.ts",
    start_line: 9,
    end_line: 9,
    severity: "critical",
    adjusted_severity: "critical",
    category: "security",
    confidence: 0.95,
    adjusted_confidence: 0.94,
    title: "SQL injection in `/kids` lookup",
    explanation:
      "`req.query.name` is interpolated directly into the SQL string, so `?name=' OR '1'='1` returns every row.",
    evidence_quote: "SELECT * FROM kids WHERE name = '",
    fix_kind: "snippet",
    fix_code:
      'const rows = await db.query("SELECT * FROM kids WHERE name = ?", [req.query.name]);',
    fix_ok: true,
    position: { file: "src/candy.ts", start_line: 9, end_line: 9 },
    ...overrides,
  };
}

function summary(overrides: Partial<SeanceOutputT> = {}): SeanceOutputT {
  return {
    summary: "Adds candy distribution endpoints.",
    change_type: "feature",
    walkthrough: [
      { files: ["src/candy.ts"], change: "Adds candy distribution endpoints" },
    ],
    risk_areas: ["Input validation around the kids lookup"],
    effort: 3,
    spooky_tagline: "A sugar rush of secrets.",
    ...overrides,
  };
}

describe("langFromPath", () => {
  it("maps known extensions and defaults unknown ones", () => {
    expect(langFromPath("src/a.ts")).toBe("ts");
    expect(langFromPath("a.js")).toBe("js");
    expect(langFromPath("a.tsx")).toBe("tsx");
    expect(langFromPath("a.py")).toBe("py");
    expect(langFromPath("a.rs")).toBe("rust");
    expect(langFromPath("a.yaml")).toBe("yaml");
    expect(langFromPath("a.yml")).toBe("yaml");
    expect(langFromPath("noext")).toBe("");
    expect(langFromPath("a.weird")).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes < > &", () => {
    expect(escapeHtml("<a>&</a>")).toBe("&lt;a&gt;&amp;&lt;/a&gt;");
  });
});

describe("sanitizeFixCode", () => {
  it("neutralizes fence closers so fix text cannot break out of code blocks", () => {
    const out = sanitizeFixCode("const x = 1;\n```\n[Evil](https://evil.example)\n```");
    expect(out).not.toContain("```");
    expect(out).toContain("[Evil](https://evil.example)");
  });

  it("caps fix length", () => {
    expect(sanitizeFixCode("x".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("computeHaunting", () => {
  it("maps counts to each level", () => {
    expect(
      computeHaunting({ critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 }, false),
    ).toEqual({ level: "clear", title: "All clear: no spirits detected" });

    expect(computeHaunting({ critical: 0, high: 0, medium: 0, low: 1, nitpick: 0 }, false).level).toBe(
      "whispers",
    );
    expect(computeHaunting({ critical: 0, high: 0, medium: 0, low: 0, nitpick: 1 }, false).level).toBe(
      "whispers",
    );
    expect(computeHaunting({ critical: 0, high: 0, medium: 1, low: 0, nitpick: 0 }, false).level).toBe(
      "restless",
    );
    expect(computeHaunting({ critical: 0, high: 1, medium: 0, low: 0, nitpick: 0 }, false).level).toBe(
      "haunted",
    );
    expect(computeHaunting({ critical: 1, high: 0, medium: 0, low: 0, nitpick: 0 }, false).level).toBe(
      "possessed",
    );
  });

  it("forces possessed on a possession attempt", () => {
    expect(
      computeHaunting({ critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 }, true).level,
    ).toBe("possessed");
  });
});

describe("renderSeance", () => {
  it("renders a possessed report with findings, exorcised, and graveyard", () => {
    const critical = finding();
    const high = finding({
      id: "f2",
      fingerprint: "def456",
      severity: "high",
      adjusted_severity: "high",
      category: "bug",
      title: "Missing await on costume check",
      start_line: 14,
      adjusted_confidence: 0.88,
    });
    const exorcised: ExorcisedFinding[] = [
      { id: "f3", title: "Minor style nit", severity: "nitpick", reason: "Style issue, not worth a comment" },
    ];
    const skipped = [{ path: "package-lock.json", reason: "Lockfile" }];

    const out = renderSeance({
      owner: "acme",
      repo: "haunted-candy-shop",
      headSha: "deadbeef1234",
      summary: summary(),
      kept: [critical, high],
      exorcised,
      skipped,
      lurking: [],
      possessionAttempt: true,
      counts: { critical: 1, high: 1, medium: 0, low: 0, nitpick: 0 },
      level: "possessed",
      title: "Possessed: do not merge",
    });

    const lines = out.split("\n");
    expect(lines[0]).toBe("<!-- bughunter:seance -->");
    expect(out).toContain("💀 Demon · Critical");
    expect(out).toContain("Possession attempt detected");
    expect(out).toContain("deadbeef1234");
    expect(out).toContain("#L9");
    expect(out).toContain("Confidence 0.94");
    expect(out).toContain("🧹 Exorcised false alarms (1)");
    expect(out).toContain("🪦 The Graveyard: files not hunted (1)");
  });

  it("renders all-clear for zero findings", () => {
    const out = renderSeance({
      owner: "acme",
      repo: "haunted-candy-shop",
      headSha: "deadbeef1234",
      summary: summary(),
      kept: [],
      exorcised: [],
      skipped: [],
      lurking: [],
      possessionAttempt: false,
      counts: zeroCounts,
      level: "clear",
      title: "All clear: no spirits detected",
    });

    expect(out).toContain("All clear: no spirits detected");
    expect(out).not.toContain("## 👻 Spirits found");
  });

  it("renders a lurking-findings section", () => {
    const lurking = finding({
      id: "f5",
      fingerprint: "ghi789",
      title: "Off-by-one in loop",
      start_line: 20,
      position: null,
    });

    const out = renderSeance({
      owner: "acme",
      repo: "haunted-candy-shop",
      headSha: "deadbeef1234",
      summary: summary(),
      kept: [lurking],
      exorcised: [],
      skipped: [],
      lurking: [lurking],
      possessionAttempt: false,
      counts: { critical: 0, high: 0, medium: 1, low: 0, nitpick: 0 },
      level: "restless",
      title: "Restless spirits detected",
    });

    expect(out).toContain("👁️ Lurking outside the diff (1)");
    expect(out).toContain("Off-by-one in loop");
  });

  it("escapes model-origin HTML", () => {
    const hostile = finding({
      title: "Use <script>alert(1)</script>",
      explanation: "Bad <tag> & things",
    });

    const out = renderSeance({
      owner: "acme",
      repo: "haunted-candy-shop",
      headSha: "deadbeef1234",
      summary: summary({ spooky_tagline: "<b>boo</b>" }),
      kept: [hostile],
      exorcised: [],
      skipped: [],
      lurking: [],
      possessionAttempt: false,
      counts: { critical: 1, high: 0, medium: 0, low: 0, nitpick: 0 },
      level: "possessed",
      title: "Possessed: do not merge",
    });

    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>boo</b>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("renderInline", () => {
  it("uses a suggestion block only for suggestion + fix_ok", () => {
    const s = renderInline(
      finding({ fix_kind: "suggestion", fix_ok: true, fix_code: "const x = 1;" }),
    );
    expect(s).toContain("```suggestion");
    expect(s).not.toContain("**Possible fix**");

    const snippet = renderInline(
      finding({ fix_kind: "snippet", fix_ok: true, fix_code: "const x = 1;" }),
    );
    expect(snippet).toContain("**Possible fix**");
    expect(snippet).toContain("```ts");
    expect(snippet).not.toContain("```suggestion");

    // suggestion but verifier did not bless the fix -> normal labelled block
    const unblessed = renderInline(
      finding({ fix_kind: "suggestion", fix_ok: false, fix_code: "const x = 1;" }),
    );
    expect(unblessed).toContain("**Possible fix**");
    expect(unblessed).not.toContain("```suggestion");

    // no fix at all -> no code block
    const none = renderInline(finding({ fix_kind: "none", fix_code: null }));
    expect(none).not.toContain("```suggestion");
    expect(none).not.toContain("**Possible fix**");
    expect(none).not.toContain("```");
  });

  it("appends the finding marker", () => {
    const f = finding({ fingerprint: "abc123" });
    expect(renderInline(f)).toContain("<!-- bughunter:f=abc123 -->");
  });
});

describe("hauntingToStatus", () => {
  it("maps possessed and haunted to failure, the rest to success", () => {
    const possessed = hauntingToStatus("possessed", {
      critical: 1,
      high: 2,
      medium: 0,
      low: 0,
      nitpick: 0,
    });
    expect(possessed).toEqual({
      context: "Bug Hunter 🎃",
      state: "failure",
      description: "💀 Possessed: do not merge (1 demon, 2 ghosts)",
    });

    expect(hauntingToStatus("haunted", { critical: 0, high: 1, medium: 0, low: 0, nitpick: 0 }).state).toBe(
      "failure",
    );
    expect(hauntingToStatus("restless", { critical: 0, high: 0, medium: 1, low: 0, nitpick: 0 }).state).toBe(
      "success",
    );
    expect(hauntingToStatus("whispers", { critical: 0, high: 0, medium: 0, low: 1, nitpick: 0 }).state).toBe(
      "success",
    );
    expect(hauntingToStatus("clear", zeroCounts).state).toBe("success");
  });

  it("truncates the description to at most 140 characters", () => {
    // With fixed titles the cap is defensive, but the invariant must always hold
    // even for absurdly large counts.
    const big = hauntingToStatus("possessed", {
      critical: Number.MAX_SAFE_INTEGER,
      high: Number.MAX_SAFE_INTEGER,
      medium: Number.MAX_SAFE_INTEGER,
      low: Number.MAX_SAFE_INTEGER,
      nitpick: 0,
    });
    expect(big.description.length).toBeLessThanOrEqual(140);
  });
});
