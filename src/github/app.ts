// GitHub App auth + install-flow helpers.
// The App client is built lazily and cached; the private key comes from the inline
// GITHUB_PRIVATE_KEY env var when set (Render/Railway/Fly secrets), otherwise from
// the PEM file pointed at by GITHUB_PRIVATE_KEY_PATH. Key content must never appear
// in logs or error messages.
import { readFileSync } from "node:fs";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { env } from "../env";
import { store } from "../store";

/**
 * The "Connect a repo" install URL for a GitHub App (CodeRabbit/Greptile style).
 * Pure so it can be unit-tested without touching the environment or network.
 */
export function installUrl(slug: string, state?: string): string {
  const base = `https://github.com/apps/${slug}/installations/new`;
  return state === undefined ? base : `${base}?state=${encodeURIComponent(state)}`;
}

/**
 * Where the landing's "Connect a repo" button should go.
 *
 * - App mode: GitHub's install page — one click, no secret, works from a static
 *   page (the webhooks then arrive at this server).
 * - PAT mode + APP_URL: that deployment's /connect page. This is what lets the
 *   GitHub Pages landing point at a hosted instance instead of dropping people
 *   on the README.
 * - PAT mode, no APP_URL: this server's own /connect (same origin).
 *
 * Pure so the routing rule is unit-tested instead of guessed at.
 */
export function connectUrlFor(opts: {
  mode: "pat" | "app";
  appSlug: string;
  appUrl: string;
}): string {
  if (opts.mode === "app") return installUrl(opts.appSlug);
  const base = opts.appUrl.trim().replace(/\/+$/, "");
  return base ? `${base}/connect` : "/connect";
}

/**
 * Resolve the installation that can see owner/repo. In App mode a webhook carries
 * `installation.id`, but the manual trigger (`POST /api/hunt`) has no payload to
 * read it from — without this, `getOctokit()` would throw and every manual hunt
 * would 500.
 */
export async function installationIdForRepo(owner: string, repo: string): Promise<number> {
  const { data } = await getApp().octokit.rest.apps.getRepoInstallation({ owner, repo });
  return data.id;
}

function makeApp(privateKey: string) {
  return new App({ appId: env.GITHUB_APP_ID, privateKey, Octokit });
}

let appInstance: ReturnType<typeof makeApp> | null = null;

/**
 * Lazily build (and cache) the GitHub App client. Throws a clear error naming the
 * env var when GITHUB_APP_ID is unset or no usable private key is configured
 * (inline GITHUB_PRIVATE_KEY, else the GITHUB_PRIVATE_KEY_PATH file).
 * No key material is ever included in the error message.
 */
export function getApp(): ReturnType<typeof makeApp> {
  if (appInstance) return appInstance;
  if (!env.GITHUB_APP_ID) {
    throw new Error("GITHUB_APP_ID is required when GITHUB_MODE=app");
  }
  let privateKey: string;
  if (env.GITHUB_PRIVATE_KEY.trim()) {
    // Hosts that expose only env vars cannot mount a PEM file. Accept both real
    // newlines and the literal "\n" that survives copy-paste into a dashboard.
    privateKey = env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else {
    try {
      privateKey = readFileSync(env.GITHUB_PRIVATE_KEY_PATH, "utf8");
    } catch {
      throw new Error(
        `GITHUB_PRIVATE_KEY_PATH (${env.GITHUB_PRIVATE_KEY_PATH}) is missing or unreadable — ` +
          "generate and download a private key for your GitHub App, or set GITHUB_PRIVATE_KEY " +
          "with the PEM contents (required on hosts without a filesystem mount).",
      );
    }
  }
  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      "GitHub App private key is not a PEM private key — check GITHUB_PRIVATE_KEY / " +
        "GITHUB_PRIVATE_KEY_PATH (the value itself is never printed).",
    );
  }
  appInstance = makeApp(privateKey);
  return appInstance;
}

/** Octokit authenticated as a specific installation (installation-scoped token). */
export async function installationOctokit(installationId: number): Promise<Octokit> {
  return getApp().getInstallationOctokit(installationId);
}

// ---------------------------------------------------------------------------
// Repos the GitHub App is installed on. Stored in the hunt store (Postgres when
// DATABASE_URL is set) so /summoned and diagnostics survive a restart.
// ---------------------------------------------------------------------------
export async function addRepo(fullName: string): Promise<void> {
  await store().addInstalledRepo(fullName);
}

export async function removeRepo(fullName: string): Promise<void> {
  await store().removeInstalledRepo(fullName);
}

export async function listRepos(): Promise<string[]> {
  return store().listInstalledRepos();
}
