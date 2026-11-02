# Bug Hunter 🎃

> *"Every PR is haunted. Bug Hunter finds the spirits before they reach production."*

An open-source AI code reviewer that hunts bugs and security holes in GitHub pull
requests — powered by your LLM (Google Gemini by default; or Claude, OpenAI,
OpenCode Go, DeepSeek, and any OpenAI-compatible model) — then posts a themed 🔮 Séance
Report with fixes.

Built at **GDG Sunderland Hacktoberfest 2026 AI Hack Day** ("Automate the Nightmare!").

![Bug Hunter landing page](docs/landing.png)

## What it does

When a pull request opens, Bug Hunter:

1. Reads the diff and hunts for real bugs and security holes with **your model**.
2. Runs a second, skeptical **verifier** pass to throw out false alarms.
3. Detects **possession attempts** — hidden instructions trying to trick AI reviewers.
4. Posts a themed **🔮 Séance Report** ranking every finding by creature (💀 Demon … 🕸️ Cobweb).
5. Adds **inline comments** with one-click fixes and a **commit status** with the haunting level.
6. Fires an **n8n** workflow that logs each hunt to **Google Sheets** and sends a **Gmail**
   alert when a PR is haunted or possessed.

## Try it in 5 minutes

**No webhook or tunnel needed** — hunt a PR straight from the browser.

```bash
npm install
cp .env.example .env
# fill in .env (see Setup below), then:
npm run check:models      # list valid model ids for your provider
npm run dev               # http://localhost:3000
```

Then open **http://localhost:3000/connect**, paste a pull request URL, enter your
shared secret, and click **🔦 Hunt this PR**. The 🔮 Séance Report, inline comments and
commit status land on that GitHub PR.

Or from the shell:

```bash
curl -X POST http://localhost:3000/api/hunt \
  -H "X-BugHunter-Secret: <your N8N_SHARED_SECRET>" \
  -H "content-type: application/json" \
  -d '{"pr_url":"https://github.com/YOU/REPO/pull/N"}'
```

Requires Node 22+.

## Setup

Fill in `.env`:

