// Pure webhook event-filtering helpers (SPEC §8). No octokit, no env — fully unit-testable.

export interface PrWebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    draft?: boolean;
    state?: string;
    head?: { sha?: string };
    base?: { ref?: string };
  };
  repository?: { full_name?: string; owner?: { login?: string }; name?: string };
  sender?: { type?: string; login?: string };
  comment?: { id?: number; body?: string; author_association?: string };
  issue?: { number: number; pull_request?: unknown };
}

const SELF_MARKER = /<!--\s*bughunter:/i;
const SKIPPED_AUTHORS = /^(dependabot|renovate)(\[bot\])?$/i;

/** Bot / own-comment / marker self-loop guard. */
export function isSelfEvent(p: PrWebhookPayload): boolean {
  if (p.sender?.type === "Bot") return true;
  if (p.sender?.login && p.sender.login.endsWith("[bot]")) return true;
  const body = p.comment?.body ?? "";
  if (body && SELF_MARKER.test(body)) return true;
  return false;
}

/** Skip dependabot / renovate PRs. */
export function isSkippedAuthor(p: PrWebhookPayload): boolean {
  const login = p.sender?.login ?? "";
  return SKIPPED_AUTHORS.test(login);
}

/**
 * Only repo collaborators may spend hunts via @bot commands. GitHub sends
 * `comment.author_association`; missing/outsider association fails closed.
 */
const COMMAND_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isTrustedCommander(p: PrWebhookPayload): boolean {
  const assoc = p.comment?.author_association?.toUpperCase() ?? "";
  return COMMAND_ROLES.has(assoc);
}

export function shouldHunt(p: PrWebhookPayload): { ok: boolean; reason?: string } {
  const pr = p.pull_request;
  if (!pr) return { ok: false, reason: "no-pull-request" };
  if (pr.state && pr.state !== "open") return { ok: false, reason: "state" };
  if (pr.draft) return { ok: false, reason: "draft" };
  return { ok: true };
}

export function prTarget(
  p: PrWebhookPayload,
): { owner: string; repo: string; prNumber: number; headSha?: string } | null {
  const full = p.repository?.full_name;
  const pr = p.pull_request?.number;
  if (typeof full !== "string" || typeof pr !== "number") return null;
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return { owner, repo, prNumber: pr, headSha: p.pull_request?.head?.sha };
}

/** Step 4: does an issue_comment mention the bot with a known command? */
export function parseCommand(
  body: string,
  handle: string,
): { kind: "hunt" | "seance" | "spellbook" | "unknown" | "none" } {
  const mention = new RegExp(`@${handle}\\b`, "i");
  if (!mention.test(body)) return { kind: "none" };
  const after = body.split(mention)[1] ?? "";
  const cmd = after.trim().toLowerCase().split(/\s+/)[0] ?? "";
  switch (cmd) {
    case "hunt":
    case "review":
      return { kind: "hunt" };
    case "seance":
    case "summary":
      return { kind: "seance" };
    case "spellbook":
    case "help":
      return { kind: "spellbook" };
    default:
      return { kind: "unknown" };
  }
}
