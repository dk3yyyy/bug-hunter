// Bug Hunter server — Hono app, webhook ingress, manual trigger, in-process queue.
// (SPEC §4, §8, §11, §16.4)
import { serve } from "@hono/node-server";
import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { Webhooks } from "@octokit/webhooks";
import PQueue from "p-queue";
import { env } from "./env";
import { getOctokit } from "./github/client";
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
import { BoundedSet, HuntRateLimiter, planBudget, trimContext } from "./hunt/budget";
import { annotateDiff } from "./diff/annotate";
import { renderSeance, escapeHtml } from "./render/seance";
import { renderInline, renderReviewBody } from "./render/inline";
import { errorStatus, hauntingToStatus, pendingStatus } from "./render/status";
import { renderLanding, renderDashboard, renderSummoned } from "./render/pages";
import { scrubSecrets } from "./security";
import { notifyHunt, type HuntNotifyPayload } from "./n8n";
import { getModel } from "./llm/models";
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
const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
const queue = new PQueue({ concurrency: 2 });

const seenDeliveries = new BoundedSet(5000);
const rateLimiter = new HuntRateLimiter(10, 60 * 60 * 1000); // SPEC §17: max 10 hunts per PR per hour

/** Thrown when a PR has used up its hunts for the hour (SPEC §17). */
export class HuntRateLimitedError extends Error {
  override name = "HuntRateLimitedError";
}
const debounceTimers = new Map<string, NodeJS.Timeout>();
const HUNT_DEBOUNCE_MS = 60_000;
// One in-flight hunt per PR (duplicate runs = duplicate comments + spend).
const runningHunts = new Set<string>();
// hunts is append-only: cap it so a long-lived server cannot grow without bound.
const MAX_HUNTS = 200;

function rememberDelivery(id: string): boolean {
  if (seenDeliveries.has(id)) return false;
  seenDeliveries.add(id);
  return true;
}
// Per-PR cooldown for @bot command hunts (spend protection).
const commandCooldown = new Map<string, number>();
const COMMAND_COOLDOWN_MS = 5 * 60_000;

const hunts = new Map<string, HuntRecord>();

function logFailure(repo: string, pr: number, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  if (name === "HuntRateLimitedError") {
    console.warn("hunt skipped: rate limited", { repo, pr });
    return;
  }
  console.error("hunt failed", { repo, pr, error: name });
}

function authSecret(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const given = c.req.header("x-bughunter-secret") ?? "";
  if (given.length === 0) return false;
  // Constant-time compare on hashes so secret length isn't leaked by timing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(env.N8N_SHARED_SECRET).digest();
  return timingSafeEqual(a, b);
}

async function readGuidelines(
  octokit: ReturnType<typeof getOctokit>,
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
): Promise<HuntRecord | null> {
  // Per-PR mutual exclusion: a debounced synchronize hunt and a manual @bot
  // hunt must not run concurrently (duplicate inline comments + double spend).
  const huntKey = `${owner}/${repo}#${prNumber}`;
  if (runningHunts.has(huntKey)) return null;
  runningHunts.add(huntKey);
  try {
    return await runHuntForPrInner(owner, repo, prNumber, expectedHeadSha);
  } finally {
    runningHunts.delete(huntKey);
  }
}

async function runHuntForPrInner(
  owner: string,
  repo: string,
  prNumber: number,
  expectedHeadSha?: string,
): Promise<HuntRecord | null> {
  const octokit = getOctokit();

  // Re-fetch current state; drop closed/draft/stale before spending.
  const pr = await api.getPr(octokit, owner, repo, prNumber);
  if (pr.state !== "open" || pr.draft) return null;
  // Stale event (SPEC §8): the head moved since this webhook fired. The newer
  // push has its own (debounced) synchronize event, so skip this one.
  if (expectedHeadSha && expectedHeadSha !== pr.headSha) return null;

  if (!rateLimiter.tryAcquire(`${owner}/${repo}#${prNumber}`)) {
    throw new HuntRateLimitedError("max hunts per PR per hour reached");
  }

  const pending = pendingStatus();
  await api.setCommitStatus(octokit, owner, repo, pr.headSha, {
    context: pending.context,
    state: "pending",
    description: pending.description,
  });

  try {
    return await huntOpenPr(octokit, owner, repo, prNumber, pr);
  } catch (e) {
    // Never leave the PR stuck on "pending" (status error copy comes from voice.json).
    const err = errorStatus();
    await api.setCommitStatus(octokit, owner, repo, pr.headSha, err);
    throw e;
  }
}