- **LLM provider** — one of:
  - `google` (default): set `GOOGLE_GENERATIVE_AI_API_KEY` from
    [Google AI Studio](https://aistudio.google.com/).
  - `anthropic` (Claude) / `openai` / `opencode` (OpenCode Go) / `deepseek` /
    `openrouter` / `ollama` / `openai-compatible`: set `LLM_PROVIDER`, `LLM_API_KEY`,
    `LLM_MODEL_REVIEW` (and `LLM_MODEL_FAST`, optional), plus `LLM_BASE_URL` for
    `openai-compatible`. The Gemini key is only required for `google`.
- `GITHUB_TOKEN` — a fine-grained personal access token scoped to your repo
  (Contents: Read · Pull requests: Read & write · Issues: Read & write · Commit statuses:
  Read & write · Webhooks: Read & write · Metadata: Read). **Webhooks** is only needed
  for one-click auto-connect; classic tokens need `repo` (or `admin:repo_hook`).
- `GITHUB_WEBHOOK_SECRET` — a random string; it must match the secret on your GitHub webhook.
- `N8N_SHARED_SECRET` — random, **at least 16 chars** (also the `X-BugHunter-Secret`
  for `/api/hunt` and `/api/connect`).
- `N8N_HUNT_WEBHOOK_URL` — optional, for the n8n workflow.
- `PUBLIC_URL` — optional; the public URL of this server (a tunnel or a deployment).
  Enables one-click webhook registration on `/connect`. You can also paste the URL
  into the form instead of setting it here.
- `APP_URL` — optional; the URL of a hosted instance. When set, the landing's
  "Connect a repo" button points at `<APP_URL>/connect` (the GitHub Pages build
  reads the `APP_URL` repository variable).

### Providers

| Provider | `LLM_PROVIDER` | `LLM_MODEL_REVIEW` example |
|---|---|---|
| Google Gemini | `google` | `gemini-2.0-flash` |
| Claude | `anthropic` | `claude-sonnet-4-5` |
| OpenAI | `openai` | `gpt-4o` |
| OpenCode Go | `opencode` | `glm-5.3` |
| DeepSeek | `deepseek` | `deepseek-chat` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.5` |
| Ollama (local) | `ollama` | `qwen2.5-coder:14b` |
| Any OpenAI-compatible | `openai-compatible` | vendor model id |

To list the valid ids for your provider, run `npm run check:models`. If the default
`gemini-flash-latest` 404s on your account, set `GEMINI_MODEL_REVIEW` to a real id.

## Connecting a repo

There are three ways to point Bug Hunter at a repository:

1. **Hunt a PR now** (no setup) — the `/connect` page or `POST /api/hunt`.
2. **Webhook** — on `/connect`, paste `owner/name` and the public URL of this server;
   Bug Hunter creates the webhook (`pull_request` + `issue_comment`, content type
   `application/json`, secret = `GITHUB_WEBHOOK_SECRET`). Or add it by hand to
   `<public-url>/webhooks/github`. GitHub must be able to reach that URL, so for
   localhost use a tunnel and paste the tunnel URL into the form (or set `PUBLIC_URL`):
   ```bash
   npx smee -u https://smee.io/<your-channel> -t http://localhost:3000/webhooks/github
   # or: ngrok http 3000
   ```
   For smee, paste the full `https://smee.io/<your-channel>` URL — Bug Hunter keeps the
   channel path (that is what smee forwards); for ngrok/cloudflared it appends
   `/webhooks/github`.
   Clicking Connect twice is safe: an existing hook that already points at the same
   URL is reused instead of failing with GitHub's "Hook already exists".
3. **GitHub App (one-click install)** — set `GITHUB_MODE=app` plus `GITHUB_APP_ID`,
   `GITHUB_APP_SLUG` and `GITHUB_PRIVATE_KEY_PATH`; the landing's "Connect a repo" and
   `/summon` hand off to GitHub's app-install page, and `installation` webhooks keep the
   repo list in sync. This is the full CodeRabbit/Greptile-style flow. The App needs
   **Pull requests**, **Issues** and **Commit statuses** read & write, **Contents** read,
   the **Pull request** + **Issue comment** + **Installation** events, and a Setup URL
   of `<public-url>/summoned`.

### Why the public "Connect a repo" button needs a deployment

The GitHub Pages landing is static: it can send people somewhere, but it cannot create
a webhook or run a review. For the button to work end to end, deploy this server and
point the landing at it:

### Deploy to Render or Railway

Both platforms build the repo's `Dockerfile`, and the config is committed:

- **Render** — `render.yaml` blueprint. Dashboard → **New → Blueprint** → pick this
  repo. It creates the service, generates `GITHUB_WEBHOOK_SECRET` and
  `N8N_SHARED_SECRET`, and prompts for the two secrets it cannot invent
  (`GITHUB_TOKEN` and your model key).
- **Railway** — `railway.json`. **New Project → Deploy from GitHub repo**, then add
  `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `N8N_SHARED_SECRET` and your model key
  under **Variables**.

`PUBLIC_URL` is derived from `RENDER_EXTERNAL_URL` / `RAILWAY_PUBLIC_DOMAIN`, so a
first deploy can register webhooks without anyone copying the URL by hand. Set it
explicitly only for a custom domain. In App mode the PEM goes in `GITHUB_PRIVATE_KEY`
as inline content, since neither host can mount a key file.

Docker by hand still works:

```bash
docker build -t bug-hunter .
docker run -p 3000:3000 --env-file .env bug-hunter
```

Then set:

- `PUBLIC_URL=https://your-host` on the server (the webhook target), and
- the repository variable `APP_URL=https://your-host` so the next Pages deploy links
  "Connect a repo" to `https://your-host/connect`:
  ```bash
  gh variable set APP_URL --repo dk3yyyy/bug-hunter --body https://your-host
  gh workflow run deploy-pages.yml   # changing a variable doesn't retrigger the deploy
  ```

Alternatively register a GitHub App and set an `APP_SLUG` repository variable; the
static landing then links straight to `https://github.com/apps/<slug>/installations/new`.
With neither variable set, the button stays on the page and scrolls to the self-host
section instead of bouncing to the README.

### Connect troubleshooting

| Symptom | Cause / fix |
|---|---|
| `400 PUBLIC_URL not set` | No `PUBLIC_URL` and no URL in the form — paste your tunnel/deployment URL. |
| `GitHub can't reach localhost…` | A webhook needs a public URL. Use ngrok/smee/cloudflared or deploy. |
| `403 The token can't manage webhooks` | Fine-grained token needs **Webhooks: Read & write**; classic needs `admin:repo_hook` (or `repo`). |
| `404 Repo not found…` | Wrong `owner/name`, or the token isn't scoped to that repo. |
| `422 GitHub rejected the webhook` | Unreachable URL, or the repo hit its webhook limit. |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | landing page |
| GET | `/connect` | none | hunt a PR now / auto-connect a repo |
| GET | `/summon` | none | redirect to the GitHub App install page (app mode) or `/connect` |
| GET | `/dashboard` | none | recent hunts (in-memory) |
| GET | `/health` | none | liveness |
| POST | `/webhooks/github` | webhook signature | GitHub PR / issue-comment / installation events |
| POST | `/api/hunt` | `X-BugHunter-Secret` | run a hunt now: `{ "pr_url" }` or `{ owner, repo, pr }` |
| POST | `/api/connect` | `X-BugHunter-Secret` | create/reuse a repo webhook: `{ "repo", "public_url"? }` (or `PUBLIC_URL`) |
| GET | `/api/hunts` | `X-BugHunter-Secret` | recent hunts (JSON) |
| GET | `/api/hunts/:id` | `X-BugHunter-Secret` | one hunt (JSON) |

## How it works

```
GitHub PR webhook → verify signature + dedupe → fetch diff → filter files
→ annotated diff → model review (structured JSON) → validate/snap lines
→ verifier pass (drop false alarms) → possession check → Séance Report
→ post one themed comment + inline comments + status → POST hunt.completed → n8n (Sheets + Gmail)
```

## Repo rules (`.bughunter.md`)

Write team rules in plain English in a `.bughunter.md` file on your default branch.
Bug Hunter reads it from the PR's base branch (a PR can't change its own rules),
alongside `AGENTS.md` / `CLAUDE.md` / `.cursorrules`. Rules can add checks or tell
the hunter to ignore accepted patterns. Rules cannot switch off security findings.
Max 2,000 characters.

