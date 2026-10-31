// Bug Hunter server — Hono app, webhook ingress, in-process queue (SPEC §4, §8, §11).
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Webhooks } from "@octokit/webhooks";
import PQueue from "p-queue";
import { env } from "./env";
import { getOctokit } from "./github/client";
import * as api from "./github/api";
import {
  isSelfEvent,
  isSkippedAuthor,
  prTarget,
  shouldHunt,
  type PrWebhookPayload,
} from "./github/webhooks";
import { runHunt, type HuntDeps } from "./hunt/pipeline";
import { buildContext } from "./hunt/context";
import { annotateDiff } from "./diff/annotate";
import { renderSeance } from "./render/seance";
import { renderInline } from "./render/inline";
import { hauntingToStatus } from "./render/status";
import { scrubSecrets } from "./security";
import { notifyHunt, type HuntNotifyPayload } from "./n8n";
import { getModel } from "./llm/models";
import { generateStructured } from "./llm/structured";
import { loadPrompt } from "./prompts";
import { ReviewOutput, Verdict, SeanceOutput, type HuntCounts, type HauntingLevel } from "./types";

const app = new Hono();
const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
const queue = new PQueue({ concurrency: 2 });

const seenDeliveries = new Set<string>();

export interface HuntRecord {
  id: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  hauntingLevel: HauntingLevel;
  counts: HuntCounts;
  possessionAttempt: boolean;
  exorcised: number;
  keptCount: number;
  finishedAt: string;
}

const hunts = new Map<string, HuntRecord>();

function logFailure(repo: string, pr: number, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error("hunt failed", { repo, pr, error: name });
}

async function readGuidelines(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  baseRef: string,
): Promise<string> {
  const parts: string[] = [];
  for (const path of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    const content = await api.getFileContent(octokit, owner, repo, path, baseRef);
    if (content) parts.push(`### ${path}\n${content.slice(0, 2000)}`);
  }
  return parts.join("\n\n");
}

async function huntPr(payload: PrWebhookPayload): Promise<void> {
  const target = prTarget(payload);
  if (!target) return;

  const octokit = getOctokit();

  // Re-fetch current state; drop closed/draft/stale deliveries before spending.
  const pr = await api.getPr(octokit, target.owner, target.repo, target.prNumber);
  if (pr.state !== "open" || pr.draft) return;
  if (target.headSha && pr.headSha !== target.headSha) return;

  await api.setCommitStatus(octokit, target.owner, target.repo, pr.headSha, {
    context: "Bug Hunter 🎃",
    state: "pending",
    description: "🔦 The hunt has begun…",
  });

  const files = await api.listFiles(octokit, target.owner, target.repo, target.prNumber);
  const repoRules = await readGuidelines(octokit, target.owner, target.repo, pr.baseRef);
  const annotated = annotateDiff(files.filter((f) => !f.isBinary && !!f.patch)).text;
  const context = await buildContext(octokit, target.owner, target.repo, pr.headSha, files);

  const prompts = {
    system: loadPrompt("review.system"),
    user: loadPrompt("review.user"),
    verify: loadPrompt("verify"),
    seance: loadPrompt("seance"),
  };

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
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
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

  const seanceBody = scrubSecrets(
    renderSeance({
      owner: target.owner,
      repo: target.repo,
      headSha: pr.headSha,
      summary: result.summary,
      kept: result.kept,
      exorcised: result.exorcised,
      skipped: result.skipped,
      lurking: result.kept.filter((f) => !f.position),
      possessionAttempt: result.possessionAttempt,
      counts: result.counts,
      level: result.haunting.level,
      title: result.haunting.title,
    }),
  );

  await api.upsertSeance(octokit, target.owner, target.repo, target.prNumber, seanceBody);

  // Inline comments (Step 3): only findings anchored to a changed line, deduped
  // against already-posted fingerprints so a re-run doesn't duplicate threads.
  try {
    const existing = await api.listExistingFingerprints(
      octokit,
      target.owner,
      target.repo,
      target.prNumber,
    );
    const fresh = result.kept.filter((f) => !existing.has(f.fingerprint));
    const anchored = fresh.filter((f) => f.position);
    if (anchored.length > 0) {
      await api.postInlineReview(
        octokit,
        target.owner,
        target.repo,
        target.prNumber,
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
      );
    }
  } catch (e) {
    console.warn("inline review skipped", {
      repo: `${target.owner}/${target.repo}`,
      pr: target.prNumber,
      error: e instanceof Error ? e.name : "Error",
    });
  }

  // Final status = haunting level (Step 3).
  const status = hauntingToStatus(result.haunting.level, result.counts);
  await api.setCommitStatus(octokit, target.owner, target.repo, pr.headSha, {
    context: status.context,
    state: status.state,
    description: status.description,
  });

  const record: HuntRecord = {
    id: `h_${Math.random().toString(36).slice(2, 10)}`,
    repo: `${target.owner}/${target.repo}`,
    prNumber: target.prNumber,
    prTitle: pr.title,
    prUrl: `https://github.com/${target.owner}/${target.repo}/pull/${target.prNumber}`,
    hauntingLevel: result.haunting.level,
    counts: result.counts,
    possessionAttempt: result.possessionAttempt,
    exorcised: result.exorcised.length,
    keptCount: result.kept.length,
    finishedAt: new Date().toISOString(),
  };
  hunts.set(record.id, record);

  const n8n: HuntNotifyPayload = {
    event: "hunt.completed",
    hunt_id: record.id,
    repo: record.repo,
    pr_number: target.prNumber,
    pr_title: pr.title,
    pr_url: record.prUrl,
    haunting_level: result.haunting.level,
    counts: result.counts,
    top_findings: result.kept.slice(0, 3).map((f) => ({
      severity: f.adjusted_severity,
      title: f.title,
      file: f.file,
      line: f.start_line,
    })),
    possession_attempt: result.possessionAttempt,
    false_alarms_exorcised: result.exorcised.length,
    finished_at: record.finishedAt,
  };
  await notifyHunt(n8n);
}

// Event routing: enqueue only; respond fast (SPEC §8). synchronize is debounced 60s per PR.
const HUNT_DEBOUNCE_MS = 60_000;
const debounceTimers = new Map<string, NodeJS.Timeout>();

webhooks.on(
  [
    "pull_request.opened",
    "pull_request.reopened",
    "pull_request.ready_for_review",
    "pull_request.synchronize",
  ],
  async ({ id, payload }) => {
    const p = payload as PrWebhookPayload;
    if (seenDeliveries.has(id)) return;
    seenDeliveries.add(id);
    if (isSelfEvent(p) || isSkippedAuthor(p)) return;
    const gate = shouldHunt(p);
    if (!gate.ok) return;
    const target = prTarget(p);
    if (!target) return;

    const prKey = `${target.owner}/${target.repo}#${target.prNumber}`;
    const run = () =>
      void queue.add(() =>
        huntPr(p).catch((e) =>
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

app.get("/", (c) => c.text("🎃 Bug Hunter is running. Every PR is haunted."));
app.get("/health", (c) => c.json({ ok: true, queued: queue.size }));

app.post("/webhooks/github", async (c) => {
  const raw = await c.req.text();
  const id = c.req.header("x-github-delivery") ?? "";
  const name = c.req.header("x-github-event") ?? "";
  const signature = c.req.header("x-hub-signature-256") ?? "";
  try {
    await webhooks.verifyAndReceive({
      id,
      name,
      signature,
      payload: raw,
    } as never);
    return c.text("ok");
  } catch {
    return c.text("bad signature", 401);
  }
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`🎃 Bug Hunter listening on http://localhost:${info.port}`);
});
