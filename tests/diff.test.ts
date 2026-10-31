// Diff engine tests (SPEC §9): parsePatch, annotateDiff, commentableMap,
// resolvePosition. Exercises the §9.3 acceptance list.

import { describe, expect, it } from "vitest";

import { annotateDiff } from "../src/diff/annotate";
import { commentableMap, resolvePosition } from "../src/diff/commentable";
import { parsePatch } from "../src/diff/parse";
import type { ChangedFile } from "../src/types";

function changedFile(
  filename: string,
  patch: string,
  extra: Partial<ChangedFile> = {}
): ChangedFile {
  return {
    filename,
    status: "modified",
    additions: 0,
    deletions: 0,
    patch,
    hunks: parsePatch(patch),
    isBinary: false,
    ...extra,
  };
}

describe("parsePatch", () => {
  it("parses a new-file hunk of all additions", () => {
    const hunks = parsePatch(
      ["@@ -0,0 +1,3 @@", "+one", "+two", "+three"].join("\n")
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 0, newStart: 1, header: "" });
    expect(hunks[0].lines).toEqual([
      { type: "add", newLine: 1, text: "one" },
      { type: "add", newLine: 2, text: "two" },
      { type: "add", newLine: 3, text: "three" },
    ]);
  });

  it("assigns correct old/new line numbers across add, del and ctx lines", () => {
    const hunks = parsePatch(
      [
        "@@ -11,3 +11,6 @@ router.post(\"/treat\")",
        "   router.post(\"/treat\", async (req, res) => {",
        "-    const ok = await verifyCostume(req.body.costume);",
        "+    const ok = verifyCostume(req.body.costume);",
        "+    if (!ok) return res.status(403).json({ error: \"No costume, no candy\" });",
        "     if (!ok) return res.status(403).json({ error: \"No costume, no candy\" });",
      ].join("\n")
    );
    expect(hunks[0]).toMatchObject({
      oldStart: 11,
      newStart: 11,
      header: 'router.post("/treat")',
    });
    expect(hunks[0].lines).toEqual([
      { type: "ctx", oldLine: 11, newLine: 11, text: '  router.post("/treat", async (req, res) => {' },
      { type: "del", oldLine: 12, text: "    const ok = await verifyCostume(req.body.costume);" },
      { type: "add", newLine: 12, text: "    const ok = verifyCostume(req.body.costume);" },
      { type: "add", newLine: 13, text: '    if (!ok) return res.status(403).json({ error: "No costume, no candy" });' },
      { type: "ctx", oldLine: 13, newLine: 14, text: '    if (!ok) return res.status(403).json({ error: "No costume, no candy" });' },
    ]);
  });

  it("splits two hunks in one patch", () => {
    const hunks = parsePatch(
      ["@@ -1,1 +1,2 @@ one", " a", "+b", "@@ -10,1 +11,2 @@ two", " c", "+d"].join("\n")
    );
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, header: "one" });
    expect(hunks[1]).toMatchObject({ oldStart: 10, newStart: 11, header: "two" });
    expect(hunks[0].lines.map((l) => l.type)).toEqual(["ctx", "add"]);
    expect(hunks[1].lines.map((l) => l.type)).toEqual(["ctx", "add"]);
  });

  it("skips '\\ No newline at end of file' markers", () => {
    const hunks = parsePatch(
      ["@@ -1 +1 @@", "-old", "+new", "\\ No newline at end of file"].join("\n")
    );
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines[0]).toEqual({ type: "del", oldLine: 1, text: "old" });
    expect(hunks[0].lines[1]).toEqual({ type: "add", newLine: 1, text: "new" });
  });
});

