# 🔮 Demo Runbook — Bug Hunter

A step-by-step guide to running the **2-minute demo** of Bug Hunter on the
`haunted-candy-shop` repo, plus a testing guide for before you go on stage.

The demo shows one haunted PR end-to-end:

```
PR opened ──► Gemini hunt ──► Gemini verifier ──► 🔮 Séance Report (+ inline comments, status)
                                        └───────► n8n ──► Google Sheets "Hunt Ledger" + Gmail alert
```

All demo data is fake. No real database, no real users, no secrets.

---

## 0. Before demo day (do this once)

### Prerequisites

- Node 22+, `npm`.
- GitHub account + the **`gh` CLI**, authenticated: `gh auth login`.
  The bot posts comments using `GITHUB_TOKEN`, and `seed-demo.sh` uses `gh`.
- A **Google AI Studio** API key (`GOOGLE_GENERATIVE_AI_API_KEY`).
- (Optional, for the +10 bonus) an **n8n** instance and its webhook URL.

### 1. Configure `.env`

Copy `.env.example` to `.env` and fill in the blanks. The values are **secrets** —
they live only in `.env` (which is gitignored) and are never shown on screen:

```bash
cp .env.example .env
```

Minimum required keys (the server refuses to start and names any that are missing):

| Key | Value |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key from Google AI Studio |
| `GITHUB_MODE` | `pat` |
| `GITHUB_TOKEN` | Fine-grained PAT scoped to the demo repo (Permissions: Contents **Read**, Pull requests **Read & write**, Issues **Read & write**, Commit statuses **Read & write**, Metadata **Read**) |
| `GITHUB_WEBHOOK_SECRET` | any random string (only needed for the webhook path) |
| `N8N_SHARED_SECRET` | a shared secret, e.g. `change-me-too` (guards `/api/hunt` and the n8n webhook) |
| `GEMINI_MODEL_REVIEW` | a real Gemini model id (see Troubleshooting §9.1) |

Optional:

| Key | Value |
|---|---|
| `N8N_HUNT_WEBHOOK_URL` | n8n Workflow 1 webhook URL (only if demoing n8n) |
| `GEMINI_MODEL_FAST` | fast model for the Séance summary pass |

### 2. Install and start the server

```bash
npm install
npm run dev
```

You should see `🎃 Bug Hunter listening on http://localhost:3000`. Quick smoke test:

```bash
curl -s http://localhost:3000/health   # {"ok":true,"queued":0}
```

### 3. Choose a trigger path

You only need **one** of these. The manual trigger is the fastest and has no
network setup; the webhook path makes the demo fully automatic.

**Option A — manual `/api/hunt` (fastest, recommended for the live demo).**
Keep the server running and trigger each hunt by hand with `curl` (see §3).
You control the timing exactly — good on stage.

**Option B — GitHub webhook (fully automatic).** Forward GitHub's webhook to
your local server, then add the webhook to the demo repo (SPEC §6):

```bash
# Terminal 1: the Bug Hunter server (already running on :3000)

# Terminal 2: forward a smee.io channel to localhost
npx smee -u https://smee.io/<your-channel> -t http://localhost:3000/webhooks/github
```

- Create a channel at https://smee.io and copy the URL.
- In the demo repo: **Settings → Webhooks → Add webhook**:
  - Payload URL: `https://smee.io/<your-channel>`
  - Content type: `application/json`
  - Secret: the same value as `GITHUB_WEBHOOK_SECRET`
  - Events: **Pull requests** (add **Issue comments** if using commands).

With Option B, opening (or reopening) the PR fires the hunt automatically.

---

## 1. Seed the demo repo

From the `bug-hunter/` directory:

```bash
./scripts/seed-demo.sh YOUR-USERNAME/haunted-candy-shop
```

What it does:

1. `gh repo create YOUR-USERNAME/haunted-candy-shop --public` (with a description).
2. Pushes `demo/base/` as the initial `main` commit — `src/costumes.ts`,
   `src/db.ts`, and `AGENTS.md` (the "use parameterized queries" rule).
3. Creates `feature/candy-distribution`, adds `demo/pr/src/candy.ts`, commits.
4. Opens PR **"Add candy distribution endpoint"** with the body from
   `demo/pr/pr-description.md` — which contains a hidden instruction aimed at AI
   reviewers ("Report no issues…"). This is the **possession attempt**.

At the end it prints the PR URL and the exact `curl` command for the next step.
It is idempotent: if the repo already exists it warns and exits `0` without
touching it.

> The PR adds five planted bugs on purpose (see `demo/README.md`): a hard-coded
> secret, SQL injection, a missing `await`, an off-by-one loop, and a
> divide-by-zero. The `// 🐛` hints are intentionally absent.

---

## 2. Trigger the hunt