```markdown
# 🎃 Bug Hunter rules

## Always check
-

## Conventions we accept (don't flag)
-

## Extra attention (paths or areas)
-
```

All Halloween wording lives in [`prompts/voice.json`](prompts/voice.json) — edit it to
change the posted reports with no code changes. The LLM prompts live in
`prompts/review.system.md`, `prompts/review.user.md`, `prompts/verify.md` and
`prompts/seance.md`.

## n8n bonus

An n8n workflow (exported to `/n8n/`) receives each hunt result over a shared-secret
webhook, appends a row to a **Google Sheets** "Hunt Ledger", and sends a **Gmail** alert
for haunted/possessed PRs — with error handling that logs failures to a separate tab.

## Demo

See [`demo/README.md`](demo/README.md) for the haunted-candy-shop demo repo (five planted
bugs plus a hidden possession attempt), and [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md)
for the 2-minute demo script.

## Development

- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest (unit + in-process integration tests)
- CI runs both on every push and pull request (`.github/workflows/ci.yml`); the landing
  page auto-deploys to GitHub Pages on landing changes.

## Docs

- [`docs/PRIOR_WORK.md`](docs/PRIOR_WORK.md) — what existed before the event vs. what was built during it.
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — paste-ready answers for the submission form.
- [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) — demo + troubleshooting.

## License

MIT — see [LICENSE](LICENSE).
