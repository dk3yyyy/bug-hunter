# Bug Hunter 🎃

> *"Every PR is haunted. Bug Hunter finds the spirits before they reach production."*

An open-source AI code reviewer that hunts bugs and security holes in GitHub pull
requests — powered by your LLM (Google Gemini by default; or Claude, OpenAI,
OpenCode Go, and any OpenAI-compatible model) — then posts a themed 🔮 Séance
Report with fixes.

Built at **GDG Sunderland Hacktoberfest 2026 AI Hack Day** ("Automate the Nightmare!").

[screenshot coming soon]

## What it does

When a pull request opens, Bug Hunter:

1. Reads the diff and hunts for real bugs and security holes with **your configured LLM**.
2. Runs a second, skeptical **verifier** pass to throw out false alarms.
3. Detects **possession attempts** — hidden instructions trying to trick AI reviewers.
4. Posts a themed **🔮 Séance Report** ranking every finding by creature (💀 Demon … 🕸️ Cobweb).
5. Fires an **n8n** workflow that logs each hunt to **Google Sheets** and sends a **Gmail**
   alert when a PR is haunted or possessed.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- **LLM provider** (default Google Gemini — one Google technology doing real work):
  - `GOOGLE_GENERATIVE_AI_API_KEY` — a Gemini API key from
    [Google AI Studio](https://aistudio.google.com/).
  - Or bring your own model: set `LLM_PROVIDER` to `openai` | `anthropic` (Claude) |
    `opencode` (OpenCode Go) | `openrouter` | `ollama` | `openai-compatible`, plus
    `LLM_API_KEY` and `LLM_MODEL_REVIEW` / `LLM_MODEL_FAST` (and `LLM_BASE_URL` for
    `openai-compatible`).
  - To see valid model ids for your provider, run `npm run check:models`.
- `GITHUB_WEBHOOK_SECRET` — any random string; it must match the secret you set on the
  GitHub webhook.
- `GITHUB_TOKEN` — a fine-grained personal access token scoped to your demo repo
  (Contents: Read · Pull requests: Read & write · Issues: Read & write · Commit statuses:
  Read & write · Metadata: Read).
- `N8N_HUNT_WEBHOOK_URL` and `N8N_SHARED_SECRET` — for the optional n8n workflow.

Then run it:

```bash
npm run dev
```

## Try it in 5 minutes

The fastest way to test is the **manual trigger** — no webhook or tunnel needed.

```bash
# 1. set keys in .env (GITHUB_TOKEN + GITHUB_WEBHOOK_SECRET + N8N_SHARED_SECRET + one provider)
npm run check:models      # list valid model ids for your provider
npm run dev               # http://localhost:3000

# 2. hunt any PR (must be a repo your GITHUB_TOKEN can read, and the PR must be open)
curl -X POST http://localhost:3000/api/hunt \
  -H "X-BugHunter-Secret: change-me-too" \
  -H "content-type: application/json" \
  -d '{"pr_url":"https://github.com/YOU/REPO/pull/N"}'
```

The 🔮 Séance Report appears on that PR, inline comments land on the buggy lines, and a
commit status flips to 💀/🌕.

### Providers

`LLM_PROVIDER=google` (default) uses `GOOGLE_GENERATIVE_AI_API_KEY`. Everything else uses
`LLM_API_KEY` (+ `LLM_BASE_URL` for `openai-compatible`).

| Provider | `LLM_PROVIDER` | `LLM_MODEL_REVIEW` example |
|---|---|---|
| Google Gemini | `google` | `gemini-2.0-flash` |
| Claude | `anthropic` | `claude-sonnet-4-5` |
| OpenAI | `openai` | `gpt-4o` |
| OpenCode Go | `opencode` | `glm-5.3` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.5` |
| Ollama (local) | `ollama` | `qwen2.5-coder:14b` |
| Any OpenAI-compatible | `openai-compatible` | vendor model id |

> The default `gemini-flash-latest` may not exist on every account — if a hunt fails with a
> model-not-found error, run `npm run check:models` and set `GEMINI_MODEL_REVIEW` to a real id.

### Webhook (for live PRs)

GitHub can't reach `localhost`, so forward webhooks with smee or ngrok:

```bash
npx smee -u https://smee.io/<your-channel> -t http://localhost:3000/webhooks/github
# or
ngrok http 3000   # then use https://<id>.ngrok.io/webhooks/github
```

Point your repo's webhook at that URL (content type `application/json`, secret =
`GITHUB_WEBHOOK_SECRET`, event = **Pull requests** + **Issue comments**), open a PR, and watch
the hunt begin. Alternatively, `POST /api/connect` (with `PUBLIC_URL` set) registers the webhook
for you.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhooks/github` | webhook secret | receive GitHub PR / issue-comment events |
| POST | `/api/hunt` | `X-BugHunter-Secret` | run a hunt now: `{ "pr_url" }` or `{ owner, repo, pr }` |
| POST | `/api/connect` | `X-BugHunter-Secret` | create a repo webhook via the PAT: `{ "repo": "owner/name" }` |
| GET | `/api/hunts` | none | recent hunts (JSON) |
| GET | `/api/hunts/:id` | none | one hunt (JSON) |
| GET | `/dashboard` | none | HTML results table |
| GET | `/health` | none | liveness |

## How it works

```
GitHub PR webhook → verify signature + dedupe → fetch diff → filter files
→ annotated diff → model review (structured JSON) → validate/snap lines
→ verifier pass (drop false alarms) → possession check → Séance Report
→ post one themed comment + inline comments + status → POST hunt.completed → n8n (Sheets + Gmail)
```

## n8n bonus

An n8n workflow (exported to `/n8n/`) receives each hunt result over a shared-secret webhook,
appends a row to a **Google Sheets** "Hunt Ledger", and sends a **Gmail** alert for
haunted/possessed PRs — with error handling that logs failures to a separate sheet tab.

## Demo

See [`demo/README.md`](demo/README.md) for the haunted-candy-shop demo repo (five planted
bugs plus a hidden possession attempt).

## Repo rules (`.bughunter.md`)

Write team rules in plain English in a `.bughunter.md` file on your default branch.
Bug Hunter reads it from the PR's base branch (a PR can't change its own rules),
alongside `AGENTS.md` / `CLAUDE.md` / `.cursorrules`. Rules can add checks or tell
the hunter to ignore accepted patterns. Rules cannot switch off security findings.
Max 2,000 characters.

```markdown
# 🎃 Bug Hunter rules

<!-- Write rules in plain English. Bug Hunter reads this file from your default branch.
     Rules can add checks or tell the hunter to ignore accepted patterns.
     Rules cannot switch off security findings. Max 2,000 characters. -->

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

## Docs

- [`docs/PRIOR_WORK.md`](docs/PRIOR_WORK.md) — what existed before the event vs. what was built during it.
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — paste-ready answers for the submission form.

## License

MIT — see [LICENSE](LICENSE).