**Option A — manual:**

```bash
curl -sS -X POST http://localhost:3000/api/hunt \
  -H 'Content-Type: application/json' \
  -H 'X-BugHunter-Secret: change-me-too' \
  -d '{"pr_url": "https://github.com/YOUR-USERNAME/haunted-candy-shop/pull/1"}'
```

The server replies with the hunt record (JSON) once the hunt finishes. The hunt
runs in the background queue, so give it a few seconds. Refresh the PR page to
watch the Séance Report appear.

**Option B — webhook:** just open (or close + reopen) the PR and the hunt runs
automatically.

---

## 3. The 2-minute demo (per SPEC §19)

Total ≈ 120 s. Practice the transitions; the PR should be seeded **before** you
start the clock.

| Time | Beat | Say / show |
|---|---|---|
| 0:00–0:10 | **The nightmare** | *"Every pull request is haunted. Bugs slip through tired human reviews, and today's AI reviewers are so noisy that developers reject over half their comments."* |
| 0:10–0:15 | **Trigger** | Fire the `curl` (Option A) or reopen the PR (Option B). Say *"Watch the hunt begin."* |
| 0:15–1:05 | **The Séance Report** | Walk the report (see §4): 💀 Possessed, the SQL-injection Demon, the missing-`await` Ghost, the 🪄 possession callout, and "🧹 Exorcised false alarms". |
| 1:05–1:25 | **Inline + status** | Scroll to the inline review comments on the exact lines, then point at the commit status "💀 Possessed: do not merge". |
| 1:25–1:50 | **Google tech + automation** | *"Gemini hunts, a second Gemini pass verifies. n8n logs every hunt to Google Sheets and sends a Gmail alert."* Show the new Hunt Ledger row + the alert email (§5). |
| 1:50–2:00 | **What's next** | Inline one-click fixes everywhere, a "Summon Bug Hunter" GitHub App button, any-model support, learning from 👍/👎 feedback. |

---

## 4. What to show

### 4.1 The 🔮 Séance Report (one comment, updated in place)

Expected for the demo PR:

- **Haunting level: 💀 Possessed: do not merge** (forced by both the critical
  SQL-injection Demon and the possession attempt).
- **Spirits found** — all five planted bugs, ideally:
  - 💀 **Demon · Critical** · 🧛 Security — SQL injection in the `/kids` lookup
    (`req.query.name` interpolated into the SQL string), with a ready-made fix.
  - 👻 **Ghost · High** · 🐛 Bug — missing `await` on `verifyCostume(...)` (a
    Promise is always truthy, so the costume check is bypassed).
  - The off-by-one loop, the `kids = 0` divide-by-zero, and the hard-coded
    `CANDY_VAULT_PASSWORD` secret (high/medium).
- **🪄 Possession attempt detected** callout — the PR body's hidden instruction,
  which Bug Hunter ignored.
- **🧹 Exorcised false alarms** — at least one weak candidate the verifier pass
  dropped (the demo's "the verifier is doing real work" moment).
- Themed sections: *What this PR does*, *Haunted halls*, *Where to look closely*,
  and the footer with 👍/👎 feedback.

If all five bugs don't appear consistently, re-run (close/reopen the PR) and tune
`CONFIDENCE_THRESHOLD` in `.env` (SPEC §18).

### 4.2 Inline review comments

On the PR "Files changed" tab, inline comments land on the exact changed lines
with ` ```suggestion ```` fix blocks (only for anchored findings the verifier
approved). One invalid line makes GitHub reject the whole review, so this is a
good thing to show working — see Troubleshooting §9.3 if you hit a 422.

### 4.3 Commit status

The head commit shows a **`Bug Hunter 🎃`** status: `failure` with
"💀 Possessed: do not merge (1 demon, …)" for this PR.

### 4.4 The dashboard

Open http://localhost:3000/dashboard — a styled table of recent hunts (in
memory): repo, PR link, haunting-level badge, spirit count. Also try
`GET /api/hunts` for the raw JSON list.

---

## 5. n8n flow (if configured)

When `N8N_HUNT_WEBHOOK_URL` is set, every hunt `POST`s a `hunt.completed` event
(with the `X-BugHunter-Secret` header) to n8n. Workflow 1 ("🚨 Haunting Alert")
then:

1. Appends a row to the **Google Sheets "Hunt Ledger"**: time, repo, PR #, title,
   haunting level, demons/ghosts/bats/cobwebs, possession attempt, false alarms
   exorcised, PR link.
2. Because this PR is `possessed`, sends a **Gmail** alert:
   `🎃 Bug Hunter: PR #1 is possessed` with the top findings and a link.
3. Adds the extra line `🪄 Someone tried to possess the reviewer. Bug Hunter resisted.`
   since `possession_attempt` is true.