describe("annotateDiff", () => {
  it("emits explicit new-side numbers and markers for ctx and add lines", () => {
    const text = annotateDiff([changedFile("src/a.ts", "@@ -1,1 +1,2 @@ add\n a\n+b\n")]).text;
    expect(text).toBe("## File: src/a.ts\n@@ add\n__new hunk__\n   1  a\n   2 +b");
  });

  it("emits __old hunk__ only when the hunk has deletions (del lines only)", () => {
    const text = annotateDiff([changedFile("src/a.ts", "@@ -1,1 +1,1 @@ chg\n-old\n+new\n")]).text;
    expect(text).toBe("## File: src/a.ts\n@@ chg\n__new hunk__\n   1 +new\n__old hunk__\n-old");
  });

  it("renders a deletions-only file with no __new hunk__ numbers", () => {
    const text = annotateDiff([changedFile("src/del.ts", "@@ -1,2 +0,0 @@\n-one\n-two\n")]).text;
    const lines = text.split("\n");
    expect(lines[0]).toBe("## File: src/del.ts");
    expect(lines).toContain("__new hunk__");
    expect(lines).toContain("__old hunk__");
    const newIdx = lines.indexOf("__new hunk__");
    const oldIdx = lines.indexOf("__old hunk__");
    expect(oldIdx).toBe(newIdx + 1); // no numbered lines between the markers
    expect(lines.slice(oldIdx + 1)).toEqual(["-one", "-two"]);
  });

  it("renders multiple hunks in one file under a single header", () => {
    const patch = "@@ -1,1 +1,2 @@ one\n a\n+b\n@@ -10,1 +11,2 @@ two\n c\n+d\n";
    const text = annotateDiff([changedFile("src/m.ts", patch)]).text;
    const lines = text.split("\n");
    expect(lines[0]).toBe("## File: src/m.ts");
    expect(lines.filter((l) => l === "__new hunk__")).toHaveLength(2);
    expect(lines).toContain("@@ one");
    expect(lines).toContain("@@ two");
    expect(lines).toContain("   2 +b");
    expect(lines).toContain("  12 +d");
  });

  it("renders a binary file as a single 'not hunted' line", () => {
    const text = annotateDiff([changedFile("img.png", "", { isBinary: true })]).text;
    expect(text).toBe("## File: img.png (binary — not hunted)");
  });

  it("never includes the '\\ No newline' marker in rendered output", () => {
    const text = annotateDiff([changedFile("src/a.ts", "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n")]).text;
    expect(text).not.toContain("\\ No newline");
  });

  it("truncates to maxChars with a [TRUNCATED] marker", () => {
    const patch = "@@ -1,1 +1,5 @@ many\n+a\n+b\n+c\n+d\n+e\n";
    const { text, truncated } = annotateDiff([changedFile("src/x.ts", patch)], { maxChars: 40 });
    expect(truncated).toBe(true);
    expect(text.length).toBe(40);
    expect(text.endsWith("...[TRUNCATED]")).toBe(true);
  });

  it("does not truncate when maxChars is large enough or unset", () => {
    const patch = "@@ -1,1 +1,1 @@ chg\n-old\n+new\n";
    const full = annotateDiff([changedFile("src/a.ts", patch)]).text;
    expect(full).toBe(annotateDiff([changedFile("src/a.ts", patch)], { maxChars: 100000 }).text);
    expect(annotateDiff([changedFile("src/a.ts", patch)]).truncated).toBe(false);
  });
});

describe("commentableMap", () => {
  it("maps add and ctx newLine -> hunkIndex, excluding del lines", () => {
    const file = changedFile(
      "src/a.ts",
      ["@@ -1,2 +1,2 @@ one", " ctx", "-del", "@@ -10,1 +11,2 @@ two", " ctx2", "+add2"].join("\n")
    );
    const map = commentableMap([file]).get("src/a.ts");
    expect(map).toEqual(new Map<number, number>([[1, 0], [11, 1], [12, 1]]));
  });

  it("returns an empty map for a deletions-only file", () => {
    const file = changedFile("src/del.ts", "@@ -1,2 +0,0 @@\n-one\n-two\n");
    expect(commentableMap([file]).get("src/del.ts")).toEqual(new Map<number, number>());
  });
});

