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
  kept: KeptFinding[];
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

export async function runHunt(input: HuntInput, deps: HuntDeps): Promise<HuntResult> {
  // 1. Sanitize the PR body; flag possession attempts.
  const {
    clean: cleanBody,
    hidden: hiddenContent,
    possession: possessionAttempt,
  } = sanitizeText(input.prBody);

  // 2. Filter the changed files.
  const { kept: keptFiles, skipped } = filterFiles(input.files);

  // 3. Review pass (throws propagate to the caller/server).
  const baseVars: Record<string, string> = {
    max_findings: String(input.maxFindings),
    repo_rules: input.repoRules,
    pr_title: input.prTitle,
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

  // 5. Verify pass.
  if (candidates.length > 0) {
    const verifyPrompt = renderTemplate(input.prompts.verify, {
      repo_rules: input.repoRules,
      candidates_with_ids: candidatesJson(candidates),
      annotated_diff: input.annotatedDiff,
      context: input.context,
    });
    const verdict: VerdictT = await deps.verify({ system: "", user: verifyPrompt });
    ({ kept, exorcised } = applyVerdict(candidates, verdict));
  }

  // 6. Resolve inline positions; drop findings whose file isn't in the diff.
  const keptFilenames = new Set(keptFiles.map((f) => f.filename));
  const anchored: KeptFinding[] = [];
  for (const k of kept) {
    if (!keptFilenames.has(k.file)) {
      exorcised.push({ id: k.id, title: k.title, severity: k.severity, reason: "file not in diff" });
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

  // 7. Confidence/severity filter, then order and cap.
  const passing = kept.filter(
    (k) => k.adjusted_confidence >= input.confidenceThreshold && k.adjusted_severity !== "nitpick",
  );

  const sorted = [...passing].sort((a, b) => {
    const r = SEVERITY_RANK[a.adjusted_severity] - SEVERITY_RANK[b.adjusted_severity];
    if (r !== 0) return r;
    return b.adjusted_confidence - a.adjusted_confidence;
  });

  const perFile = new Map<string, number>();
  const finalKept: KeptFinding[] = [];
  for (const k of sorted) {
    const count = perFile.get(k.file) ?? 0;
    if (finalKept.length >= input.maxFindings || count >= 3) {
      exorcised.push({ id: k.id, title: k.title, severity: k.severity, reason: "over cap / >3 per file" });
      continue;
    }
    finalKept.push(k);
    perFile.set(k.file, count + 1);
  }
  kept = finalKept;

  // 8. Counts + haunting level.
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
      pr_title: input.prTitle,
      pr_body: cleanBody,
      changed_files_list: keptFiles.map((f) => f.filename).join("\n") || "(none)",
      summary_hint: notes.join("\n"),
      context: input.context,
      repo_rules: input.repoRules,
    });
    summary = await deps.seance({ system: "", user: seancePrompt });
  } catch {
    summary = emptySeance();
  }

  // 10. Assemble the result.
  return {
    possessionAttempt,
    hiddenContent,
    kept,
    exorcised,
    skipped,
    summary,
    counts,
    haunting,
    notes,
  };
}