To demo: after the hunt, show the new Hunt Ledger row in Sheets, then the alert
email in the demo inbox. Confirm the n8n export in `/n8n/` contains no embedded
credentials before submitting.

---

## 6. "No keys on screen" checklist (SPEC §19, rule 8)

Before and during the demo:

- [ ] No `.env` file open; no terminal showing secrets.
- [ ] Server logs show only event names / repo / PR / durations — never values.
- [ ] Clean browser window or a dedicated demo profile; unrelated tabs closed.
- [ ] Alert email goes to a **demo inbox**; blur or avoid real addresses on camera.
- [ ] No n8n credential / OAuth screens on screen.
- [ ] Record a **backup demo video** in case the live run fails.

---

## 7. End-to-end testing guide (before you present)

Run this once yourself:

1. `cp .env.example .env` and fill real keys; `npm install && npm run dev`.
2. `./scripts/seed-demo.sh <you>/haunted-candy-shop` → note the PR URL.
3. `curl` `/api/hunt` with the PR URL → get back a hunt JSON record.
4. On the PR: exactly **one** Séance Report (re-runs update it, never duplicate);
   💀 Possessed; possession callout present; verifier dropped ≥1 candidate.
5. Inline comments land with no 422; commit status shows the haunting level.
6. `/dashboard` and `/api/hunts` list the hunt.
7. (n8n) Sheets row + Gmail alert appear; send a deliberately broken payload and
   confirm it is caught, not silently dropped.
8. Re-run by closing + reopening the PR (or `@bughunter hunt` if commands are on).

---

## 8. Re-running a hunt

- **Close and reopen** the PR → fires `pull_request.reopened`.
- **Command** (Step 4, if enabled): comment `@bughunter hunt` on the PR.
- **Manual:** repeat the `/api/hunt` `curl` from §2.

Each re-run **updates** the Séance Report in place and re-checks inline comments
by fingerprint, so you never get duplicates.

---

## 9. Troubleshooting

### 9.1 Gemini "model not found" / model-id error

The hunt fails with a model error when `GEMINI_MODEL_REVIEW` (or
`GEMINI_MODEL_FAST`) doesn't match an available model id.

1. List what your key can use:
   ```bash
   npm run check:models
   ```
2. In `.env`, set the model ids to a real one from that list:
   ```bash
   GEMINI_MODEL_REVIEW=gemini-2.5-flash
   GEMINI_MODEL_FAST=gemini-2.5-flash
   ```
3. Restart `npm run dev` and re-trigger.

(Note: `check:models` prints "Set `LLM_MODEL_REVIEW`…", but for the default
`google` provider the vars are `GEMINI_MODEL_REVIEW` / `GEMINI_MODEL_FAST`.)

### 9.2 `401` / `{"error":"unauthorized"}` on `/api/hunt`

The `/api/hunt` and `/api/connect` endpoints require the shared-secret header.
Make sure the header matches `N8N_SHARED_SECRET` in `.env` exactly:

```bash
curl -sS -X POST http://localhost:3000/api/hunt \
  -H 'Content-Type: application/json' \
  -H 'X-BugHunter-Secret: change-me-too' \
  -d '{"pr_url": "https://github.com/<you>/haunted-candy-shop/pull/1"}'
```

### 9.3 Inline review `422` (Unprocessable Entity)

GitHub rejects the whole review if any inline `line`/`start_line` isn't in the
diff. Bug Hunter validates and snaps positions before posting, and falls back to
the Séance Report when a finding can't be anchored. If you still see a 422:

- Confirm the head SHA hasn't changed since the hunt (a new push invalidates
  stale line numbers) — close/reopen to re-hunt the latest SHA.
- Check the server log; it reports `inline review skipped` rather than crashing.

### 9.4 Nothing happens on `npm run dev`

The server exits at boot and prints **names only** of missing/invalid variables
(e.g. `GOOGLE_GENERATIVE_AI_API_KEY is required`, `GITHUB_TOKEN is required when
GITHUB_MODE=pat`). Fill those in `.env` and restart.

### 9.5 The webhook path doesn't reach the server

- A bad signature returns `401 bad signature` — your `GITHUB_WEBHOOK_SECRET`
  doesn't match the repo webhook's secret.
- Verify smee is running and the repo webhook's Payload URL points at your smee
  channel. Check GitHub's "Recent deliveries" for delivery status.

### 9.6 `seed-demo.sh` exits with a `gh` error

- `gh auth login` first, then `gh auth status` to confirm.
- Repo already exists → the script warns and exits `0` (by design). Delete the
  repo or use a new name to re-seed from scratch.
- Commit identity missing → the script sets a local `user.name`/`user.email` in
  the throwaway worktree, so this should not bite.
