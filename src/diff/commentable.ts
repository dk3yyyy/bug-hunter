// Commentable-line map + finding position resolution (SPEC §9.3).

import type { ChangedFile, ResolvedPosition } from "../types";

/** Lines within this distance of a finding's start_line are snap candidates. */
const SNAP_WINDOW = 3;

/**
 * filename -> (newLine -> hunkIndex) for every `add` and `ctx` line. These are
 * the only lines that can carry an inline comment on the RIGHT side; anything
 * else would 422 the whole review.
 */
export function commentableMap(files: ChangedFile[]): Map<string, Map<number, number>> {
  const map = new Map<string, Map<number, number>>();
  for (const file of files) {
    const byLine = new Map<number, number>();
    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      for (const line of file.hunks[hunkIndex].lines) {
        if ((line.type === "add" || line.type === "ctx") && line.newLine !== undefined) {
          byLine.set(line.newLine, hunkIndex);
        }
      }
    }
    map.set(file.filename, byLine);
  }
  return map;
}

/**
 * Resolve a finding to a valid position, or null when it cannot be anchored.
 * Null means "demote to the Séance Report's 'Lurking outside the diff' section".
 */
export function resolvePosition(
  files: ChangedFile[],
  finding: { file: string; start_line: number; end_line: number; evidence_quote?: string }
): ResolvedPosition | null {
  const file = files.find((f) => f.filename === finding.file);
  if (!file) return null;

  const byLine = commentableMap([file]).get(file.filename);
  if (!byLine) return null;

  // `end_line` defaults to `start_line` for a single-line finding (0/unset).
  const start = finding.start_line;
  const end = finding.end_line >= start ? finding.end_line : start;

  // ANCHORED: both endpoints are commentable lines in the same hunk.
  const startHunk = byLine.get(start);
  const endHunk = byLine.get(end);
  if (startHunk !== undefined && endHunk !== undefined && startHunk === endHunk) {
    return { file: finding.file, start_line: start, end_line: end };
  }

  // SNAP: search add/ctx lines within ±3 of start_line whose text contains the
  // trimmed evidence quote, across any hunk of the file.
  const quote = finding.evidence_quote?.trim();
  if (!quote) return null;

  const candidates = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del" || line.newLine === undefined) continue;
      if (Math.abs(line.newLine - start) <= SNAP_WINDOW && line.text.trim().includes(quote)) {
        candidates.add(line.newLine);
      }
    }
  }

  if (candidates.size === 1) {
    const n = [...candidates][0];
    return { file: finding.file, start_line: n, end_line: n };
  }
  return null;
}
