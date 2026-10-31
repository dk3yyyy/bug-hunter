// Deterministic Séance Report renderer.
// All styling (headings, icons, labels, footer) comes from prompts/voice.json;
// model text is escaped except inside code fences, where it is kept verbatim.
import type {
  ExorcisedFinding,
  HauntingLevel,
  HuntCounts,
  KeptFinding,
  SeanceOutputT,
} from "../types";
import { loadVoice } from "../voice";
import { fillTemplate } from "../prompts";
import {
  CATEGORY_ICON,
  categoryLabel,
  seanceMarker,
  severityBadge,
} from "./theme";

// File extension → markdown fence language. Unknown extensions yield unlabelled fence.
export function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  switch (path.slice(dot + 1).toLowerCase()) {
    case "ts":
      return "ts";
    case "js":
      return "js";
    case "jsx":
      return "jsx";
    case "tsx":
      return "tsx";
    case "py":
      return "py";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "rb":
      return "rb";
    case "sh":
      return "sh";
    case "yml":
    case "yaml":
      return "yaml";
    case "json":
      return "json";
    case "md":
      return "md";
    case "sql":
      return "sql";
    default:
      return "";
  }
}

// Escape the three characters that can open/close HTML tags. Order matters:
// `&` first so we never double-escape the entities we introduce.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Escapes a markdown table cell: HTML chars plus the `|` separator.
function tableCell(s: string): string {
  return escapeHtml(s).replace(/\|/g, "\\|");
}

export interface SeanceArgs {
  owner: string;
  repo: string;
  headSha: string;
  summary: SeanceOutputT;
  kept: KeptFinding[];
  exorcised: ExorcisedFinding[];
  skipped: { path: string; reason: string }[];
  lurking: KeptFinding[];
  possessionAttempt: boolean;
  /** First POSSESSION: note from the model, if any (shown inside the callout). */
  possessionNote?: string;
  counts: HuntCounts;
  level: HauntingLevel;
  title: string;
}

export function renderSeance(args: SeanceArgs): string {
  const v = loadVoice();
  const {
    owner,
    repo,
    headSha,
    summary,
    kept,
    exorcised,
    skipped,
    lurking,
    possessionAttempt,
    possessionNote,
    counts,
    level,
    title,
  } = args;

  const lines: string[] = [];
  const s = v.seance;

  lines.push(seanceMarker());
  lines.push(`# ${v.seance.title}`);
  lines.push("");
  lines.push(`> *${escapeHtml(summary.spooky_tagline)}*`);
  lines.push("");

  if (possessionAttempt) {
    const note =
      possessionNote ??
      "Hidden instructions in this PR tried to steer AI reviewers.";
    lines.push(
      fillTemplate(s.possession_callout, { possession_note: escapeHtml(note) }),
    );
    lines.push("");
  }

  // Haunting-level line. Zero findings drops the per-severity counts.
  if (kept.length === 0) {
    lines.push(`**Haunting level:** ${v.haunting_levels[level].emoji} **${escapeHtml(title)}**`);
  } else {
    lines.push(
      fillTemplate(s.haunting_line, {
        level_emoji: v.haunting_levels[level].emoji,
        level_title: escapeHtml(title),
        critical: String(counts.critical),
        high: String(counts.high),
        medium: String(counts.medium),
        low: String(counts.low),
      }),
    );
  }
  lines.push("");

  lines.push(`## ${s.sections.summary}`);
  lines.push(escapeHtml(summary.summary));
  lines.push("");

  if (kept.length === 0) {
    lines.push(`## ${s.all_clear}`);
    lines.push("");
  } else {
    lines.push(`## ${fillTemplate(s.sections.findings, { count: String(kept.length) })}`);
    lines.push("");
    kept.forEach((f, idx) => {
      const badge = severityBadge(f.adjusted_severity);
      lines.push(
        fillTemplate(s.finding_heading, {
          index: String(idx + 1),
          severity_badge: badge,
          category_emoji: CATEGORY_ICON[f.category],
          category_label: categoryLabel(f.category),
          title: escapeHtml(f.title),
        }),
      );
      const lineRange =
        f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
      lines.push(
        fillTemplate(s.location_line, {
          file: escapeHtml(f.file),
          line_range: lineRange,
          line_url: `https://github.com/${owner}/${repo}/blob/${headSha}/${f.file}#L${f.start_line}`,
        }),
      );
      lines.push("");
      lines.push(escapeHtml(f.explanation));
      lines.push("");
      if (f.fix_code) {
        lines.push(`<details><summary>${s.fix_label}</summary>`);
        lines.push("");
        lines.push("```" + langFromPath(f.file));
        lines.push(f.fix_code);
        lines.push("```");
        lines.push("</details>");
        lines.push("");
      }
      lines.push(fillTemplate(s.confidence_line, { confidence: f.adjusted_confidence.toFixed(2) }));
      lines.push("");
    });
  }

  lines.push(`## ${s.sections.walkthrough}`);
  lines.push(s.walkthrough_header);
  for (const row of summary.walkthrough) {
    const files = row.files.map((f) => "`" + tableCell(f) + "`").join(", ");
    lines.push(`| ${files} | ${tableCell(row.change)} |`);
  }
  lines.push("");

  lines.push(`## ${s.sections.risk_areas}`);
  for (const r of summary.risk_areas) {
    lines.push(`- ${escapeHtml(r)}`);
  }
  lines.push("");

  if (lurking.length > 0) {
    lines.push(
      `<details><summary>${fillTemplate(s.sections.outside_diff, { count: String(lurking.length) })}</summary>`,
    );
    lines.push("");
    for (const f of lurking) {
      lines.push(
        `- ${escapeHtml(f.title)} — \`${escapeHtml(f.file)}:${f.start_line}\` — could not be anchored to a changed line`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (exorcised.length > 0) {
    lines.push(
      `<details><summary>${fillTemplate(s.sections.false_alarms, { count: String(exorcised.length) })}</summary>`,
    );
    lines.push("");
    for (const e of exorcised) {
      lines.push(
        fillTemplate(s.false_alarm_item, {
          title: escapeHtml(e.title),
          reason: escapeHtml(e.reason),
        }),
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(
      `<details><summary>${fillTemplate(s.sections.graveyard, { count: String(skipped.length) })}</summary>`,
    );
    lines.push("");
    for (const sk of skipped) {
      lines.push(
        fillTemplate(s.graveyard_item, {
          file: escapeHtml(sk.path),
          reason: escapeHtml(sk.reason),
        }),
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  const shortSha = headSha.slice(0, 7);
  lines.push(
    fillTemplate(s.footer, { effort: String(summary.effort), short_sha: shortSha }),
  );

  return lines.join("\n");
}
