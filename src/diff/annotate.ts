// Annotated diff renderer for the model (SPEC §9.2).
// Never send raw diffs: emit explicit new-file line numbers on `+` and context
// lines, and show removed lines unnumbered in an `__old hunk__` block.

import type { ChangedFile, DiffLine, Hunk } from "../types";

/** Appended when `maxChars` cuts the rendered text short. */
const TRUNCATION_MARKER = "...[TRUNCATED]";

/** `+` for add lines, ` ` for context lines. (`del` never appears in `__new hunk__`.) */
function marker(line: DiffLine): "+" | " " {
  return line.type === "add" ? "+" : " ";
}

/** Column width for `__new hunk__` numbers: widest new-line number, min 4. */
function numberWidth(hunk: Hunk): number {
  let max = hunk.newStart;
  for (const line of hunk.lines) {
    if (line.newLine !== undefined && line.newLine > max) max = line.newLine;
  }
  return Math.max(4, String(max).length);
}

function renderHunk(hunk: Hunk): string {
  const width = numberWidth(hunk);
  const out: string[] = [`@@ ${hunk.header}`, "__new hunk__"];
  for (const line of hunk.lines) {
    if (line.newLine === undefined) continue; // add + ctx only
    out.push(`${String(line.newLine).padStart(width)} ${marker(line)}${line.text}`);
  }
  if (hunk.lines.some((l) => l.type === "del")) {
    out.push("__old hunk__");
    for (const line of hunk.lines) {
      if (line.type !== "del") continue;
      out.push(`-${line.text}`);
    }
  }
  return out.join("\n");
}

function renderFile(file: ChangedFile): string {
  if (file.isBinary) return `## File: ${file.filename} (binary — not hunted)`;
  const out: string[] = [`## File: ${file.filename}`];
  for (const hunk of file.hunks) out.push(renderHunk(hunk));
  return out.join("\n");
}

export function annotateDiff(
  files: ChangedFile[],
  opts: { maxChars?: number } = {}
): { text: string; truncated: boolean } {
  const full = files.map(renderFile).join("\n\n");
  const maxChars = opts.maxChars;
  if (maxChars === undefined || full.length <= maxChars) {
    return { text: full, truncated: false };
  }
  const keep = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  // Cut at a line boundary so the model never sees a phantom half-line number.
  const cut = full.lastIndexOf("\n", keep);
  return { text: full.slice(0, cut > 0 ? cut : keep) + TRUNCATION_MARKER, truncated: true };
}
