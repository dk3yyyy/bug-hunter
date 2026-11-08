// Bug Hunter server — Hono app, webhook ingress, manual trigger, in-process queue.
import { serve } from "@hono/node-server";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Octokit } from "@octokit/rest";
import { Webhooks } from "@octokit/webhooks";
import PQueue from "p-queue";
import { env } from "./env";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUser,
  refreshAccessToken,
  OAUTH_SCOPES,
} from "./auth";
import { openSession, sealSession, SESSION_TTL_MS, type Session } from "./session";
import { recallRepoConnection, rememberRepoConnection, repoConnectionCount } from "./tenancy";
import { getOctokit } from "./github/client";
import { createHuntStore } from "./store";
import { installUrl, addRepo, removeRepo, listRepos, connectUrlFor, installationIdForRepo } from "./github/app";
import { webhookUrlFor } from "./connect";
import * as api from "./github/api";
import {
  isSelfEvent,
  isSkippedAuthor,
  isTrustedCommander,
  parseCommand,
  prTarget,
  shouldHunt,
  type PrWebhookPayload,
} from "./github/webhooks";
import { runHunt, type HuntDeps } from "./hunt/pipeline";
import { buildContext, buildRepoRules } from "./hunt/context";
import { filterFiles } from "./hunt/filters";
import { formatLinkedIssues, parseIssueRefs } from "./hunt/issues";
import {
  formatLearnings,
  parseLearningCommand,
  MAX_LEARNING_CHARS,
  type Learning,
} from "./learnings";
import { BoundedSet, HuntRateLimiter, planBudget, trimContext } from "./hunt/budget";
import { annotateDiff } from "./diff/annotate";
import { renderSeance, escapeHtml } from "./render/seance";
import { renderInline, renderReviewBody } from "./render/inline";
import { errorStatus, hauntingToStatus, nothingToHuntStatus, pendingStatus } from "./render/status";
import { renderLanding, renderDashboard, renderSummoned, renderConnect, renderNotFound } from "./render/pages";
import { scrubSecrets } from "./security";
import { notifyHunt, type HuntNotifyPayload } from "./n8n";
import { getModel, resolveModelConfig } from "./llm/models";
import { costOf, capMessage, overCap, type TokenUsage } from "./cost";
import { providerDisplayName } from "./llm/config";
import { generateStructured } from "./llm/structured";
import { loadAllPrompts } from "./prompts";
import {
  ReviewOutput,
  Verdict,
  SeanceOutput,
  type HuntRecord,
} from "./types";

const app = new Hono();
export { app };
const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
const queue = new PQueue({ concurrency: 2 });

const seenDeliveries = new BoundedSet(5000);
const rateLimiter = new HuntRateLimiter(10, 60 * 60 * 1000); // max 10 hunts per PR per hour

/** Thrown when a PR has used up its hunts for the hour. */
export class HuntRateLimitedError extends Error {
  override name = "HuntRateLimitedError";
}

/** Month-to-date spend reached the configured cap; no model calls are made. */
export class HuntBudgetError extends Error {
  override name = "HuntBudgetError";
  constructor(
    message: string,
    readonly spendUsd: number,
    readonly capUsd: number,
  ) {
    super(message);
  }
}
const debounceTimers = new Map<string, NodeJS.Timeout>();
const HUNT_DEBOUNCE_MS = 60_000;
// One in-flight hunt per PR (duplicate runs = duplicate comments + spend).
const runningHunts = new Set<string>();

function rememberDelivery(id: string): boolean {
  if (seenDeliveries.has(id)) return false;
  seenDeliveries.add(id);
  return true;
}
// Per-PR cooldown for @bot command hunts (spend protection).
const commandCooldown = new Map<string, number>();
const COMMAND_COOLDOWN_MS = 5 * 60_000;

const hunts = createHuntStore(env.DATABASE_URL);

function logFailure(repo: string, pr: number, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  if (name === "HuntRateLimitedError") {
    console.warn("hunt skipped: rate limited", { repo, pr });
    return;
  }
  // The name alone ("Error") hides the actual cause -- an LLM call that failed
  // with "Insufficient account funds" looked identical to a template bug. Include a
  // scrubbed, truncated message so failures are diagnosable from the logs.
  const detail =
    err instanceof Error && err.message ? `: ${scrubSecrets(err.message).slice(0, 200)}` : "";
  console.error("hunt failed", { repo, pr, error: name + detail });
}

function authSecret(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const given = c.req.header("x-bughunter-secret") ?? "";
  if (given.length === 0) return false;
  // Constant-time compare on hashes so secret length isn't leaked by timing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(env.N8N_SHARED_SECRET).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// "Connect with GitHub" — OAuth login (replaces pasting the shared secret).
//
// The shared secret stays supported for scripts, n8n and the existing tests; the
// browser flow now prefers a session cookie. Everything is opt-in: with no OAuth
// App configured the login button is hidden and nothing changes.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "bh_session";
const STATE_COOKIE = "bh_oauth_state";

/** True when an OAuth App is configured well enough to offer a login button. */
export function oauthEnabled(): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID.trim() && env.GITHUB_OAUTH_CLIENT_SECRET.trim());
}

/** Key for sealing sessions; falls back so a deployment without SESSION_SECRET still works. */
function sessionKey(): string {
  return env.SESSION_SECRET.trim() || `bh-session:${env.N8N_SHARED_SECRET}`;
}

/** The callback URL registered on the OAuth App. Explicit setting wins. */
function redirectUriFor(): string {
  const explicit = env.GITHUB_OAUTH_REDIRECT_URI.trim();
  if (explicit) return explicit;
  const base = (env.PUBLIC_URL.trim() || env.APP_URL.trim()).replace(/\/+$/, "");
  return base ? `${base}/auth/github/callback` : "";
}

function cookieOptions(): { httpOnly: true; path: string; sameSite: "Lax"; secure: boolean } {
  // Secure is required for the cookie to come back over HTTPS, but would break
  // local http://localhost dev, so it follows the configured public scheme.
  return { httpOnly: true, path: "/", sameSite: "Lax", secure: redirectUriFor().startsWith("https://") };
}

/** The signed-in user, or null. Treats every malformed cookie as logged out. */
export function currentSession(c: Context): Session | null {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  return openSession(raw, sessionKey());
}

