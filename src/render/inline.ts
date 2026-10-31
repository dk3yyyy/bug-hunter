// Inline review-comment renderer (§13.2, Step 3).
// ```` ```suggestion ```` only when the verifier blessed the fix; otherwise a
// normal labelled code block, or nothing at all.

import type { KeptFinding } from "../types";
import { CATEGORY_ICON, CREATURE, FINDING_MARKER_PREFIX } from "./theme";
import { escapeHtml, langFromPath } from "./seance";

function titleCase(s: string): string {
  return s
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join("-");
}

export function renderInline(f: KeptFinding): string {
  const creature = CREATURE[f.adjusted_severity];
  const lines: string[] = [];

  lines.push(
    `**${creature.emoji} ${creature.label} · ${titleCase(
      f.adjusted_severity,
    )}** · ${CATEGORY_ICON[f.category]} ${titleCase(f.category)}`,
  );
  lines.push("");
  lines.push(`### ${escapeHtml(f.title)}`);
  lines.push("");
  lines.push(escapeHtml(f.explanation));

  const fixCode = f.fix_code;
  const suggestion = f.fix_kind === "suggestion" && f.fix_ok && !!fixCode;
  if (suggestion && fixCode) {
    lines.push("");
    lines.push("```suggestion");
    lines.push(fixCode);
    lines.push("```");
  } else if (fixCode) {
    lines.push("");
    lines.push("**Possible fix**");
    lines.push("");
    lines.push("```" + langFromPath(f.file));
    lines.push(fixCode);
    lines.push("```");
  }

  lines.push("");
  lines.push(
    `<sub>Confidence ${f.adjusted_confidence.toFixed(2)} · 🎃 Bug Hunter</sub>`,
  );
  lines.push(`${FINDING_MARKER_PREFIX}${f.fingerprint} -->`);

  return lines.join("\n");
}
