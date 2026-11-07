# Quickstart

Run Bug Hunter locally and hunt a real pull request in about five minutes.
No webhook, tunnel, or deployment is required for the first run.

## What you need

- **Node 22+** and `npm`
- A GitHub account and a **fine-grained personal access token** scoped to the
  repository you want to review
- One **model API key** (Google Gemini is the default)

The token needs:

- **Contents:** read
- **Pull requests:** read & write
- **Issues:** read & write
- **Commit statuses:** read & write
- **Metadata:** read

Add **Webhooks:** read & write only if you want one-click webhook registration
later. A classic token needs `repo` (or `admin:repo_hook`).

## 1. Install

```bash
git clone https://github.com/dk3yyyy/bug-hunter.git
cd bug-hunter
npm install
cp .env.example .env
```

## 2. Fill in `.env`

The server validates its environment at boot and refuses to start with a list of
missing variable **names** (never values). The minimum for a first run is:

```dotenv
GITHUB_MODE=pat
GITHUB_TOKEN=github_pat_...
GITHUB_WEBHOOK_SECRET=any-random-string

N8N_SHARED_SECRET=<a random string, at least 16 characters>

LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_MODEL_REVIEW=gemini-flash-latest
```

Generate a shared secret with:

```bash
python3 -c "import secrets; print(secrets.token_hex(24))"
```

`GITHUB_WEBHOOK_SECRET` is required even when you trigger hunts manually, because
the webhook route is always mounted. Any random string works for now.

Using a different provider? Set `LLM_PROVIDER`, `LLM_API_KEY`, and
`LLM_MODEL_REVIEW` instead of the Gemini variables. See
[Configuration](CONFIGURATION.md#providers).

## 3. Check model ids

Model ids move. Ask your provider what this key can actually use:

```bash
npm run check:models
```

Put a real id into `GEMINI_MODEL_REVIEW` (or `LLM_MODEL_REVIEW`) if the default
is not available on your account.

## 4. Start the server

```bash
npm run dev
```

You should see Bug Hunter listening on `http://localhost:3000`. Check liveness:

```bash
curl -s http://localhost:3000/health
# {"ok":true,"queued":0,"repos":0}
```

## 5. Hunt a pull request

### From the browser

Open **http://localhost:3000/connect**, paste a pull request URL, and submit.
Locally, the shared-secret field is under **Advanced**; paste your
`N8N_SHARED_SECRET`.

### From the shell

```bash
export N8N_SHARED_SECRET='<the value from .env>'

curl -sS -X POST http://localhost:3000/api/hunt \
  -H "Content-Type: application/json" \
  -H "X-BugHunter-Secret: $N8N_SHARED_SECRET" \
  -d '{"pr_url":"https://github.com/YOU/REPO/pull/1"}'
```

The request returns when the hunt finishes, usually in **60–120 seconds**. The
same result is posted on the pull request. To avoid holding the HTTP connection,
send `"async": true`; the API then returns `202` with a hunt id, and
`GET /api/hunts/:id` returns the record when it exists. The `/connect` page uses
that path.

A healthy run leaves:

- a **`Bug Hunter` commit status** — pending, then haunted or clear
- one **🔮 Séance Report** comment
- **inline comments** with suggested fixes on anchored findings

Re-running updates the Séance Report in place instead of creating duplicates.

## Optional: persist hunt history

By default, hunt history lives in memory and is lost on restart. To keep the
dashboard and `/api/hunts` across restarts, point `DATABASE_URL` at a Postgres
database:

```dotenv
DATABASE_URL=postgres://user:password@localhost:5432/bug_hunter
```

Bug Hunter creates the `hunts` table and its index on first use. The database is
not used for diffs, prompts, or credentials. See
[Postgres](SELF-HOSTING.md#postgres) for schema and TLS notes.

## Optional: automatic hunts with a webhook

A webhook needs a public URL. For local development, forward GitHub to your
server:

```bash
npx smee -u https://smee.io/<your-channel> -t http://localhost:3000/webhooks/github
```

Create a channel at <https://smee.io>, then either:

- open `/connect`, enter `owner/name` and the full smee URL, and let Bug Hunter
  create the webhook; or
- add it manually in the repository under **Settings → Webhooks**:
  - **Payload URL:** your smee channel URL
  - **Content type:** `application/json`
  - **Secret:** the same value as `GITHUB_WEBHOOK_SECRET`
  - **Events:** Pull requests (add Issue comments for `@bughunter` commands)

With a webhook in place, opening or reopening a PR starts a hunt automatically.

## Optional: try the bundled fixture

`demo/` contains a fake repository with five planted bugs and a hidden
instruction in the PR description. [demo/README.md](../demo/README.md) explains
how to push it to a throwaway repository and open the pull request. It is useful
for checking that detection, possession handling, and inline comments all work.

## Troubleshooting

### The server exits at boot

It prints only the names of missing or invalid variables, for example
`GOOGLE_GENERATIVE_AI_API_KEY is required` or
`GITHUB_TOKEN is required when GITHUB_MODE=pat`. Fill them in and restart.

### `401 unauthorized` from `/api/hunt`

The `X-BugHunter-Secret` header must match `N8N_SHARED_SECRET` exactly. In a
shell, quote it and do not commit it.

### `402 Insufficient account funds`

On OpenCode Go this usually means the wrong base URL, not an empty balance. The
subscription is served from `/inference/go/...`; the pay-as-you-go Console
balance is `/inference/openai/...`. Bug Hunter defaults to the subscription
endpoint. Check `LLM_BASE_URL` before topping anything up.

### Model not found

Run `npm run check:models` and set the review and fast model ids to ones the key
can use. Restart `npm run dev`.

### Inline review `422`

GitHub rejects the whole review if any inline line is outside the diff. Bug
Hunter validates and snaps positions before posting and falls back to the Séance
Report when a finding cannot be anchored. If it still happens, the head commit
probably changed during the hunt; re-run on the latest SHA.

### Nothing appears on the pull request

Check the webhook delivery log first:

```bash
gh api /repos/OWNER/REPO/hooks --jq '.[].id'
gh api /repos/OWNER/REPO/hooks/<id>/deliveries \
  --jq '.[] | "\(.delivered_at) \(.event) -> \(.status_code) \(.status)"'
```

`200 OK` means GitHub reached the server. A timeout usually means the instance
was asleep; GitHub does not retry failed deliveries.

### `524` or "proxy timed out"

The hunt outlived the proxy timeout but is still running server-side. Check the
pull request before retrying. `/connect` avoids this by polling; direct API
callers can send `"async": true` and poll `GET /api/hunts/:id`.

## Next steps

- [Configuration](CONFIGURATION.md) — every environment variable, repository
  rules, and provider defaults
- [Self-hosting](SELF-HOSTING.md) — Docker, Render, Railway, GitHub App
- [Architecture](ARCHITECTURE.md) — how a hunt moves through the system
