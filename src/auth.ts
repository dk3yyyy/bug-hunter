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
  | {
      ok: true;
      accessToken: string;
      scope: string;
      tokenType: string;
      /** Seconds until the access token expires, when GitHub returns expires_in. */
      expiresIn?: number;
      /**
       * Present only when the OAuth App issues expiring tokens (the default for
       * apps created since Aug 2026): an 8-hour access token plus a 6-month
       * refresh token.
       */
      refreshToken?: string;
    }
  | { ok: false; reason: string };

type TokenBody = {
  access_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

/**
 * Shared POST to the token endpoint. GitHub reports failures with HTTP 200 and an
 * `error` field, and a misconfigured app can return 200 with no token at all, so
 * the body is inspected rather than the status alone. Messages never include the
 * access token, refresh token or client secret.
 */
async function requestToken(
  payload: Record<string, string>,
  kind: "login" | "refresh",
  fetchImpl: typeof fetch,
): Promise<TokenResult> {
  const what = kind === "login" ? "login exchange" : "token refresh";
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      reason:
        kind === "login"
          ? "Could not reach GitHub to exchange the login code."
          : "Could not reach GitHub to refresh the session token.",
    };
  }

  const body = (await res.json().catch(() => null)) as TokenBody | null;

  if (!res.ok) {
    return { ok: false, reason: `GitHub rejected the ${what} (HTTP ${res.status}).` };
  }
  if (body?.error) {
    const description = typeof body.error_description === "string" ? body.error_description : "";
    return {
      ok: false,
      reason: `GitHub refused the ${kind === "login" ? "login" : "token refresh"}${
        description ? `: ${description}` : ` (${String(body.error)})`
      }.`,
    };
  }
  if (typeof body?.access_token !== "string" || !body.access_token) {
    // Covers the "wrong OAuth App / bad client secret" case where GitHub returns
    // 200 with no token at all.
    return {
      ok: false,
      reason:
        kind === "login"
          ? "GitHub returned no access token — check GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET."
          : "GitHub returned no access token when refreshing — the refresh token may be expired or revoked.",
    };
  }
  return {
    ok: true,
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : "",
    tokenType: typeof body.token_type === "string" ? body.token_type : "bearer",
    ...(typeof body.expires_in === "number" && body.expires_in > 0
      ? { expiresIn: body.expires_in }
      : {}),
    ...(typeof body.refresh_token === "string" && body.refresh_token
      ? { refreshToken: body.refresh_token }
      : {}),
  };
}

/** Exchange the one-time `code` for an access token. */
export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResult> {
  return requestToken(
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    },
    "login",
    fetchImpl,
  );
}

/**
 * Swap a refresh token for a fresh access token. Needed because OAuth Apps created
 * since Aug 2026 issue 8-hour access tokens by default — without this, a session
 * would look signed in while every GitHub call returned 401.
 * https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#expiring-access-tokens
 */
export async function refreshAccessToken(
  cfg: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResult> {
  return requestToken(
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    "refresh",
    fetchImpl,
  );
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
