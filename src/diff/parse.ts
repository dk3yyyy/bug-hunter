// Unified-diff hunk parser (SPEC §9.1).
// Walks a single file's `patch` string, starts a hunk on each `@@` header, and
// assigns old/new file line numbers as `-`, `+` and context lines are consumed.
// `\ No newline at end of file` markers are ignored.

import type { Hunk } from "../types";

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split("\n")) {
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (m) {
      o = +m[1];
      n = +m[2];
      cur = { oldStart: o, newStart: n, header: m[3].trim(), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || raw === "" || raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const t = raw[0];
    const text = raw.slice(1);
    if (t === "+") cur.lines.push({ type: "add", newLine: n++, text });
    else if (t === "-") cur.lines.push({ type: "del", oldLine: o++, text });
    else cur.lines.push({ type: "ctx", oldLine: o++, newLine: n++, text });
  }
  return hunks;
}
