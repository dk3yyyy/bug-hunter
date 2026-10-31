# Submission

Paste-ready answers for the event submission form (spec §20).

## 1. Team name & members

[TEAM NAME] — [MEMBER NAMES]

## 2. Project name

Bug Hunter 🎃

## 3. The problem & our solution

AI and human code review let bugs and security holes through, and AI reviewers are noisy.
Bug Hunter automatically hunts bugs in every PR with Gemini, verifies findings with a second
pass to cut false alarms, detects hidden "possession" instructions, and posts a
Halloween-themed Séance Report with fixes.

## 4. Google tech used & how

- **Gemini API** reviews diffs and verifies findings (structured JSON).
- **Google Sheets** logs every hunt (via n8n).
- **Gmail** alerts maintainers about haunted PRs (via n8n).

## 5. n8n: what it does

Receives each hunt result via a secured webhook, logs it to the Hunt Ledger sheet, branches
on haunting level, emails an alert for haunted/possessed PRs, and logs errors to a separate
sheet tab.

## 6. GitHub repo + n8n export

Repo: [repo URL] · workflow JSON exported to `/n8n/`.

## 7. Demo video or live demo link

[demo video link]

## 8. Setup notes

- Copy `.env.example` to `.env` and fill `GOOGLE_GENERATIVE_AI_API_KEY`,
  `GITHUB_WEBHOOK_SECRET`, and `GITHUB_TOKEN` (see `README.md`).
- Point the demo repo's GitHub webhook at `<public-url>/webhooks/github` with content type
  `application/json`, the webhook secret, and the **Pull requests** event (spec §6).
- Import the exported workflow JSON from `/n8n/` into n8n, configure the Google Sheets and
  Gmail credentials, and set the incoming webhook's shared-secret header to
  `N8N_SHARED_SECRET`.
