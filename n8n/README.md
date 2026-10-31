# n8n workflows (bonus +10)

This folder holds the n8n workflow exports required for submission (SPEC §16, §21).
The `.json` files go here after you build the workflows in the n8n UI and use
**Workflow → Export**. Confirm the JSON contains no credentials or secrets before committing.

## Workflow 1: 🚨 Haunting Alert (MUST) — export as `haunting-alert.json`

> **Fastest path:** import `haunting-alert.full.json` (all nodes wired, including Google Sheets,
> Gmail and the Hunt Errors branch) plus `hunt-errors.json` (Error Trigger workflow). Attach the
> three credentials, set the spreadsheet ID and the Gmail address, set the error workflow, then
> re-export over `haunting-alert.json`. If the full file won't import on your n8n version, fall
> back to the manual steps in `IMPORT.md`.

Nodes, in order:

1. **Webhook** — `POST /webhook/bughunter-hunt`. Add a **Header Auth** credential that checks
   the `X-BugHunter-Secret` header against `N8N_SHARED_SECRET`. Respond immediately.
2. **Set / Edit Fields** — normalize: `haunting_level` (string), `creature_label` (map the level
   to its emoji/title), `total_spirits` = critical+high+medium+low, `finished_at` formatted.
3. **Google Sheets → Append row** to sheet **"Hunt Ledger"**, columns in order:
   `time, repo, PR #, title, haunting level, demons, ghosts, bats, cobwebs, possession attempt, false alarms exorcised, PR link`.
   Runs for every hunt (this is the "real work" node).
4. **IF** `haunting_level` is `haunted` **or** `possessed`:
   - **Gmail → Send** to the maintainer. Subject: `🎃 Bug Hunter: PR #{{pr_number}} is {{haunting_level}}`.
     HTML body: haunting level, top findings list, link to the PR.
   - (Optional) **Discord / Slack** message: `💀 Spirits lurk in {{repo}} PR #{{pr_number}}: "{{top_findings[0].title}}"`.
5. **IF** `possession_attempt` is `true` → add `🪄 Someone tried to possess the reviewer. Bug Hunter resisted.` to the email (and Discord if used).
6. **Error handling** (this is what the judges mean by "handled properly"):
   - Turn on **"Continue on Fail"** for the Sheets and Gmail nodes.
   - Add an **Error Trigger** workflow (or an error branch) that appends failures to a
     **"Hunt Errors"** tab on the same sheet.
   - Guard with an **IF** node before Sheets/Gmail: stop when `repo` or `pr_number` is empty.

**Acceptance:** opening the demo PR produces a Hunt Ledger row and a Gmail alert; a broken
payload lands in Hunt Errors rather than being silently dropped.

## Workflow 2: 🌙 Midnight Séance (Step 4) — export as `midnight-seance.json`

**Schedule Trigger** (daily + Manual Trigger for demo) → **Google Sheets → Get rows** from Hunt
Ledger → **Filter** last 24 h → **Google Gemini → Message a Model** (prompt: "Using ONLY these
hunt records, write a short, fun nightly séance report (max 150 words) for the dev team: spirits
found, scariest one, most haunted repo. Don't invent data.") → **Gmail → Send**.

## Workflow 3: 🧿 Exorcism on Demand (Step 4) — export as `exorcism-on-demand.json`

**n8n Form Trigger** (field "Pull request URL") → **HTTP Request** `POST <server>/api/hunt` with
`X-BugHunter-Secret` and `{ "pr_url": … }` → poll `GET /api/hunts/:id` → **Form completion** page
showing the haunting level. (Requires the two `/api/hunt` endpoints from Step 4.)

---

Bug Hunter calls the webhook with header `X-BugHunter-Secret: <N8N_SHARED_SECRET>` and this body
(SPEC §16.1):

```json
{
  "event": "hunt.completed",
  "hunt_id": "h_01J…",
  "repo": "your-user/haunted-candy-shop",
  "pr_number": 3,
  "pr_title": "Add candy distribution endpoint",
  "pr_url": "https://github.com/your-user/haunted-candy-shop/pull/3",
  "haunting_level": "possessed",
  "counts": { "critical": 1, "high": 2, "medium": 1, "low": 0 },
  "top_findings": [{ "severity": "critical", "title": "SQL injection in /kids lookup", "file": "src/candy.ts", "line": 9 }],
  "possession_attempt": true,
  "false_alarms_exorcised": 2,
  "finished_at": "2026-10-31T14:04:12Z"
}
```

## Workflow 4: 🕰️ Witching Hour (3 AM ghost narrator)

**Schedule Trigger** (3 AM + Manual Trigger for demo) → build `facts` from open
bugs → **Google Gemini → Message a Model** with the prompt in
[`prompts/witching-hour.md`](../prompts/witching-hour.md) (paste the file content
into the node; `{{ JSON.stringify($json.facts) }}` is an n8n expression) →
**Gmail → Send** `{subject, story}`. The prompt file is the reference copy; the
node paste is the live copy.
