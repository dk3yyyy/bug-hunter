// GitHub REST calls used by the hunt.
import type { Octokit } from "@octokit/rest";
import { parsePatch } from "../diff/parse";
import { findingMarkerRegex, seanceMarker } from "../render/theme";
import type { ChangedFile } from "../types";

export interface PrInfo {
  title: string;
  body: string;
  state: string;
  draft: boolean;
  headSha: string;
  baseRef: string;
}

export async function getPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<PrInfo> {
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pr });
  return {
    title: data.title ?? "",
    body: data.body ?? "",
    state: data.state ?? "open",
    draft: Boolean(data.draft),
    headSha: data.head?.sha ?? "",
    baseRef: data.base?.ref ?? "",
  };
}

/** List changed files and parse each patch into hunks. */
export async function listFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pr,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const f of page.data) {
      const patch = typeof f.patch === "string" ? f.patch : undefined;
      files.push({
        filename: f.filename,
        status: f.status ?? "modified",
        previous_filename: f.previous_filename,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch,
        hunks: patch ? parsePatch(patch) : [],
        // Removed files legitimately have no patch; everything else without a
        // patch is binary or too large.
        isBinary: !patch && f.status !== "removed",
      });
    }
  }
  return files;
}

/** A GitHub issue's title/body, or null when it does not exist. */export async function getIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ title: string; body: string } | null> {
  try {
    const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
    return { title: data.title ?? "", body: data.body ?? "" };
  } catch {
    return null;
  }
}

/** File content at a ref (base-branch guidelines, head context). Null when absent/not a file. */
export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || !("content" in data) || !data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** Find the persistent Séance Report comment (by marker) and update it, or create one. */
export async function upsertSeance(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  body: string,
): Promise<number> {
  const marker = seanceMarker();
  const markedBody = body.includes(marker) ? body : `${marker}\n\n${body}`;

  let existingId: number | null = null;
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr,
    per_page: 100,
  });
  for await (const page of iterator) {
    const found = page.data.find((c) => typeof c.body === "string" && c.body.includes(marker));
    if (found) {
      existingId = found.id;
      break;
    }
  }

  if (existingId !== null) {
    const { data } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body: markedBody,
    });
    return data.id;
  }

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr,
    body: markedBody,
  });
  return data.id;
}

export interface InlineComment {
  path: string;
  body: string;
  side: "RIGHT";
  line: number;
  start_line?: number;
  start_side?: "RIGHT";
}

/** ONE pulls.createReview with the given inline comments. */
export async function postInlineReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  headSha: string,
  comments: InlineComment[],
  body?: string,
): Promise<void> {
  if (comments.length === 0) return;
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pr,
    commit_id: headSha,
    event: "COMMENT",
    body: body ?? "🎃 Bug Hunter has marked the spirits it found.",
    comments: comments as never,
  });
}

const FINDING_MARKER = findingMarkerRegex();

/** True for transient GitHub/network errors worth retrying. */
export function isRetryableGithubError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { status?: number; code?: string; message?: string };
  if (typeof err.status === "number" && [429, 500, 502, 503, 504].includes(err.status)) return true;
  const text = `${err.code ?? ""} ${err.message ?? ""}`;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|fetch failed/i.test(text);
}

/** Retry a GitHub call on transient errors, with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 400): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts - 1 || !isRetryableGithubError(e)) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

/** Fingerprints already posted as inline comments on this PR (for dedupe). */
export async function listExistingFingerprints(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<Set<string>> {
  return (await listExistingInline(octokit, owner, repo, pr)).fingerprints;
}

export interface ExistingInline {
  /** sha1 fingerprints from `<!-- bughunter:f=… -->` markers. */
  fingerprints: Set<string>;
  /** file path → the current-bot-comment line numbers on it. */
  positions: Map<string, number[]>;
}

/**
 * Every bot inline comment already on the PR: both its fingerprint and the
 * path/line it sits on. Re-runs dedupe on both (fp exact, line within ±1), so a
 * re-worded or slightly re-anchored finding can't post a second comment.
 */
export async function listExistingInline(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<ExistingInline> {
  const fingerprints = new Set<string>();
  const positions = new Map<string, number[]>();
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pr,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const c of page.data) {
      if (typeof c.body !== "string") continue;
      const ours = c.body.includes("bughunter:f=");
      if (!ours) continue;
      for (const m of c.body.matchAll(FINDING_MARKER)) fingerprints.add(m[1]);
      // Only comments still attached to the current diff can block a line.
      if (c.path && typeof c.line === "number") {
        const lines = positions.get(c.path) ?? [];
        lines.push(c.line);
        positions.set(c.path, lines);
      }
    }
  }
  return { fingerprints, positions };
}

/** True when this file already carries a bot comment within ±1 line. */
export function hasNearbyComment(
  positions: Map<string, number[]>,
  file: string,
  line: number,
): boolean {
  const lines = positions.get(file);
  if (!lines) return false;
  return lines.some((l) => Math.abs(l - line) <= 1);
}

/** Create a repo webhook pointing at this server (Option B auto-connect). */
export async function createRepoWebhook(
  octokit: Octokit,
  owner: string,
  repo: string,
  url: string,
  secret: string,
): Promise<number> {
  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    name: "web",
    active: true,
    config: { url, content_type: "json", secret },
    // pull_request drives hunts; issue_comment drives @bot hunt/seance/spellbook.
    events: ["pull_request", "issue_comment"],
  });
  return data.id;
}

/**
 * Idempotent webhook creation for the "Connect a repo" button.
 *
 * Clicking Connect twice used to fail with GitHub's 422 "Hook already exists",
 * which reads like the button is broken. If a hook already points at this
 * server's /webhooks/github, report it instead of creating a duplicate.
 */
export async function ensureRepoWebhook(
  octokit: Octokit,
  owner: string,
  repo: string,
  url: string,
  secret: string,
): Promise<{ id: number; created: boolean }> {
  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo,
    per_page: 100,
  });
  const existing = hooks.find((h) => {
    const config = h.config as unknown as { url?: unknown };
    return typeof config.url === "string" && config.url === url;
  });
  if (existing) return { id: existing.id, created: false };
  return { id: await createRepoWebhook(octokit, owner, repo, url, secret), created: true };
}

/** React 👀 to a comment (best-effort, never throws). */
export async function addReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  reaction: "eyes",
): Promise<void> {
  try {
    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: reaction,
    });
  } catch {
    // Reactions are cosmetic.
  }
}

/** Post a top-level PR comment (command replies). */
export async function replyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  body: string,
): Promise<number> {
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr,
    body,
  });
  return data.id;
}

/** Reply inside an existing inline review-comment thread. */
export async function replyToReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  commentId: number,
  body: string,
): Promise<number> {
  const { data } = await withRetry(() =>
    octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: pr,
      comment_id: commentId,
      body,
    }),
  );
  return data.id;
}

/** Set a commit status (Option A can't create check runs). Non-critical: never throws. */
export async function setCommitStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  status: { context: string; state: "success" | "failure" | "pending" | "error"; description: string },
): Promise<void> {
  try {
    await octokit.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      context: status.context,
      state: status.state,
      description: status.description,
    });
  } catch (e) {
    console.warn("commit status failed", { context: status.context, error: e instanceof Error ? e.name : "Error" });
  }
}
