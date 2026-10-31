// GitHub REST calls used by the hunt (SPEC §6, §11).
import type { Octokit } from "@octokit/rest";
import { parsePatch } from "../diff/parse";
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
  const marker = "<!-- bughunter:seance -->";
  const markedBody = body.includes(marker) ? body : `${marker}\n\n${body}`;

  let existingId: number | null = null;
  for (let page = 1; page <= 5 && existingId === null; page += 1) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pr,
      per_page: 100,
      page,
    });
    const found = data.find((c) => typeof c.body === "string" && c.body.includes(marker));
    if (found) existingId = found.id;
    if (data.length < 100) break;
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

/** ONE pulls.createReview with the given inline comments (SPEC §11, Step 3). */
export async function postInlineReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  headSha: string,
  comments: InlineComment[],
): Promise<void> {
  if (comments.length === 0) return;
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pr,
    commit_id: headSha,
    event: "COMMENT",
    body: "🎃 Bug Hunter has marked the spirits it found.",
    comments: comments as never,
  });
}

const FINDING_MARKER = /<!--\s*bughunter:f=([a-f0-9]{40})\s*-->/g;

/** Fingerprints already posted as inline comments on this PR (for dedupe). */
export async function listExistingFingerprints(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<Set<string>> {
  const out = new Set<string>();
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pr,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const c of page.data) {
      if (typeof c.body !== "string") continue;
      for (const m of c.body.matchAll(FINDING_MARKER)) out.add(m[1]);
    }
  }
  return out;
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
    events: ["pull_request"],
  });
  return data.id;
}

/** Set a commit status (Option A can't create check runs) — SPEC §6, §13.3. Non-critical: never throws. */
export async function setCommitStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  status: { context: string; state: "success" | "failure" | "pending"; description: string },
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
