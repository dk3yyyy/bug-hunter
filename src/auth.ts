// GitHub OAuth (web application flow) for "Connect with GitHub".
//
// An OAuth App is the right credential here, not a GitHub App: App installation
// tokens cannot create repository webhooks, which is exactly what /api/connect
// must do. OAuth App tokens are classic-scoped and can manage hooks.
//
// Everything network-facing is a thin, testable function so the routes stay small
// and the flow can be exercised without hitting GitHub.

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

/**
 * Minimal classic scopes:
 *  - read:user — explicit identity scope for the session (login, name, avatar).
 *                Not strictly required (GET /user works with no scope), but it
 *                documents the intent instead of relying on that.
 *  - repo      — read PRs/diffs AND create/delete the webhook that makes hunts
 *                automatic.
 *
 * `repo` already covers repository webhooks: GitHub documents it as "full access
 * to public, internal, and private repositories including … and repository
 * webhooks", and states plainly that "the repo and public_repo scopes grant full
 * access to repositories, including repository webhooks". `admin:repo_hook` is
 * only for hook access WITHOUT repo contents, so requesting it here is redundant.
 *
 * GitHub also *normalises* scopes, discarding ones implied by another requested
 * scope, so the granted scope string may not echo everything back. Never gate
 * logic on a specific scope appearing in the response — check `repo`.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
 */
export const OAUTH_SCOPES = ["read:user", "repo"] as const;

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", (opts.scopes ?? OAUTH_SCOPES).join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export type TokenResult =
  | { ok: true; accessToken: string; scope: string; tokenType: string }
  | { ok: false; reason: string };

/**
 * Exchange the one-time `code` for an access token. GitHub signals failure with
 * HTTP 200 and an `error` field, so the body has to be inspected, not just the
 * status. No error message here ever includes the token or the client secret.
 */
export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResult> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: cfg.redirectUri,
      }),
    });
  } catch {
    return { ok: false, reason: "Could not reach GitHub to exchange the login code." };
  }

  const body = (await res.json().catch(() => null)) as
    | { access_token?: unknown; scope?: unknown; token_type?: unknown; error?: unknown; error_description?: unknown }
    | null;

  if (!res.ok) {
    return { ok: false, reason: `GitHub rejected the login exchange (HTTP ${res.status}).` };
  }
  if (body?.error) {
    const description = typeof body.error_description === "string" ? body.error_description : "";
    return {
      ok: false,
      reason: `GitHub refused the login${description ? `: ${description}` : ` (${String(body.error)})`}.`,
    };
  }
  if (typeof body?.access_token !== "string" || !body.access_token) {
    // Covers the "wrong OAuth App / bad client secret" case where GitHub returns
    // 200 with no token at all.
    return {
      ok: false,
      reason: "GitHub returned no access token — check GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
    };
  }
  return {
    ok: true,
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : "",
    tokenType: typeof body.token_type === "string" ? body.token_type : "bearer",
  };
}

export type GitHubUser = { login: string; name?: string; avatar?: string };

/** Identity for the session. Treats a non-2xx as a failed login, not a crash. */
export async function fetchUser(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubUser | null> {
  try {
    const res = await fetchImpl(`${API}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { login?: unknown; name?: unknown; avatar_url?: unknown }
      | null;
    if (typeof body?.login !== "string" || !body.login) return null;
    return {
      login: body.login,
      ...(typeof body.name === "string" && body.name ? { name: body.name } : {}),
      ...(typeof body.avatar_url === "string" && body.avatar_url ? { avatar: body.avatar_url } : {}),
    };
  } catch {
    return null;
  }
}
