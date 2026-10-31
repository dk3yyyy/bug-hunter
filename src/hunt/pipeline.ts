import type {
  ChangedFile,
  ExorcisedFinding,
  HauntingLevel,
  HuntCounts,
  KeptFinding,
  ReviewOutputT,
  SeanceOutputT,
  VerdictT,
} from "../types";
import { resolvePosition } from "../diff/commentable";
import { filterFiles } from "./filters";
import { candidatesJson, withIds } from "./review";
import { sanitizeText } from "./sanitize";
import { emptySeance } from "./summary";
import { applyVerdict } from "./verify";

/** Replace `{{key}}` placeholders with values from `vars`.
 * Throws when a key is missing or any {{...}} survives — never send
 * unfilled placeholders to the model. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (!(k in vars)) {
      missing.add(k);
      return m;
    }
    return vars[k];
  });
  if (missing.size > 0) {
    throw new Error(`missing template vars: ${[...missing].join(", ")}`);
  }
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`unfilled placeholder in prompt: ${leftover[0]}`);
  }
  return out;
}

/** Injected LLM calls, so the pipeline itself never touches the network. */
export interface HuntDeps {
  review: (args: { system: string; user: string }) => Promise<ReviewOutputT>;
  verify: (args: { system: string; user: string }) => Promise<VerdictT>;
  seance: (args: { system: string; user: string }) => Promise<SeanceOutputT>;
}

export interface HuntInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  prTitle: string;
  prBody: string;
  files: ChangedFile[];
  repoRules: string;
  context: string; // already-built context text
  annotatedDiff: string; // already-rendered annotated diff
  prompts: { system: string; user: string; verify: string; seance: string }; // raw templates
  maxFindings: number;
  confidenceThreshold: number;
}

export interface HuntResult {
  possessionAttempt: boolean;
  hiddenContent: string[];
  /** Anchored findings: posted in "Spirits found", inline, and counted in the haunting level. */
  kept: KeptFinding[];
  /** Real findings that could not be anchored to a changed line (SPEC §9.3). Report-only, not counted. */
  lurking: KeptFinding[];
  /** True when the verifier call failed and candidates were kept unverified (no suggestions). */
  verifierFailed: boolean;
  exorcised: ExorcisedFinding[];
  skipped: { path: string; reason: string }[];
  summary: SeanceOutputT;
  counts: HuntCounts;
  haunting: { level: HauntingLevel; title: string };
  notes: string[];
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  nitpick: 4,
};

/**
 * Haunting level from the kept findings (SPEC §3.4). "only cobwebs/candy" maps
 * to whispers: we treat `low` (cobweb) and `nitpick` (candy) as that tier.
 */
export function computeHaunting(
  counts: HuntCounts,
  possessionAttempt: boolean,
): { level: HauntingLevel; title: string } {
  if (counts.critical > 0 || possessionAttempt) {
    return { level: "possessed", title: "Possessed: do not merge" };
  }
  if (counts.high > 0) {
    return { level: "haunted", title: "This PR is haunted" };
  }
  if (counts.medium > 0) {
    return { level: "restless", title: "Restless spirits detected" };
  }
  if (counts.low > 0 || counts.nitpick > 0) {
    return { level: "whispers", title: "Faint whispers: minor cleanup only" };
  }
  return { level: "clear", title: "All clear: no spirits detected" };
}

/** Max findings shown in "Lurking outside the diff". */
const MAX_LURKING = 5;