/** The allowlist, lowercased. Empty = no restriction beyond GitHub's own checks. */
function allowedLogins(): Set<string> {
  return new Set(
    env.ALLOWED_GITHUB_LOGINS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Who may call /api/*. A logged-in session OR the legacy shared secret — so the
 * existing header-based callers (n8n, scripts, tests) keep working.
 */
export function isAuthorized(c: Context): boolean {
  return currentSession(c) !== null || authSecret(c);
}

/** Human-readable outcome of the login redirect, keyed by the ?login= value. */
const LOGIN_NOTICES: Record<string, string> = {
  ok: "Signed in with GitHub.",
  out: "Signed out.",
  cancelled: "GitHub login was cancelled.",
  state: "That login link expired or did not match this browser. Please try again.",
  code: "GitHub did not return a login code. Please try again.",
  exchange: "GitHub rejected the login exchange — check the OAuth App's client ID and secret.",
  user: "Signed in, but your GitHub profile could not be read. Please try again.",
  denied: "That GitHub account is not allowed to sign in to this instance.",
  disabled: "GitHub login is not configured on this server.",
};

/** The OAuth client config, as the settings above resolve it. */
function oauthCfg() {
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID.trim(),
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET.trim(),
    redirectUri: redirectUriFor(),
  };
}

/** Refresh slightly before real expiry so a request never races the deadline. */
/** Refresh a stored per-repo token shortly before it expires, re-sealing it. */
const REPO_REFRESH_SKEW_MS = 60_000;

/**
 * The token to act as for this repo: the user who connected it, when we still have
 * their (refreshable) token. Null means fall back to the server token — correct for
 * the operator's own repo, and the graceful path for mappings lost on restart.
 */
async function huntTokenFor(repo: string): Promise<string | null> {
  if (env.GITHUB_MODE === "app") return null; // App mode uses installation tokens.
  const conn = await recallRepoConnection(repo, sessionKey());
  if (!conn) return null;

  const expiring = typeof conn.expiresAt === "number";
  if (!expiring || conn.expiresAt! - Date.now() > REPO_REFRESH_SKEW_MS) return conn.token;
  if (!conn.refreshToken || !oauthEnabled()) return conn.token;

  const refreshed = await refreshAccessToken(oauthCfg(), conn.refreshToken);
  if (!refreshed.ok) {
    console.error("repo token refresh failed:", refreshed.reason);
    return conn.token;
  }
  const next = {
    login: conn.login,
    token: refreshed.accessToken,
    ...(refreshed.expiresIn ? { expiresAt: Date.now() + refreshed.expiresIn * 1000 } : {}),
    ...(refreshed.refreshToken
      ? { refreshToken: refreshed.refreshToken }
      : conn.refreshToken
        ? { refreshToken: conn.refreshToken }
        : {}),
  };
  await rememberRepoConnection(repo, next, sessionKey());
  return next.token;
}

const REFRESH_SKEW_MS = 60_000;

/**
 * A usable access token for this session, refreshed first when it is about to
 * expire. OAuth Apps created since Aug 2026 hand out 8-hour access tokens, so a
 * 30-day session cookie would otherwise look signed in while every GitHub call
 * returned 401. If the refresh fails the stale token is returned, letting GitHub's
 * own 401 surface instead of pretending the call succeeded.
 */
async function tokenForSession(c: Context, session: Session): Promise<string> {
  const expiresAt = session.expiresAt;
  if (typeof expiresAt !== "number" || expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return session.token;
  }
  if (!session.refreshToken || !oauthEnabled()) return session.token;

  const refreshed = await refreshAccessToken(oauthCfg(), session.refreshToken);
  if (!refreshed.ok) {
    console.error("session refresh failed:", refreshed.reason);
    return session.token;
  }

  const next: Session = {
    login: session.login,
    token: refreshed.accessToken,
    exp: session.exp,
    ...(session.name ? { name: session.name } : {}),
    ...(session.avatar ? { avatar: session.avatar } : {}),
    ...(refreshed.expiresIn ? { expiresAt: Date.now() + refreshed.expiresIn * 1000 } : {}),
    // GitHub can rotate the refresh token; always keep the newest one.
    ...(refreshed.refreshToken
      ? { refreshToken: refreshed.refreshToken }
      : session.refreshToken
        ? { refreshToken: session.refreshToken }
        : {}),
  };
  setCookie(c, SESSION_COOKIE, sealSession(next, sessionKey()), {
    ...cookieOptions(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return next.token;
}

/**
 * Turn a hunt exception into something a user can act on. The raw message usually
 * carries the real cause (provider credit, auth, network), so it is scrubbed of
 * secrets and truncated rather than replaced by the error's name.
 */
export function huntErrorDetail(e: unknown): { message: string; code: string; hint?: string } {
  const code = e instanceof Error ? e.name : "UnknownError";
  const raw = e instanceof Error ? e.message : "";
  const message = scrubSecrets(raw).replace(/\s+/g, " ").trim().slice(0, 400);

  if (/insufficient (account )?funds|quota|billing|payment required/i.test(message)) {
    return {
      message: message || "The model provider rejected the request.",
      code,
      hint: "The model provider account is out of credit or over quota. Top it up, or set a different LLM_PROVIDER/key.",
    };
  }
  if (/unauthorized|bad credentials|401/i.test(message)) {
    return {
      message: message || "GitHub rejected the token.",
      code,
      hint: "GITHUB_TOKEN is missing, expired, or missing scopes (repo, repo:status, admin:repo_hook).",
    };
  }
  if (/rate limit|secondary rate/i.test(message)) {
    return { message, code, hint: "GitHub rate limit — retry in a minute." };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(message)) {
    return { message, code, hint: "Could not reach an upstream service. Check the server logs." };
  }
  return {
    message: message || `The hunt failed (${code}) without an error message.`,
    code,
    hint: "Check the server logs for the full trace.",
  };
}

function githubStatus(e: unknown): number | undefined {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Turn Octokit's terse error names into something the Connect button can show.
 * "HttpError" alone leaves people guessing whether the repo, token or URL is wrong.
 */
function connectErrorMessage(e: unknown): string {
  const status = githubStatus(e);
  if (status === 401) return "GitHub rejected the token — check GITHUB_TOKEN.";
  if (status === 403)
    return "The token can't manage webhooks. Fine-grained tokens need Webhooks: Read & write; classic tokens need admin:repo_hook.";
  if (status === 404)
    return "Repo not found, or the token can't see it. Check owner/name and the token's repository access.";
  if (status === 422)
    return "GitHub rejected the webhook (422) — the URL may be unreachable or the repo hit its webhook limit.";
  return e instanceof Error ? `${e.name} while creating the webhook` : "Webhook creation failed";
}

async function readGuidelines(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  baseRef: string,
): Promise<string> {
  // Repo rules come from the BASE branch (never head): a PR can't change its own rules.
  return buildRepoRules(octokit, owner, repo, baseRef);
}

// Prompts + voice are loaded once at startup and cached (never send {{...}} to Gemini).
const PROMPTS = loadAllPrompts();

async function runHuntForPr(
  owner: string,
  repo: string,
  prNumber: number,
  expectedHeadSha?: string,
  installationId?: number,
  /** Token of the user who connected this repo; null/undefined = server token. */
  userToken?: string | null,
  /** Pre-generated id for async callers that return it before the hunt finishes. */
  huntId?: string,
): Promise<HuntRecord | null> {
  // Per-PR mutual exclusion: a debounced synchronize hunt and a manual @bot
  // hunt must not run concurrently (duplicate inline comments + double spend).
  const huntKey = `${owner}/${repo}#${prNumber}`;
  if (runningHunts.has(huntKey)) return null;
  runningHunts.add(huntKey);
  try {
    return await runHuntForPrInner(
      owner,
      repo,
      prNumber,
      expectedHeadSha,
      installationId,
      userToken,
      huntId,
    );
  } finally {
    runningHunts.delete(huntKey);
  }
}

async function runHuntForPrInner(
  owner: string,
  repo: string,
  prNumber: number,
  expectedHeadSha?: string,
  installationId?: number,
  userToken?: string | null,
  huntId?: string,
): Promise<HuntRecord | null> {
  // Act as the user who connected this repo when we know them, so the review is
  // attributed to them and constrained by their own permissions. Falls back to the
  // server token (operator's own repo, App mode, or a mapping lost on restart).
  const octokit = userToken ? new Octokit({ auth: userToken }) : await getOctokit(installationId);

  // Re-fetch current state; drop closed/draft/stale before spending.
  const pr = await api.getPr(octokit, owner, repo, prNumber);
  if (pr.state !== "open" || pr.draft) return null;
  // Stale event: the head moved since this webhook fired. The newer
  // push has its own (debounced) synchronize event, so skip this one.
  if (expectedHeadSha && expectedHeadSha !== pr.headSha) return null;

  if (!rateLimiter.tryAcquire(`${owner}/${repo}#${prNumber}`)) {
    throw new HuntRateLimitedError("max hunts per PR per hour reached");
  }

  // Spend protection: refuse before any model call when the month is over budget.
  const capUsd = env.MONTHLY_COST_CAP_USD;
  if (capUsd > 0) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const spend = await hunts.spendSince(monthStart.toISOString());
    if (overCap(spend, capUsd)) {
      throw new HuntBudgetError(capMessage(spend, capUsd), spend, capUsd);
    }
  }

  const pending = pendingStatus();
  await api.setCommitStatus(octokit, owner, repo, pr.headSha, {
    context: pending.context,
    state: "pending",
    description: pending.description,
  });

  try {
    return await huntOpenPr(octokit, owner, repo, prNumber, pr, huntId);
  } catch (e) {
    // Never leave the PR stuck on "pending". Budget refusals say why; everything
    // else uses the voice-flavored error copy.
    const err =
      e instanceof HuntBudgetError
        ? { context: pendingStatus().context, state: "error" as const, description: e.message.slice(0, 140) }
        : errorStatus();
    await api.setCommitStatus(octokit, owner, repo, pr.headSha, err);
    throw e;
  }
}

/**
 * Post an honest "nothing to hunt" result instead of a fabricated all-clear.
 * No model call, no findings, and a status that says why rather than implying the
 * diff passed review.
 */
async function nothingToHunt(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  prNumber: number,
  pr: Awaited<ReturnType<typeof api.getPr>>,
  skipped: Array<{ path: string; reason: string }>,
  huntId?: string,
): Promise<HuntRecord> {
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const summary =
    [...byReason.entries()].map(([reason, n]) => `${n} × ${reason}`).join(", ") || "no files changed";

  await api.withRetry(() =>
    api.upsertSeance(
      octokit,
      owner,
      repo,
      prNumber,
      scrubSecrets(
        `## Nothing to hunt\n\nThis PR has **no reviewable files**, so no review was run. ` +
          `Skipped: ${summary}.\n\nIf this looks wrong, check that the changes are not all ` +
          "lockfiles, generated or vendored code, binaries, or pure renames — those are skipped by design.",
      ),
    ),
  );
  await api.setCommitStatus(octokit, owner, repo, pr.headSha, nothingToHuntStatus());

  const zero = { critical: 0, high: 0, medium: 0, low: 0, nitpick: 0 };
  const record: HuntRecord = {
    id: huntId ?? `h_${Math.random().toString(36).slice(2, 10)}`,
    repo: `${owner}/${repo}`,
    prNumber,
    prTitle: pr.title,
    prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    hauntingLevel: "clear",
    counts: zero,
    possessionAttempt: false,
    exorcised: 0,
    keptCount: 0,
    topFindings: [],
    finishedAt: new Date().toISOString(),
  };
  await hunts.save(record);
  return record;
}

async function huntOpenPr(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  prNumber: number,
  pr: Awaited<ReturnType<typeof api.getPr>>,
  huntId?: string,
): Promise<HuntRecord> {
  const files = await api.listFiles(octokit, owner, repo, prNumber);
  const repoRules = await readGuidelines(octokit, owner, repo, pr.baseRef);

  // Only hunted files reach the model: lockfiles, generated, vendored, minified,
  // binary and over-limit files are filtered out here. The
  // pipeline still receives every file so it can list skips in the Graveyard.
  const { kept: huntedFiles, skipped: skippedFiles } = filterFiles(files);

  // Nothing reviewable (lockfile-only, generated, binary, pure rename, >40 files all
  // filtered). Running the model here would burn calls and then post a green
  // "All clear — the hunter searched every changed line" over a PR it never read.
  if (huntedFiles.length === 0) {
    return nothingToHunt(octokit, owner, repo, prNumber, pr, skippedFiles, huntId);
  }

  // Input budget (~30k tokens, step 5): the diff gets priority,
  // context is trimmed to whatever is left.
  const fullDiff = annotateDiff(huntedFiles).text;
  const { diffMaxChars, contextMaxChars } = planBudget(fullDiff.length);
  const annotated = annotateDiff(huntedFiles, { maxChars: diffMaxChars }).text;
  const context = trimContext(
    await buildContext(octokit, owner, repo, pr.headSha, huntedFiles),
    contextMaxChars,
  );

  const prompts = PROMPTS;

  // One conversation id for the whole hunt: OpenCode Go requires it and uses it to
  // route and cache across the review/verify/seance passes.
  const sessionId = `bh-${randomUUID()}`;
  // Token usage accumulates across all passes (retries and the repair call included).
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (u: { inputTokens: number; outputTokens: number }): void => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };
  const deps: HuntDeps = {
    review: ({ system, user }) =>
      generateStructured({
        model: getModel("review", { sessionId }),
        schema: ReviewOutput,
        system,
        prompt: user,
        onUsage: addUsage,
      }),
    verify: ({ system, user }) =>
      generateStructured({
        model: getModel("verify", { sessionId }),
        schema: Verdict,
        system,
        prompt: user,
        onUsage: addUsage,
      }),
    seance: ({ system, user }) =>
      generateStructured({
        model: getModel("fast", { sessionId }),
        schema: SeanceOutput,
        system,
        prompt: user,
        onUsage: addUsage,
      }),
  };
  const modelCfg = resolveModelConfig(env, "review");

  // Linked issues: fetch the GitHub issues named in the PR, and surface any
  // tracker keys (Jira/Linear) as plain text. Untrusted; the prompts delimit it.
  const refs = parseIssueRefs(`${pr.title}\n${pr.body}`);
  const fetchedIssues: Array<{ ref: string; title: string; body?: string }> = [];
  for (const n of refs.github.slice(0, 5)) {
    const issue = await api.getIssue(octokit, owner, repo, n);
    if (issue) fetchedIssues.push({ ref: `#${n}`, title: issue.title, body: issue.body });
  }
  const linkedParts: string[] = [];
  if (fetchedIssues.length > 0) linkedParts.push(formatLinkedIssues(fetchedIssues));
  if (refs.keys.length > 0) linkedParts.push(`Referenced tickets: ${refs.keys.slice(0, 10).join(", ")}`);
  const linkedIssues = linkedParts.length > 0 ? linkedParts.join("\n") : "(none)";

  // Reviewer corrections for this repo: injected as extra review rules.
  const repoLearnings = await hunts.listLearnings(`${owner}/${repo}`, 20);
  const learnings = formatLearnings(repoLearnings);

  const result = await runHunt(
    {
      owner,
      repo,
      prNumber,
      headSha: pr.headSha,
      prTitle: pr.title,
      prBody: pr.body,
      linkedIssues,
      learnings,
      files,
      repoRules,
      context,
      annotatedDiff: annotated,
      prompts,
      maxFindings: env.MAX_FINDINGS,
      confidenceThreshold: env.CONFIDENCE_THRESHOLD,
    },
    deps,
  );

  await api.withRetry(() =>
    api.upsertSeance(
      octokit,
      owner,
      repo,
      prNumber,
      scrubSecrets(
        renderSeance({
          owner,
          repo,
          headSha: pr.headSha,
          summary: result.summary,
          kept: result.kept,
          exorcised: result.exorcised,
          skipped: result.skipped,
          lurking: result.lurking,
          verifierFailed: result.verifierFailed,
          possessionAttempt: result.possessionAttempt,
          possessionNote: result.notes.find((n) => n.startsWith("POSSESSION:"))?.slice("POSSESSION:".length).trim(),
          counts: result.counts,
          level: result.haunting.level,
          title: result.haunting.title,
          provider: providerDisplayName(env.LLM_PROVIDER),
        }),
      ),
    ),
  );

  // Inline comments (Step 3): kept findings are all anchored; deduped against
  // both the fingerprint AND the path:line already commented, so a re-worded
  // finding on the same line can't post a second comment on a re-run.
  try {
    const existing = await api.listExistingInline(octokit, owner, repo, prNumber);
    const fresh = result.kept.filter((f) => {
      if (existing.fingerprints.has(f.fingerprint)) return false;
      if (f.position && api.hasNearbyComment(existing.positions, f.position.file, f.position.end_line)) {
        return false;
      }
      return true;
    });
    const anchored = fresh.filter((f) => f.position);
    if (anchored.length > 0) {
      await api.postInlineReview(
        octokit,
        owner,
        repo,
        prNumber,
        pr.headSha,
        anchored.map((f) => ({
          path: f.file,
          body: scrubSecrets(renderInline(f)),
          side: "RIGHT" as const,
          line: f.position!.end_line,
          ...(f.position!.start_line < f.position!.end_line
            ? { start_line: f.position!.start_line, start_side: "RIGHT" as const }
            : {}),
        })),
        scrubSecrets(renderReviewBody(anchored.length)),
      );
    }
  } catch (e) {
    console.warn("inline review skipped", {
      repo: `${owner}/${repo}`,
      pr: prNumber,
      error: e instanceof Error ? e.name : "Error",
    });
  }

  const status = hauntingToStatus(result.haunting.level, result.counts);
  await api.setCommitStatus(octokit, owner, repo, pr.headSha, {
    context: status.context,
    state: status.state,
    description: status.description,
  });

  // Only verifier drops count as "false alarms exorcised" (code-side trims don't).
  const falseAlarms = result.exorcised.filter((e) => e.source !== "trimmed").length;

  const record: HuntRecord = {
    id: huntId ?? `h_${Math.random().toString(36).slice(2, 10)}`,
    repo: `${owner}/${repo}`,
    prNumber,
    prTitle: pr.title,
    prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    hauntingLevel: result.haunting.level,
    counts: result.counts,
    possessionAttempt: result.possessionAttempt,
    exorcised: falseAlarms,
    keptCount: result.kept.length,
    // Dashboard points at the validated position (resolved), not the raw model line.
    topFindings: result.kept.slice(0, 3).map((f) => ({
      severity: f.adjusted_severity,
      title: f.title,
      file: f.file,
      line: f.position?.start_line ?? f.start_line,
    })),
    finishedAt: new Date().toISOString(),
    ...(usage.inputTokens + usage.outputTokens > 0 ? { usage: { ...usage } } : {}),
    costUsd: costOf(usage, modelCfg.provider, modelCfg.model),
    model: modelCfg.model,
  };
  await hunts.save(record);

  const n8n: HuntNotifyPayload = {
    event: "hunt.completed",
    hunt_id: record.id,
    repo: record.repo,
    pr_number: prNumber,
    pr_title: pr.title,
    pr_url: record.prUrl,
    haunting_level: result.haunting.level,
    counts: result.counts,
    top_findings: record.topFindings,
    possession_attempt: result.possessionAttempt,
    false_alarms_exorcised: falseAlarms,
    finished_at: record.finishedAt,
  };
  await notifyHunt(n8n);

  return record;
}

// ---------------------------------------------------------------------------
// Webhook routing: enqueue only, respond fast. synchronize debounced.
// ---------------------------------------------------------------------------
webhooks.on(
  [
    "pull_request.opened",
    "pull_request.reopened",
    "pull_request.ready_for_review",
    "pull_request.synchronize",
  ],
  async ({ id, payload }) => {
    const p = payload as PrWebhookPayload;
    if (!rememberDelivery(id)) return;
    if (isSelfEvent(p) || isSkippedAuthor(p)) return;
    const gate = shouldHunt(p);
    if (!gate.ok) return;
    const target = prTarget(p);
    if (!target) return;

    const prKey = `${target.owner}/${target.repo}#${target.prNumber}`;
    const run = () =>
      void queue.add(async () => {
        // Resolve the connector's token here (not earlier) so a refresh inside the
        // queue still applies to this hunt.
        const userToken = await huntTokenFor(`${target.owner}/${target.repo}`);
        return runHuntForPr(
          target.owner,
          target.repo,
          target.prNumber,
          target.headSha,
          target.installationId,
          userToken,
        ).catch((e) =>
          logFailure(`${target.owner}/${target.repo}`, target.prNumber, e),
        );
      });

    if (p.action === "synchronize") {
      const prev = debounceTimers.get(prKey);
      if (prev) clearTimeout(prev);
      debounceTimers.set(
        prKey,
        setTimeout(() => {
          debounceTimers.delete(prKey);
          run();
        }, HUNT_DEBOUNCE_MS),
      );
    } else {
      run();
    }
  },
);

const SPELLBOOK = `🎃 **Bug Hunter — spellbook**

- \`@${env.BOT_HANDLE} hunt\` (or \`review\`) — hunt this PR now
- \`@${env.BOT_HANDLE} seance\` (or \`summary\`) — regenerate the Séance Report
- \`@${env.BOT_HANDLE} spellbook\` (or \`help\`) — this list

Every hunt runs an AI review + a skeptical verifier pass, detects possession attempts, and posts the 🔮 Séance Report.`;

/** Voice-flavored acknowledgements for learnings (kept short; posted as replies). */
const LEARNING_HELP = `🕯️ **Teach me.** Reply on a review comment with:

- \`@${env.BOT_HANDLE} wrong: <why>\` — stop flagging that (remembered for this repo)
- \`@${env.BOT_HANDLE} learn <rule>\` — add a review rule
- \`@${env.BOT_HANDLE} learnings\` — list what I remember
- \`@${env.BOT_HANDLE} forget <id>\` — drop one`;

/**
 * Persist or manage a reviewer correction found in a comment body.
 * Returns true when the comment was a learning command (and was handled).
 * Callers resolve the comment target (issue comment vs review thread reply).
 */
async function handleLearningCommand(opts: {
  body: string;
  owner: string;
  repo: string;
  trusted: boolean;
  commentUrl?: string;
  reply: (text: string) => Promise<unknown>;
}): Promise<boolean> {
  const cmd = parseLearningCommand(opts.body, env.BOT_HANDLE);
  if (cmd.kind === "none") return false;

  if (!opts.trusted) {
    await opts.reply("🕯️ Only repo collaborators can teach me lessons.").catch(() => {});
    return true;
  }

  const repoKey = `${opts.owner}/${opts.repo}`.toLowerCase();

  if (cmd.kind === "list") {
    const list = await hunts.listLearnings(repoKey, 10);
    if (list.length === 0) {
      await opts.reply(`🕯️ Nothing remembered for \`${repoKey}\` yet.\n\n${LEARNING_HELP}`).catch(() => {});
      return true;
    }
    const lines = list.map((l) => `- \`${l.id}\` — ${l.text}`).join("\n");
    await opts
      .reply(`🧾 **Learnings for this repo**\n\n${lines}\n\nRemove one with \`@${env.BOT_HANDLE} forget <id>\`.`)
      .catch(() => {});
    return true;
  }

  if (cmd.kind === "forget") {
    const ok = await hunts.deleteLearning(repoKey, cmd.id);
    await opts
      .reply(ok ? `🗑️ Forgotten \`${cmd.id}\`.` : `❔ No learning \`${cmd.id}\` on this repo.`)
      .catch(() => {});
    return true;
  }

  const learning: Learning = {
    id: `l_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    repo: repoKey,
    text: cmd.text.slice(0, MAX_LEARNING_CHARS),
    source: "reply",
    ...(opts.commentUrl ? { sourceUrl: opts.commentUrl } : {}),
    createdAt: new Date().toISOString(),
  };
  await hunts.saveLearning(learning);
  await opts
    .reply(`🕯️ Noted — I'll remember that for \`${repoKey}\`.\n\n> ${learning.text}\n\nUndo with \`@${env.BOT_HANDLE} forget ${learning.id}\`.`)
    .catch(() => {});
  return true;
}

// Commands (Step 4): issue_comment on a PR mentioning the bot.
webhooks.on("issue_comment.created", async ({ id, payload }) => {
  const p = payload as PrWebhookPayload;
  if (!rememberDelivery(id)) return;
  if (isSelfEvent(p)) return;
  if (!p.issue?.pull_request) return; // only PR comments

  const body = p.comment?.body ?? "";
  const cmd = parseCommand(body, env.BOT_HANDLE);
  if (cmd.kind === "none") return;

  const full = p.repository?.full_name;
  if (!full) return;
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return;
  const pr = p.issue.number;
  const installationId = p.installation?.id;

  const userToken = await huntTokenFor(`${owner}/${repo}`);
  const octokit = userToken
    ? new Octokit({ auth: userToken })
    : await getOctokit(installationId);

  // Reviewer corrections: teach/forget/list before the hunt commands.
  const handled = await handleLearningCommand({
    body,
    owner,
    repo,
    trusted: isTrustedCommander(p),
    ...(p.comment?.html_url ? { commentUrl: p.comment.html_url } : {}),
    reply: (text) => api.replyComment(octokit, owner, repo, pr, text),
  });
  if (handled) return;

  if (p.comment?.id) await api.addReaction(octokit, owner, repo, p.comment.id, "eyes");

  if (cmd.kind === "hunt" || cmd.kind === "seance") {
    // Spend protection: only collaborators+ can trigger hunts, max one per PR
    // per cooldown window.
    if (!isTrustedCommander(p)) return;
    const key = `${owner}/${repo}#${pr}`;
    if (Date.now() - (commandCooldown.get(key) ?? 0) < COMMAND_COOLDOWN_MS) return;
    commandCooldown.set(key, Date.now());
    if (commandCooldown.size > 1000) commandCooldown.clear();
    void queue.add(() =>
      runHuntForPr(owner, repo, pr, undefined, installationId, userToken).catch((e) =>
        logFailure(`${owner}/${repo}`, pr, e),
      ),
    );
    return;
  }
  // spellbook / unknown
  await api.replyComment(octokit, owner, repo, pr, SPELLBOOK).catch(() => {});
});

// Reviewer corrections can also arrive as replies on an inline review comment
// (the natural place to say "wrong: that's validated upstream").
webhooks.on("pull_request_review_comment.created", async ({ id, payload }) => {
  const p = payload as PrWebhookPayload;
  if (!rememberDelivery(id)) return;
  if (isSelfEvent(p)) return;

  const full = p.repository?.full_name;
  const pr = p.pull_request?.number;
  const commentId = p.comment?.id;
  if (!full || typeof pr !== "number" || typeof commentId !== "number") return;
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return;
  if (p.comment?.in_reply_to_id === undefined && !p.comment?.body) return;
  if (parseLearningCommand(p.comment?.body ?? "", env.BOT_HANDLE).kind === "none") return;

  const userToken = await huntTokenFor(`${owner}/${repo}`);
  const octokit = userToken
    ? new Octokit({ auth: userToken })
    : await getOctokit(p.installation?.id);
  await handleLearningCommand({
    body: p.comment?.body ?? "",
    owner,
    repo,
    trusted: isTrustedCommander(p),
    ...(p.comment?.html_url ? { commentUrl: p.comment.html_url } : {}),
    reply: (text) => api.replyToReviewComment(octokit, owner, repo, pr, commentId, text),
  }).catch((e) => logFailure(`${owner}/${repo}`, pr, e));
});

// GitHub App install lifecycle (Step 4): track which repos are connected.
// These only update the in-memory set — they do not start hunts.
type InstallPayload = {
  action: string;
  installation?: { id: number; account?: { login: string } | null } | null;
  repositories?: Array<{ full_name: string }>;
  repositories_added?: Array<{ full_name: string }>;
  repositories_removed?: Array<{ full_name: string }>;
};

webhooks.on("installation", async ({ id, payload }) => {
  const p = payload as InstallPayload;
  if (!rememberDelivery(id)) return;
  const account = p.installation?.account?.login;
  if (p.action === "created") {
    for (const r of p.repositories ?? []) await addRepo(r.full_name);
    console.log("app installed", { account, repos: (p.repositories ?? []).length });
  } else if (p.action === "deleted") {
    if (account) {
      for (const repo of await listRepos()) {
        if (repo.startsWith(`${account}/`)) removeRepo(repo);
      }
    }
    console.log("app uninstalled", { account });
  }
});

webhooks.on("installation_repositories", async ({ id, payload }) => {
  const p = payload as InstallPayload;
  if (!rememberDelivery(id)) return;
  for (const r of p.repositories_added ?? []) await addRepo(r.full_name);
  for (const r of p.repositories_removed ?? []) await removeRepo(r.full_name);
  console.log("app repositories changed", {
    action: p.action,
    added: (p.repositories_added ?? []).length,
    removed: (p.repositories_removed ?? []).length,
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const repoUrl = env.LANDING_REPO_URL || "https://github.com/dk3yyyy/bug-hunter";

// "Connect a repo": in App mode this is the GitHub App install page; otherwise
// it's the hosted app's /connect (APP_URL) or this origin's /connect. The rule
// lives in connectUrlFor() so PAT/App/static deployments can't drift apart.
const connectUrl = connectUrlFor({
  mode: env.GITHUB_MODE,
  appSlug: env.GITHUB_APP_SLUG,
  appUrl: env.APP_URL,
});
app.get("/", (c) => c.html(renderLanding({ connectUrl, repoUrl })));

// --- "Connect with GitHub" login flow ---------------------------------------
// Step 1: bounce to GitHub with a CSRF state stored in a short-lived cookie.
app.get("/auth/github", (c) => {
  if (!oauthEnabled()) {
    return c.text(
      "GitHub login is not configured on this server. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
      503,
    );
  }
  const redirectUri = redirectUriFor();
  if (!redirectUri.startsWith("http")) {
    return c.text(
      "GitHub login needs a public URL. Set PUBLIC_URL (or GITHUB_OAUTH_REDIRECT_URI) so the callback can be built.",
      503,
    );
  }
  const state = randomBytes(16).toString("hex");
  setCookie(c, STATE_COOKIE, state, { ...cookieOptions(), maxAge: 600 });
  return c.redirect(
    buildAuthorizeUrl({ clientId: env.GITHUB_OAUTH_CLIENT_ID.trim(), redirectUri, state }),
  );
});

// Step 2: validate state, swap the code for a token, seal a session cookie.
app.get("/auth/github/callback", async (c) => {
  if (!oauthEnabled()) return c.redirect("/connect?login=disabled");

  const expected = getCookie(c, STATE_COOKIE) ?? "";
  const given = c.req.query("state") ?? "";
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  if (!expected || !given || expected !== given) return c.redirect("/connect?login=state");

  if (c.req.query("error")) return c.redirect("/connect?login=cancelled");
  const code = c.req.query("code") ?? "";
  if (!code) return c.redirect("/connect?login=code");

  const result = await exchangeCode(
    {
      clientId: env.GITHUB_OAUTH_CLIENT_ID.trim(),
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET.trim(),
      redirectUri: redirectUriFor(),
    },
    code,
  );
  if (!result.ok) {
    console.error("github login failed:", result.reason);
    return c.redirect("/connect?login=exchange");
  }

  const user = await fetchUser(result.accessToken);
  if (!user) return c.redirect("/connect?login=user");

  const allow = allowedLogins();
  if (allow.size > 0 && !allow.has(user.login.toLowerCase())) {
    return c.redirect("/connect?login=denied");
  }

  setCookie(
    c,
    SESSION_COOKIE,
    sealSession(
      {
        login: user.login.toLowerCase(),
        token: result.accessToken,
        exp: Date.now() + SESSION_TTL_MS,
        ...(user.name ? { name: user.name } : {}),
        ...(user.avatar ? { avatar: user.avatar } : {}),
        // OAuth Apps created since Aug 2026 default to 8-hour access tokens plus a
        // 6-month refresh token; record both so the session can renew itself.
        ...(result.expiresIn ? { expiresAt: Date.now() + result.expiresIn * 1000 } : {}),
        ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
      },
      sessionKey(),
    ),
    { ...cookieOptions(), maxAge: Math.floor(SESSION_TTL_MS / 1000) },
  );
  return c.redirect("/connect?login=ok");
});

app.get("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/connect?login=out");
});

/** Small JSON probe so the page script can tell whether it has a session. */
app.get("/api/me", (c) => {
  const session = currentSession(c);
  if (!session) return c.json({ logged_in: false, oauth: oauthEnabled() }, 401);
  return c.json({
    logged_in: true,
    login: session.login,
    ...(session.name ? { name: session.name } : {}),
    ...(session.avatar ? { avatar: session.avatar } : {}),
    scopes: [...OAUTH_SCOPES].join(" "),
  });
});

app.get("/connect", (c) => {
  const session = currentSession(c);
  return c.html(
    renderConnect({
      publicUrl: env.PUBLIC_URL,
      botHandle: env.BOT_HANDLE,
      mode: env.GITHUB_MODE,
      installUrl: env.GITHUB_MODE === "app" ? installUrl(env.GITHUB_APP_SLUG) : undefined,
      oauthEnabled: oauthEnabled(),
      session: session ? { login: session.login, name: session.name, avatar: session.avatar } : null,
      loginNotice: LOGIN_NOTICES[c.req.query("login") ?? ""] ?? "",
    }),
  );
});

// One-click install redirect (Step 4): app mode → GitHub install page, pat → /connect.
app.get("/summon", (c) => {
  if (env.GITHUB_MODE === "app") return c.redirect(installUrl(env.GITHUB_APP_SLUG));
  return c.redirect("/connect");
});

app.get("/health", async (c) => {
  // `repos` = how many repos have a remembered user (persisted when DATABASE_URL is set).
  const repos = await repoConnectionCount();
  return c.json({ ok: true, queued: queue.size, repos });
});

app.post("/webhooks/github", async (c) => {
  const raw = await c.req.text();
  const id = c.req.header("x-github-delivery") ?? "";
  const name = c.req.header("x-github-event") ?? "";
  const signature = c.req.header("x-hub-signature-256") ?? "";
  try {
    await webhooks.verifyAndReceive({ id, name, signature, payload: raw } as never);
    return c.text("ok");
  } catch {
    return c.text("bad signature", 401);
  }
});

// Manual trigger: POST /api/hunt
//   { "pr_url": "https://github.com/o/r/pull/N" } or { "owner", "repo", "pr" }
app.post("/api/hunt", async (c) => {
  if (!isAuthorized(c)) {
    return c.json(
      {
        error: oauthEnabled()
          ? "Sign in with GitHub first, then hunt."
          : "unauthorized — send the X-BugHunter-Secret header",
        login_url: oauthEnabled() ? "/auth/github" : null,
        hint: oauthEnabled()
          ? "The button uses your GitHub session; sign in once and it works."
          : undefined,
      },
      401,
    );
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "bad body" }, 400);

  let owner = "";
  let repo = "";
  let prNumber = 0;
  if (typeof body.pr_url === "string") {
    const m = body.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return c.json({ error: "could not parse pr_url" }, 400);
    [, owner, repo] = m;
    prNumber = Number(m[3]);
  } else if (typeof body.owner === "string" && typeof body.repo === "string" && typeof body.pr === "number") {
    owner = body.owner;
    repo = body.repo;
    prNumber = body.pr;
  } else {
    return c.json({ error: "need { pr_url } or { owner, repo, pr }" }, 400);
  }

  // App mode has no PAT. Webhooks carry installation.id, but this manual trigger
  // has no payload to read it from — resolve it from the repo (otherwise every
  // manual hunt 500s with "requires an installation id").
  let installationId: number | undefined;
  if (env.GITHUB_MODE === "app") {
    try {
      installationId = await installationIdForRepo(owner, repo);
    } catch {
      return c.json(
        {
          error:
            `Bug Hunter's GitHub App isn't installed on ${owner}/${repo}, ` +
            "or GITHUB_APP_ID / GITHUB_PRIVATE_KEY_PATH is wrong. Install the app first.",
        },
        400,
      );
    }
  }

  // A signed-in user hunts as themselves; scripts with the shared secret use the
  // server token as before.
  const session = currentSession(c);
  const userToken =
    env.GITHUB_MODE === "pat" && session ? await tokenForSession(c, session) : null;

  // Async mode: return a handle immediately and run in the background, so a slow
  // hunt (3 LLM calls, ~2 min) can't be cut off by a proxy/platform timeout.
  if (body.async === true) {
    const huntId = `h_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    void runHuntForPr(owner, repo, prNumber, undefined, installationId, userToken, huntId).catch(
      (e) => logFailure(`${owner}/${repo}`, prNumber, e),
    );
    return c.json(
      { id: huntId, status: "running", repo: `${owner}/${repo}`, prNumber },
      202,
    );
  }

  try {
    const record = await runHuntForPr(
      owner,
      repo,
      prNumber,
      undefined,
      installationId,
      userToken,
    );
    if (!record) {
      // runHuntForPr returns null for two very different reasons. Telling someone
      // their PR is "closed, draft, not found, OR already running" is unactionable;
      // say which one it is.
      if (runningHunts.has(`${owner}/${repo}#${prNumber}`)) {
        return c.json(
          {
            error: `A hunt is already running for ${owner}/${repo}#${prNumber}. Wait for it to finish — the result is posted on the PR.`,
            code: "HUNT_IN_PROGRESS",
          },
          409,
        );
      }
      return c.json(
        {
          error: `Could not hunt ${owner}/${repo}#${prNumber}: the PR is closed, is a draft, or ${env.GITHUB_MODE === "app" ? "the GitHub App is not installed on it" : "the token cannot see it"}.`,
          code: "PR_NOT_HUNTABLE",
        },
        404,
      );
    }
    return c.json(record);
  } catch (e) {
    if (e instanceof HuntBudgetError) {
      return c.json(
        {
          error: e.message,
          code: "BUDGET_REACHED",
          spendUsd: Number(e.spendUsd.toFixed(4)),
          capUsd: e.capUsd,
        },
        402,
      );
    }
    if (e instanceof HuntRateLimitedError) {
      return c.json(
        { error: "Rate limited: max 10 hunts per PR per hour.", code: "RATE_LIMITED" },
        429,
      );
    }
    logFailure(`${owner}/${repo}`, prNumber, e);
    // Return the actual, scrubbed cause. "{"error":"Error"}" told the user nothing
    // and hid things like "Insufficient account funds" from the model provider.
    const detail = huntErrorDetail(e);
    return c.json({ error: detail.message, code: detail.code, hint: detail.hint }, 500);
  }
});

// Auto-connect (Option B): create a webhook on a repo using the PAT.
app.post("/api/connect", async (c) => {
  if (!isAuthorized(c)) {
    // Tell the page how to fix it: sign in, rather than "unauthorized" and a shrug.
    return c.json(
      {
        error: oauthEnabled()
          ? "Sign in with GitHub first, then connect the repo."
          : "unauthorized — send the X-BugHunter-Secret header",
        login_url: oauthEnabled() ? "/auth/github" : null,
      },
      401,
    );
  }

  // Prefer the signed-in user's token: GitHub itself then decides whether they may
  // manage hooks on this repo, so being logged in never becomes a privilege
  // escalation over whatever the server-wide PAT happens to reach. Secret-based
  // callers (scripts, n8n) keep using the server PAT as before.
  const session = currentSession(c);

  // App mode connects repos by installation. GitHub Apps cannot create repo
  // webhooks with an installation token, so send people to the install page.
  if (env.GITHUB_MODE === "app") {
    return c.json(
      {
        error: "GITHUB_MODE=app connects repos through GitHub's install page — no webhook needed.",
        install_url: installUrl(env.GITHUB_APP_SLUG),
      },
      400,
    );
  }

  const body = await c.req.json().catch(() => null);
  const full = typeof body?.repo === "string" ? body.repo.trim() : "";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return c.json({ error: "need { repo: 'owner/name' }" }, 400);

  // PUBLIC_URL is the documented setting; `public_url` lets a tunnel/deployed
  // user connect without editing .env and restarting. GitHub must be able to
  // reach it, so localhost/private addresses are rejected with a clear reason.
  const given = typeof body?.public_url === "string" ? body.public_url : "";
  const base = given.trim() || env.PUBLIC_URL;
  if (!base) {
    return c.json(
      {
        error:
          "PUBLIC_URL not set — pass public_url (e.g. your ngrok/smee URL) or set PUBLIC_URL in .env",
      },
      400,
    );
  }
  const target = webhookUrlFor(base);
  if (!target.ok) return c.json({ error: target.reason }, 400);

  const webhookUrl = target.url;
  try {
    const connectSession = currentSession(c);
    const connectToken =
      env.GITHUB_MODE === "pat" && connectSession
        ? await tokenForSession(c, connectSession)
        : null;
    const hook = await api.ensureRepoWebhook(
      connectToken ? new Octokit({ auth: connectToken }) : await getOctokit(),
      owner,
      repo,
      webhookUrl,
      env.GITHUB_WEBHOOK_SECRET,
    );
    // Remember who authorised this repo so its hunts run as them, not as the
    // operator. Lost on restart (in-memory), which falls back to the server token.
    if (connectSession && connectToken) {
      await rememberRepoConnection(
        full,
        {
          login: connectSession.login,
          token: connectToken,
          ...(connectSession.expiresAt ? { expiresAt: connectSession.expiresAt } : {}),
          ...(connectSession.refreshToken ? { refreshToken: connectSession.refreshToken } : {}),
        },
        sessionKey(),
      );
    }
    return c.json({
      ok: true,
      repo: full,
      webhook_id: hook.id,
      webhook_url: webhookUrl,
      created: hook.created,
    });
  } catch (e) {
    const status = githubStatus(e);
    return c.json(
      { error: connectErrorMessage(e) },
      status === 403 ? 403 : status === 404 ? 404 : 502,
    );
  }
});

app.get("/api/hunts", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json(await hunts.list(50));
});
app.get("/api/hunts/:id", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "unauthorized" }, 401);
  const rec = await hunts.get(c.req.param("id"));
  return rec ? c.json(rec) : c.json({ error: "not found" }, 404);
});

