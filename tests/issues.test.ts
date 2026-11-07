import { describe, expect, it } from "vitest";
import { formatLinkedIssues, parseIssueRefs } from "../src/hunt/issues";

describe("parseIssueRefs", () => {
  it("finds keyword-linked GitHub issues and cross-repo refs", () => {
    const r = parseIssueRefs("Fixes #12\nCloses #34\nrefs owner/repo#56");
    expect(r.github).toEqual([12, 34, 56]);
  });

  it("finds tracker keys but ignores encodings and algorithms", () => {
    const r = parseIssueRefs("Implements ENG-123 and PROJ-9, encoded UTF-8 / SHA-256");
    expect(r.keys).toEqual(["ENG-123", "PROJ-9"]);
  });

  it("dedupes and sorts GitHub refs", () => {
    const r = parseIssueRefs("#9 fixes #9 fixes #3");
    expect(r.github).toEqual([3, 9]);
  });

  it("returns nothing for plain text", () => {
    expect(parseIssueRefs("just a normal description")).toEqual({ github: [], keys: [] });
  });
});

describe("formatLinkedIssues", () => {
  it("renders (none) when empty", () => {
    expect(formatLinkedIssues([])).toBe("(none)");
  });

  it("renders ref, title and a truncated body", () => {
    const out = formatLinkedIssues([
      { ref: "#12", title: "Fix checkout", body: "a".repeat(400) },
    ]);
    expect(out).toContain("#12: Fix checkout");
    expect(out.length).toBeLessThan(400);
  });
});