describe("resolvePosition", () => {
  const files = [
    changedFile(
      "src/a.ts",
      [
        "@@ -1,2 +1,3 @@ h1",
        " keep",
        "+add one",
        "+add two",
        "@@ -10,2 +12,3 @@ h2",
        " keep2",
        "+add three",
        "+add four",
      ].join("\n")
    ),
  ];

  it("anchors a single-line finding", () => {
    expect(resolvePosition(files, { file: "src/a.ts", start_line: 2, end_line: 2 })).toEqual({
      file: "src/a.ts",
      start_line: 2,
      end_line: 2,
    });
  });

  it("anchors a multi-line finding within the same hunk", () => {
    expect(resolvePosition(files, { file: "src/a.ts", start_line: 2, end_line: 3 })).toEqual({
      file: "src/a.ts",
      start_line: 2,
      end_line: 3,
    });
  });

  it("rejects a multi-line finding spanning two hunks", () => {
    expect(resolvePosition(files, { file: "src/a.ts", start_line: 3, end_line: 13 })).toBeNull();
  });

  it("defaults end_line to start_line when end_line is unset", () => {
    expect(resolvePosition(files, { file: "src/a.ts", start_line: 2, end_line: 0 })).toEqual({
      file: "src/a.ts",
      start_line: 2,
      end_line: 2,
    });
  });

  it("returns null for an unanchorable finding with no evidence", () => {
    expect(resolvePosition(files, { file: "src/a.ts", start_line: 5, end_line: 5 })).toBeNull();
  });

  it("returns null for an unknown file", () => {
    expect(
      resolvePosition(files, { file: "src/unknown.ts", start_line: 1, end_line: 1 })
    ).toBeNull();
  });

  it("returns null for a deletions-only file (nothing commentable)", () => {
    const del = changedFile("src/del.ts", "@@ -1,2 +0,0 @@\n-one\n-two\n");
    expect(
      resolvePosition([del], { file: "src/del.ts", start_line: 1, end_line: 1, evidence_quote: "one" })
    ).toBeNull();
  });

  it("anchors a finding in a new file (all additions)", () => {
    const fresh = changedFile("src/new.ts", "@@ -0,0 +1,3 @@\n+alpha\n+beta\n+gamma\n");
    expect(
      resolvePosition([fresh], { file: "src/new.ts", start_line: 2, end_line: 3, evidence_quote: "beta" })
    ).toEqual({ file: "src/new.ts", start_line: 2, end_line: 3 });
  });

  it("snaps to an evidence line within ±3 (single-line result)", () => {
    const snap = changedFile(
      "src/b.ts",
      ["@@ -1,1 +9,3 @@ s", "+zero", "+one the bug", "+two"].join("\n")
    );
    expect(
      resolvePosition([snap], { file: "src/b.ts", start_line: 13, end_line: 13, evidence_quote: "the bug" })
    ).toEqual({ file: "src/b.ts", start_line: 10, end_line: 10 });
  });

  it("snaps at the ±3 boundary", () => {
    const snap = changedFile(
      "src/b.ts",
      ["@@ -1,1 +9,3 @@ s", "+zero", "+one the bug", "+two"].join("\n")
    );
    expect(
      resolvePosition([snap], { file: "src/b.ts", start_line: 12, end_line: 12, evidence_quote: "zero" })
    ).toEqual({ file: "src/b.ts", start_line: 9, end_line: 9 });
  });

  it("returns null when evidence matches multiple lines (ambiguous)", () => {
    const amb = changedFile(
      "src/c.ts",
      ["@@ -1,1 +5,3 @@ s", "+dup", "+dup", "+other"].join("\n")
    );
    expect(
      resolvePosition([amb], { file: "src/c.ts", start_line: 8, end_line: 8, evidence_quote: "dup" })
    ).toBeNull();
  });

  it("returns null when the evidence is out of range (±3)", () => {
    const snap = changedFile(
      "src/b.ts",
      ["@@ -1,1 +9,3 @@ s", "+zero", "+one the bug", "+two"].join("\n")
    );
    expect(
      resolvePosition([snap], { file: "src/b.ts", start_line: 100, end_line: 100, evidence_quote: "two" })
    ).toBeNull();
  });
});
