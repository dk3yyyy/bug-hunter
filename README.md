# Bug Hunter 🎃

> *"Every PR is haunted. Bug Hunter finds the spirits before they reach production."*

An open-source AI code reviewer that hunts bugs and security holes in GitHub pull
requests with Google Gemini, then posts a themed 🔮 Séance Report with fixes.

Built at **GDG Sunderland Hacktoberfest 2026 AI Hack Day** ("Automate the Nightmare!").

[screenshot coming soon]

## What it does

When a pull request opens, Bug Hunter:

1. Reads the diff and hunts for real bugs and security holes with **Gemini**.
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

GitHub can't reach `localhost`, so forward webhooks with smee or ngrok:

```bash
npx smee -u https://smee.io/<your-channel> -t http://localhost:3000/webhooks/github
# or
ngrok http 3000   # then use https://<id>.ngrok.io/webhooks/github
```

Point your demo repo's webhook at that URL (content type `application/json`, secret =
`GITHUB_WEBHOOK_SECRET`, event = **Pull requests**), open a PR, and watch the hunt begin.

## How it works

```
GitHub PR webhook → verify signature + dedupe → fetch diff → filter files
→ annotated diff → Gemini review (structured JSON) → validate/snap lines
→ Gemini verifier (drop false alarms) → possession check → Séance Report
→ post one themed comment → POST hunt.completed → n8n (Sheets + Gmail)
```

## n8n bonus

An n8n workflow (exported to `/n8n/`) receives each hunt result over a shared-secret webhook,
appends a row to a **Google Sheets** "Hunt Ledger", and sends a **Gmail** alert for
haunted/possessed PRs — with error handling that logs failures to a separate sheet tab.

## Demo

See [`demo/README.md`](demo/README.md) for the haunted-candy-shop demo repo (five planted
bugs plus a hidden possession attempt).

## Docs

- [`docs/PRIOR_WORK.md`](docs/PRIOR_WORK.md) — what existed before the event vs. what was built during it.
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — paste-ready answers for the submission form.

## License

MIT — see [LICENSE](LICENSE).
