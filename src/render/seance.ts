// Deterministic Séance Report renderer (§13.1).
// All styling (headings, icons, labels, footer) lives here; model text is
// escaped except inside code fences, where it is kept verbatim.

import type {
  ExorcisedFinding,
  HauntingLevel,
  HuntCounts,
  KeptFinding,
  SeanceOutputT,
} from "../types";
import { CATEGORY_ICON, CREATURE, LEVEL_EMOJI, SEANCE_MARKER } from "./theme";

// File extension → markdown fence language (§13.1 "code fence language comes
// from the file extension"). Unknown extensions yield an unlabelled fence.
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

// "critical" -> "Critical"; "error-handling" -> "Error-Handling".
function titleCase(s: string): string {
  return s
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join("-");
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
  counts: HuntCounts;
  level: HauntingLevel;
  title: string;
}

export function renderSeance(args: SeanceArgs): string {
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
    counts,
    level,
    title,
  } = args;

  const lines: string[] = [];

  lines.push(SEANCE_MARKER);
  lines.push("# 🔮 Séance Report");
  lines.push("");
  lines.push(`> *${escapeHtml(summary.spooky_tagline)}*`);
  lines.push("");

  if (possessionAttempt) {
    lines.push(
      "> 🪄 **Possession attempt detected.** This PR contains hidden instructions aimed at AI reviewers (e.g. telling them to report no issues). Bug Hunter ignored them. A human should check why they're there.",
    );
    lines.push("");
  }

  // Haunting-level line. Zero findings drops the per-severity counts.
  if (kept.length === 0) {
    lines.push(`**Haunting level:** ${LEVEL_EMOJI[level]} **${escapeHtml(title)}**`);
  } else {
    lines.push(
      `**Haunting level:** ${LEVEL_EMOJI[level]} **${escapeHtml(title)}** · 💀 ${counts.critical} · 👻 ${counts.high} · 🦇 ${counts.medium} · 🕸️ ${counts.low}`,
    );
  }
  lines.push("");

  lines.push("## 📜 What this PR does");
  lines.push(escapeHtml(summary.summary));
  lines.push("");

  if (kept.length === 0) {
    lines.push("## 🌕 All clear: no spirits detected in this PR.");
    lines.push("");
  } else {
    lines.push(`## 👻 Spirits found (${kept.length})`);
    lines.push("");
    kept.forEach((f, idx) => {
      const i = idx + 1;
      const creature = CREATURE[f.adjusted_severity];
      lines.push(
        `### ${i}. ${creature.emoji} ${creature.label} · ${titleCase(
          f.adjusted_severity,
        )} · ${CATEGORY_ICON[f.category]} ${titleCase(f.category)}: ${escapeHtml(
          f.title,
        )}`,
      );
      lines.push(
        `📍 [\`${escapeHtml(f.file)}:${f.start_line}\`](https://github.com/${owner}/${repo}/blob/${headSha}/${f.file}#L${f.start_line})`,
      );
      lines.push("");
      lines.push(escapeHtml(f.explanation));
      lines.push("");
      if (f.fix_code) {
        lines.push("<details><summary>🧪 Possible fix</summary>");
        lines.push("");
        lines.push("```" + langFromPath(f.file));
        lines.push(f.fix_code);
        lines.push("```");
        lines.push("</details>");
        lines.push("");
      }
      lines.push(`<sub>Confidence ${f.adjusted_confidence.toFixed(2)}</sub>`);
      lines.push("");
    });
  }

  lines.push("## 🏚️ Haunted halls (walkthrough)");
  lines.push("| Files | Change |");
  lines.push("|---|---|");
  for (const row of summary.walkthrough) {
    const files = row.files.map((f) => "`" + tableCell(f) + "`").join(", ");
    lines.push(`| ${files} | ${tableCell(row.change)} |`);
  }
  lines.push("");

  lines.push("## 🕯️ Where to look closely");
  for (const r of summary.risk_areas) {
    lines.push(`- ${escapeHtml(r)}`);
  }
  lines.push("");

  if (lurking.length > 0) {
    lines.push(
      `<details><summary>👁️ Lurking outside the diff (${lurking.length})</summary>`,
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
      `<details><summary>🧹 Exorcised false alarms (${exorcised.length})</summary>`,
    );
    lines.push("");
    for (const e of exorcised) {
      lines.push(`- ${escapeHtml(e.title)} — ${escapeHtml(e.reason)}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(
      `<details><summary>🪦 The Graveyard: files not hunted (${skipped.length})</summary>`,
    );
    lines.push("");
    for (const s of skipped) {
      lines.push(`- \`${escapeHtml(s.path)}\` — ${escapeHtml(s.reason)}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  const shortSha = headSha.slice(0, 7);
  lines.push(
    `<sub>🎃 Bug Hunter · powered by Google Gemini · effort ${summary.effort}/5 · hunted commit ${shortSha} · React 👍/👎 to tell the hunter how it did</sub>`,
  );

  return lines.join("\n");
}