// Reviewer corrections ("learnings"), scoped per repo.
app.get("/api/learnings", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "unauthorized" }, 401);
  const repo = (c.req.query("repo") ?? "").trim().toLowerCase();
  if (!repo) return c.json({ error: "need ?repo=owner/repo" }, 400);
  return c.json(await hunts.listLearnings(repo, 50));
});
app.delete("/api/learnings/:id", async (c) => {
  if (!isAuthorized(c)) return c.json({ error: "unauthorized" }, 401);
  const repo = (c.req.query("repo") ?? "").trim().toLowerCase();
  if (!repo) return c.json({ error: "need ?repo=owner/repo" }, 400);
  return c.json({ ok: await hunts.deleteLearning(repo, c.req.param("id")) });
});

// Results dashboard (Postgres when DATABASE_URL is set, else in-memory).
app.get("/dashboard", async (c) => {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthSpendUsd = await hunts.spendSince(monthStart.toISOString());
  return c.html(
    renderDashboard(await hunts.list(50), await hunts.recentLearnings(20), {
      monthSpendUsd,
      capUsd: env.MONTHLY_COST_CAP_USD,
    }),
  );
});
app.get("/summoned", async (c) =>
  c.html(renderSummoned(await listRepos(), c.req.query("installation_id"))),
);

// 404: HTML for pages, JSON for API clients.
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
  return c.html(renderNotFound(), 404);
});

// Only start the server when this file is run directly (not when imported by tests).
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`🎃 Bug Hunter listening on http://localhost:${info.port}`);
  });
}