export async function runHunt(input: HuntInput, deps: HuntDeps): Promise<HuntResult> {
  // 1. Sanitize the PR title AND body; flag possession attempts in either.
  // Titles ride raw into prompts, so comments are stripped and invisible
  // characters removed before templating.
  const titleScan = sanitizeText(input.prTitle);
  const bodyScan = sanitizeText(input.prBody);
  const cleanTitle = titleScan.clean.trim();
  const cleanBody = bodyScan.clean;
  const hiddenContent = [...titleScan.hidden, ...bodyScan.hidden];
  const possessionAttempt = titleScan.possession || bodyScan.possession;

  // 2. Filter the changed files.
  const { kept: keptFiles, skipped } = filterFiles(input.files);

  // 3. Review pass (throws propagate to the caller/server).
  // The review schema caps findings at 40: never instruct more than that.
  const maxFindings = Math.min(input.maxFindings, 40);
  const baseVars: Record<string, string> = {
    max_findings: String(maxFindings),
    repo_rules: input.repoRules,
    pr_title: cleanTitle,
    pr_body: cleanBody,
    hidden_content_or_none: hiddenContent.length ? hiddenContent.join("\n---\n") : "(none)",
    context: input.context,
    annotated_diff: input.annotatedDiff,
  };
  const reviewSystem = renderTemplate(input.prompts.system, baseVars);
  const reviewUser = renderTemplate(input.prompts.user, baseVars);
  const review: ReviewOutputT = await deps.review({ system: reviewSystem, user: reviewUser });

  // 4. Assign ids; skip verification when there is nothing to verify.
  const candidates = withIds(review.findings);

  let kept: KeptFinding[] = [];
  let exorcised: ExorcisedFinding[] = [];
  let verifierFailed = false;

  // 5. Verify pass. A failed verifier must not kill the hunt: keep the candidates
  //    at the reviewer's own confidence, but with no one-click suggestions, and the
  //    report shows an "unverified" banner (result.verifierFailed).
  if (candidates.length > 0) {
    const verifyPrompt = renderTemplate(input.prompts.verify, {
      repo_rules: input.repoRules,
      candidates_with_ids: candidatesJson(candidates),
      annotated_diff: input.annotatedDiff,
      context: input.context,
    });
    let verdict: VerdictT;
    try {
      verdict = await deps.verify({ system: "", user: verifyPrompt });
    } catch {
      verifierFailed = true;
      verdict = { results: [] };
    }
    // applyVerdict keeps candidates with no verdict at their original confidence
    // and fix_ok = false, which is exactly the unverified fallback.
    ({ kept, exorcised } = applyVerdict(candidates, verdict));
  }

  // 6. Resolve inline positions; drop findings whose file isn't in the diff.
  const keptFilenames = new Set(keptFiles.map((f) => f.filename));
  const anchored: KeptFinding[] = [];
  for (const k of kept) {
    if (!keptFilenames.has(k.file)) {
      exorcised.push({ id: k.id, title: k.title, severity: k.severity, reason: "file not in diff", source: "trimmed" });
      continue;
    }
    const position = resolvePosition(keptFiles, {
      file: k.file,
      start_line: k.start_line,
      end_line: k.end_line,
      evidence_quote: k.evidence_quote,
    });
    anchored.push({ ...k, position });
  }
  kept = anchored;

  // 7. Confidence/severity filter, then order and cap. Everything dropped
  // here is recorded as exorcised so the report accounts for every candidate.
  const passing: KeptFinding[] = [];
  for (const k of kept) {
    if (k.adjusted_severity === "nitpick") {
      exorcised.push({ id: k.id, title: k.title, severity: k.severity, reason: "downgraded to nitpick", source: "trimmed" });
    } else if (k.adjusted_confidence < input.confidenceThreshold) {
      exorcised.push({
        id: k.id,
        title: k.title,
        severity: k.severity,
        reason: `below confidence threshold (${k.adjusted_confidence.toFixed(2)} < ${input.confidenceThreshold})`,
        source: "trimmed",
      });
    } else {
      passing.push(k);
    }
  }

  const sorted = [...passing].sort((a, b) => {
    const r = SEVERITY_RANK[a.adjusted_severity] - SEVERITY_RANK[b.adjusted_severity];
    if (r !== 0) return r;
    return b.adjusted_confidence - a.adjusted_confidence;
  });

  // Unanchored findings go to "Lurking outside the diff" only (SPEC §9.3):
  // not in "Spirits found", not inline, not counted in the haunting level.
  const lurking = sorted.filter((k) => !k.position).slice(0, MAX_LURKING);

  const perFile = new Map<string, number>();
  const finalKept: KeptFinding[] = [];
  for (const k of sorted) {
    if (!k.position) continue;
    const count = perFile.get(k.file) ?? 0;
    if (finalKept.length >= maxFindings || count >= 3) {
      exorcised.push({
        id: k.id,
        title: k.title,
        severity: k.severity,
        reason: "over cap / >3 per file",
        source: "trimmed",
      });
      continue;
    }
    finalKept.push(k);
    perFile.set(k.file, count + 1);
  }
  kept = finalKept;

  // 8. Counts + haunting level (anchored findings only).
  const counts: HuntCounts = { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 };
  for (const k of kept) {
    counts[k.adjusted_severity] += 1;
  }
  const haunting = computeHaunting(counts, possessionAttempt);

  // 9. Séance summary (degrade to a safe default on failure).
  const notes = [...review.notes_for_summary];
  let summary: SeanceOutputT;
  try {
    const seancePrompt = renderTemplate(input.prompts.seance, {
      annotated_diff: input.annotatedDiff,
      pr_title: cleanTitle,
      pr_body: cleanBody,
      changed_files_list: keptFiles.map((f) => f.filename).join("\n") || "(none)",
      summary_hint: notes.join("\n"),
      context: input.context,
      repo_rules: input.repoRules,
    });
    summary = await deps.seance({ system: "", user: seancePrompt });
  } catch {
    // Visible degradation: never render a silently blank summary section.
    summary = emptySeance();
    summary.summary = "Summary unavailable — the séance pass failed, but the hunt above continued.";
    notes.push("SUMMARY UNAVAILABLE: the seance model call failed; findings above are unaffected.");
  }

  // 10. Assemble the result.
  return {
    possessionAttempt,
    hiddenContent,
    kept,
    lurking,
    verifierFailed,
    exorcised,
    skipped,
    summary,
    counts,
    haunting,
    notes,
  };
}
