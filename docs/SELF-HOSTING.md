# Self-hosting

Bug Hunter is a single Node process. Any host that can run a Docker image and
inject environment variables will work. Postgres is optional and used only for
hunt history; without it, history lives in memory. This guide covers the
supported paths.

## Requirements

- A host that can run the `Dockerfile`, or Node 22+ with `npm`
- A public HTTPS URL that GitHub can reach (for webhooks)
- A GitHub token or a GitHub App
- A model API key, or a reachable local model endpoint
- A persistent disk is not required. Postgres is optional, for hunt history

The service listens on `PORT` (default `3000`) and exposes `GET /health` for
liveness checks.

## Environment

Copy `.env.example` to `.env` for a local or Docker run. The full variable
reference, defaults, and validation rules are in
[CONFIGURATION.md](CONFIGURATION.md).

The minimum production set is:

```dotenv
PORT=3000
GITHUB_MODE=pat
GITHUB_TOKEN=...
GITHUB_WEBHOOK_SECRET=<random>
N8N_SHARED_SECRET=<random, 16+ chars>
PUBLIC_URL=https://bug-hunter.example.com

LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Add `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL_REVIEW` for any non-Gemini
provider. Add `SESSION_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, and
`GITHUB_OAUTH_CLIENT_SECRET` to enable GitHub login. Add `DATABASE_URL` if you
want hunt history to survive restarts; see [Postgres](#postgres).

`PUBLIC_URL` is what GitHub uses to reach webhooks. It is derived automatically
from `RENDER_EXTERNAL_URL` (Render) or `RAILWAY_PUBLIC_DOMAIN` (Railway) when it
is empty. Set it explicitly for a custom domain or any other host.

## Docker

```bash
docker build -t bug-hunter .
docker run --rm -p 3000:3000 --env-file .env bug-hunter
```

The image runs `npx tsx src/server.ts` on `node:22-slim`. Dev dependencies are
installed because `tsx` and TypeScript are used at runtime. Secrets are never
baked into the image; pass them with `--env-file` or the platform's secret store.
Add `DATABASE_URL` to the same environment file to persist hunt history.

If you use App mode with a PEM file, mount it and point
`GITHUB_PRIVATE_KEY_PATH` at the mount. On hosts that cannot mount files, put
the PEM contents in `GITHUB_PRIVATE_KEY` instead. Literal `\n` sequences are
normalised, so a single-line environment value works.

Behind a reverse proxy, allow at least **150 seconds** for synchronous
`/api/hunt` calls and webhook responses. A hunt takes 60–120 seconds. If the
proxy cuts earlier, the hunt still finishes server-side but the client sees a
timeout. The `/connect` page avoids this by starting hunts asynchronously and
polling `GET /api/hunts/:id`.

## Render

The repository includes a `render.yaml` blueprint.

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → select the repository.
3. Render creates a Docker web service named `bug-hunter` with:
   - `/health` as the health check path
   - generated `GITHUB_WEBHOOK_SECRET` and `N8N_SHARED_SECRET`
   - prompts for `GITHUB_TOKEN`, the model key, and optional OAuth credentials
4. After the first deploy, copy the service URL. `PUBLIC_URL` is derived from
   `RENDER_EXTERNAL_URL`, so you do not need to set it unless you use a custom
   domain.

The blueprint defaults to the free plan. A free instance **sleeps when idle**,
and GitHub does not retry failed webhook deliveries. Use a paid plan if automatic
reviews must always be answered promptly, or wake the service before relying on a
webhook.

The blueprint does not provision Postgres. To keep hunt history across deploys,
create a Render Postgres instance and set its connection string as
`DATABASE_URL` on the web service.

## Railway

`railway.json` points Railway at the same Dockerfile and health check.

1. **New Project → Deploy from GitHub repo**.
2. Add the environment variables under **Variables**:
   `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `N8N_SHARED_SECRET`, your model key,
   and `LLM_PROVIDER` if it is not Google. Add `DATABASE_URL` if you provisioned
   Postgres.
3. Generate a public domain. `PUBLIC_URL` is derived from
   `RAILWAY_PUBLIC_DOMAIN`.

Railway injects `PORT`; the server honours it.

## Any other host

Build the Dockerfile and set the environment variables listed above. There is no
migration step or required persistent volume; the optional Postgres table is
created on first use. If your platform runs more than one replica, note that
repo-user mappings, rate limits, and delivery dedupe are per-process. Hunt
history is shared only when every replica points at the same `DATABASE_URL`.
Run a single replica unless you have accounted for that, or accept that a webhook
may land on a replica that did not see the original connect.

## GitHub OAuth login (recommended for shared instances)

Without OAuth, users must paste the server's `N8N_SHARED_SECRET` into `/connect`,
which nobody knows on a hosted instance.

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set:
   - **Homepage URL:** `https://your-instance`
   - **Authorization callback URL:** `https://your-instance/auth/github/callback`
3. Set `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and a random
   `SESSION_SECRET` on the host.
4. Reload `/connect`. The secret field moves under **Advanced** and a **Connect
   with GitHub** button appears.

OAuth Apps created after August 2026 issue 8-hour access tokens and a refresh
token. Bug Hunter stores both and refreshes silently. If you prefer
non-expiring tokens, untick **Expire user authorization tokens** in the OAuth
App settings.

Set `ALLOWED_GITHUB_LOGINS=you,teammate` on any publicly reachable instance.
Without it, any GitHub user can sign in and spend your model credits.

The OAuth App needs the `read:user` and `repo` scopes. `repo` is required because
`/api/connect` creates repository webhooks, and GitHub scopes webhook management
under repository access.

## GitHub App mode

App mode gives a one-click install flow instead of a pasted token.

1. Create a GitHub App with:
   - **Permissions:** Pull requests read & write, Issues read & write, Commit
     statuses read & write, Contents read, Metadata read
   - **Events:** Pull request, Issue comment, Installation
   - **Setup URL:** `https://your-instance/summoned`
2. Set `GITHUB_MODE=app`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and either
   `GITHUB_PRIVATE_KEY_PATH` or inline `GITHUB_PRIVATE_KEY`.
3. Install the App on the repositories you want reviewed. `/summon` redirects to
   the install page, and installation webhooks keep the repo list in sync.

`GITHUB_TOKEN` is not used in App mode. Manual `POST /api/hunt` resolves the
installation from the repository, so the App must already be installed there.

## Static landing page

`src/render/landing.html` is deployed to GitHub Pages by
`.github/workflows/deploy-pages.yml`. The static page cannot create webhooks or
run reviews, so point its **Connect a repo** button at a running instance:

```bash
gh variable set APP_URL --repo OWNER/REPO --body https://your-instance
gh variable set APP_SLUG --repo OWNER/REPO --body your-app-slug   # optional, App mode
gh workflow run deploy-pages.yml
```

`APP_SLUG` takes precedence and links to the GitHub App install page. Otherwise
`APP_URL` links to `<APP_URL>/connect`. With neither set, the button scrolls to
the self-host section.

Changing a repository variable does not retrigger the Pages deploy; run the
workflow explicitly after changing it.

## Operations

- **Health:** `GET /health` returns `{ ok, queued, repos }`.
- **Dashboard:** `/dashboard` lists the 50 most recent hunts from the hunt store.
- **Logs:** structured lines contain event names, repo, PR, and durations.
  Secrets are scrubbed, but review the log sink's access policy anyway.
- **Restarts:** always clear rate limits and per-repo user mappings. Hunt history
  survives only when `DATABASE_URL` is set; the in-memory fallback is reset.
  Reconnect repos after a restart if you rely on user attribution.
- **Backups:** with `DATABASE_URL` set, back up the Postgres `hunts` table like
  any other database. Without it there is nothing to back up server-side; use
  `/api/hunts`, the n8n `hunt.completed` payload, or an external sink if you need
  a durable audit trail.
- **Upgrades:** pull the new image or commit, rebuild, and redeploy. Run
  `npm run typecheck && npm test` before rolling out your own changes.

## Postgres

Postgres is optional. It stores hunt history only, so the dashboard and
`GET /api/hunts` survive restarts and multiple instances can share a record store.

Set:

```dotenv
DATABASE_URL=postgres://user:password@host:5432/dbname
```

On first use, `src/store.ts` runs:

```sql
CREATE TABLE IF NOT EXISTS hunts (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS hunts_finished_at_idx ON hunts (finished_at DESC);
```

The app needs permission to create that table and index. It does not run
migrations or alter existing tables; if you want to manage the schema yourself,
create the same objects before starting the service.

With `DATABASE_URL` empty, the in-memory store keeps the last 500 records and
behaves identically for the dashboard and API within one process. Hunks, diffs,
review state, and repo-user mappings never go to Postgres. Use your provider's
TLS parameters in the connection string if it requires TLS, for example
`?sslmode=require`.

## Related docs

- [Configuration](CONFIGURATION.md)
- [Architecture](ARCHITECTURE.md)
- [Quickstart](QUICKSTART.md)
- [Security](../SECURITY.md)
