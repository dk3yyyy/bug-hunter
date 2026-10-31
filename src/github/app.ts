// GitHub App auth + install-flow helpers (SPEC §6, Step 4: one-click App install).
// The App client is built lazily and cached; the private key is read from the PEM
// file pointed at by GITHUB_PRIVATE_KEY_PATH (never from an env var holding key
// material — key content must never appear in logs or errors).
import { readFileSync } from "node:fs";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { env } from "../env";

/**
 * The "Connect a repo" install URL for a GitHub App (CodeRabbit/Greptile style).
 * Pure so it can be unit-tested without touching the environment or network.
 */
export function installUrl(slug: string, state?: string): string {
  const base = `https://github.com/apps/${slug}/installations/new`;
  return state === undefined ? base : `${base}?state=${encodeURIComponent(state)}`;
}

function makeApp(privateKey: string) {
  return new App({ appId: env.GITHUB_APP_ID, privateKey, Octokit });
}

let appInstance: ReturnType<typeof makeApp> | null = null;

/**
 * Lazily build (and cache) the GitHub App client. Throws a clear error naming the
 * env var when GITHUB_APP_ID is unset or the private-key file is missing/unreadable.
 * No key material is ever included in the error message.
 */
export function getApp(): ReturnType<typeof makeApp> {
  if (appInstance) return appInstance;
  if (!env.GITHUB_APP_ID) {
    throw new Error("GITHUB_APP_ID is required when GITHUB_MODE=app");
  }
  let privateKey: string;
  try {
    privateKey = readFileSync(env.GITHUB_PRIVATE_KEY_PATH, "utf8");
  } catch {
    throw new Error(
      `GITHUB_PRIVATE_KEY_PATH (${env.GITHUB_PRIVATE_KEY_PATH}) is missing or unreadable — ` +
        "generate and download a private key for your GitHub App.",
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
// In-memory record of which repos are currently installed. Honest note: this is
// process-local only and resets on restart; full persistence (a DB) is out of
// scope. It exists so the install webhooks can reflect the connected repos.
// ---------------------------------------------------------------------------
const connectedRepos = new Set<string>();

export function addRepo(fullName: string): void {
  connectedRepos.add(fullName);
}

export function removeRepo(fullName: string): void {
  connectedRepos.delete(fullName);
}

export function listRepos(): string[] {
  return [...connectedRepos];
}
