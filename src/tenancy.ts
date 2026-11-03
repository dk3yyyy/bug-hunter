// Per-repo authorisation for hunts.
//
// A hunt triggered by a webhook has no user session — only a repo name. Without
// this, every hunt would run as the server's shared PAT, so any third party who
// connected their repo would see reviews posted from the operator's account.
//
// At connect time we therefore remember which user authorised the repo, sealed with
// the same key as the session cookie (AES-256-GCM, so tokens are not sitting in
// plaintext in process memory). Hunts then run with that user's token, which means
// GitHub enforces their permissions and the comment is attributed to them.
//
// LIMITATION, stated plainly: this is process memory, the app has no database.
// A deploy or a restart loses every mapping, and those repos fall back to the
// server token until the user connects again.
import { openSession, sealSession, SESSION_TTL_MS, type Session } from "./session";

export type RepoConnection = {
  /** GitHub login that authorised this repo (lowercased). */
  login: string;
  token: string;
  /** When the access token stops working (epoch ms), if the app issues expiring ones. */
  expiresAt?: number;
  /** Refresh token, present when the app issues expiring access tokens. */
  refreshToken?: string;
};

const connections = new Map<string, string>();

function keyFor(repo: string): string {
  return repo.trim().toLowerCase();
}

/** Remember (or replace) the user behind a repo. */
export function rememberRepoConnection(repo: string, conn: RepoConnection, secret: string): void {
  const payload: Session = {
    login: conn.login.toLowerCase(),
    token: conn.token,
    exp: Date.now() + SESSION_TTL_MS,
    ...(conn.expiresAt ? { expiresAt: conn.expiresAt } : {}),
    ...(conn.refreshToken ? { refreshToken: conn.refreshToken } : {}),
  };
  connections.set(keyFor(repo), sealSession(payload, secret));
}

/** The user behind a repo, or null when unknown/expired/undecryptable. */
export function recallRepoConnection(
  repo: string,
  secret: string,
  now = Date.now(),
): RepoConnection | null {
  const sealed = connections.get(keyFor(repo));
  if (!sealed) return null;
  const session = openSession(sealed, secret, now);
  if (!session) return null;
  return {
    login: session.login,
    token: session.token,
    ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
  };
}

export function forgetRepoConnection(repo: string): boolean {
  return connections.delete(keyFor(repo));
}

/** Repos currently mapped to a user (for /health or diagnostics). */
export function repoConnectionCount(): number {
  return connections.size;
}

/** Test helper: drop every mapping. */
export function resetRepoConnections(): void {
  connections.clear();
}