async function huntOpenPr(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  pr: Awaited<ReturnType<typeof api.getPr>>,
): Promise<HuntRecord> {
  const files = await api.listFiles(octokit, owner, repo, prNumber);
  const repoRules = await readGuidelines(octokit, owner, repo, pr.baseRef);

  // Only hunted files reach the model: lockfiles, generated, vendored, minified,
  // binary and over-limit files are filtered out here (SPEC §11 step 2). The
  // pipeline still receives every file so it can list skips in the Graveyard.
  const { kept: huntedFiles } = filterFiles(files);

  // Input budget (~30k tokens, SPEC §11 step 5): the diff gets priority,
  // context is trimmed to whatever is left.
  const fullDiff = annotateDiff(huntedFiles).text;
  const { diffMaxChars, contextMaxChars } = planBudget(fullDiff.length);
  const annotated = annotateDiff(huntedFiles, { maxChars: diffMaxChars }).text;
  const context = trimContext(
    await buildContext(octokit, owner, repo, pr.headSha, huntedFiles),
    contextMaxChars,
  );

  const prompts = PROMPTS;

  const deps: HuntDeps = {
    review: ({ system, user }) =>
      generateStructured({ model: getModel("review"), schema: ReviewOutput, system, prompt: user }),
    verify: ({ system, user }) =>
      generateStructured({ model: getModel("verify"), schema: Verdict, system, prompt: user }),
    seance: ({ system, user }) =>
      generateStructured({ model: getModel("fast"), schema: SeanceOutput, system, prompt: user }),
  };

  const result = await runHunt(
    {
      owner,
      repo,
      prNumber,
      headSha: pr.headSha,
      prTitle: pr.title,
      prBody: pr.body,
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

  await api.upsertSeance(
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
  );

  // Inline comments (Step 3): kept findings are all anchored; fingerprint-deduped.
  try {
    const existing = await api.listExistingFingerprints(octokit, owner, repo, prNumber);
    const fresh = result.kept.filter((f) => !existing.has(f.fingerprint));
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
    id: `h_${Math.random().toString(36).slice(2, 10)}`,
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
  };
  hunts.set(record.id, record);
  if (hunts.size > MAX_HUNTS) {
    for (const key of hunts.keys()) {
      if (hunts.size <= MAX_HUNTS) break;
      hunts.delete(key);
    }
  }

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
// Webhook routing (SPEC §8): enqueue only, respond fast. synchronize debounced.
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
      void queue.add(() =>
        runHuntForPr(target.owner, target.repo, target.prNumber, target.headSha).catch((e) =>
          logFailure(`${target.owner}/${target.repo}`, target.prNumber, e),
        ),
      );

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

  const octokit = getOctokit();
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
      runHuntForPr(owner, repo, pr).catch((e) => logFailure(`${owner}/${repo}`, pr, e)),
    );
    return;
  }
  // spellbook / unknown
  await api.replyComment(octokit, owner, repo, pr, SPELLBOOK).catch(() => {});
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/", (c) => c.html(renderLanding(env.LANDING_REPO_URL)));
app.get("/health", (c) => c.json({ ok: true, queued: queue.size }));

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

// Manual trigger (SPEC §16.4 Workflow 3 + instant testing): POST /api/hunt
//   { "pr_url": "https://github.com/o/r/pull/N" } or { "owner", "repo", "pr" }
app.post("/api/hunt", async (c) => {
  if (!authSecret(c)) return c.json({ error: "unauthorized" }, 401);
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

  try {
    const record = await runHuntForPr(owner, repo, prNumber);
    if (!record)
      return c.json({ error: "PR is closed, draft, not found, or a hunt is already running" }, 404);
    return c.json(record);
  } catch (e) {
    if (e instanceof HuntRateLimitedError) {
      return c.json({ error: "rate limited: max 10 hunts per PR per hour" }, 429);
    }
    logFailure(`${owner}/${repo}`, prNumber, e);
    return c.json({ error: e instanceof Error ? e.name : "hunt failed" }, 500);
  }
});

// Auto-connect (Option B): create a webhook on a repo using the PAT.
app.post("/api/connect", async (c) => {
  if (!authSecret(c)) return c.json({ error: "unauthorized" }, 401);
  if (!env.PUBLIC_URL) {
    return c.json({ error: "PUBLIC_URL not set — set it to this server's public URL" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const full = typeof body?.repo === "string" ? body.repo : "";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return c.json({ error: "need { repo: 'owner/name' }" }, 400);
  try {
    const id = await api.createRepoWebhook(
      getOctokit(),
      owner,
      repo,
      `${env.PUBLIC_URL.replace(/\/$/, "")}/webhooks/github`,
      env.GITHUB_WEBHOOK_SECRET,
    );
    return c.json({ ok: true, webhook_id: id, repo: full });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.name : "connect failed" }, 500);
  }
});

app.get("/api/hunts", (c) => {
  if (!authSecret(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json([...hunts.values()].slice(-50).reverse());
});
app.get("/api/hunts/:id", (c) => {
  if (!authSecret(c)) return c.json({ error: "unauthorized" }, 401);
  const rec = hunts.get(c.req.param("id"));
  return rec ? c.json(rec) : c.json({ error: "not found" }, 404);
});

// In-memory results dashboard (Step 4).
app.get("/dashboard", (c) => c.html(renderDashboard([...hunts.values()])));
app.get("/summoned", (c) => c.html(renderSummoned()));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`🎃 Bug Hunter listening on http://localhost:${info.port}`);
});
