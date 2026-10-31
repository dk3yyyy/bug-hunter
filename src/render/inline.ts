// Inline review-comment renderer. All Halloween copy comes from voice.json.
// ```suggestion only when the verifier blessed the fix; otherwise a normal
// labelled code block, or nothing at all.
import type { KeptFinding } from "../types";
import { loadVoice } from "../voice";
import { fillTemplate } from "../prompts";
import { CATEGORY_ICON, categoryLabel, FINDING_MARKER_PREFIX, severityBadge } from "./theme";
import { escapeHtml, langFromPath, sanitizeFixCode } from "./seance";

export function renderInline(f: KeptFinding): string {
  const v = loadVoice();
  const badge = severityBadge(f.adjusted_severity);
  const lines: string[] = [];

  lines.push(
    fillTemplate(v.inline.header, {
      severity_badge: badge,
      category_emoji: CATEGORY_ICON[f.category],
      category_label: categoryLabel(f.category),
    }),
  );
  lines.push("");
  lines.push(fillTemplate(v.inline.title, { title: escapeHtml(f.title) }));
  lines.push("");
  lines.push(escapeHtml(f.explanation));

  const fixCode = f.fix_code ? sanitizeFixCode(f.fix_code) : null;
  const suggestion = f.fix_kind === "suggestion" && f.fix_ok && !!fixCode;
  if (suggestion && fixCode) {
    lines.push("");
    lines.push("```suggestion");
    lines.push(fixCode);
    lines.push("```");
  } else if (fixCode) {
    lines.push("");
    lines.push(`**${v.inline.fix_label}**`);
    lines.push("");
    lines.push("```" + langFromPath(f.file));
    lines.push(fixCode);
    lines.push("```");
  }

  lines.push("");
  lines.push(fillTemplate(v.inline.footer, { confidence: f.adjusted_confidence.toFixed(2) }));
  lines.push(`${FINDING_MARKER_PREFIX}${f.fingerprint} -->`);

  return lines.join("\n");
}

/** Body of the single review that carries the inline comments. */
export function renderReviewBody(count: number): string {
  return fillTemplate(loadVoice().inline.review_body, { count: String(count) });
}
