# Importing the Bug Hunter n8n workflows

These JSON files are **importable n8n workflow exports** (n8n 1.x / 2.x "workflow" format:
root object with `name`, `nodes`, `connections`, `settings`, `pinData`).

**What is shipped vs. documented:** I shipped every node whose exact parameter shape I could
confidently reproduce. For nodes where the exact shape is version-sensitive (Google Sheets
Append/Read, Gmail Send, Google Gemini, Filter, HTTP Request), the JSON **intentionally omits the
node** and this file gives the exact config to drop it in manually — which takes seconds in the
n8n UI and can never fail to import. A workflow that imports cleanly with a documented gap is far
better than one that fails to import.

> ⚠️ **No credentials or secrets are embedded.** Every credential is a placeholder name ending in
> `— REPLACE ME`. You must attach your own in the UI. Never invent credential ids.

---

## 0. Prerequisites

- An n8n instance (n8n Cloud or `docker run -it --rm -p 5678:5678 n8nio/n8n`).
- A Google account, for the Google Sheets OAuth2 and Gmail OAuth2 credentials.
- A Google Spreadsheet with a sheet (tab) named **`Hunt Ledger`** (and a second tab **`Hunt Errors`**).
- The Bug Hunter server URL and its `N8N_SHARED_SECRET` value.

---

## 1. Workflow 1 — 🚨 Haunting Alert (`haunting-alert.json`)

This is the MUST workflow. **Shipped nodes** (import cleanly):

| Node | Type | Purpose |
|---|---|---|
| Bug Hunter Webhook | Webhook | `POST /webhook/bughunter-hunt`, Header Auth on `X-BugHunter-Secret`, responds immediately |
| Normalize Hunt Payload | Set (Edit Fields) | adds `creature_label`, `total_spirits`, `timestamp` |
| Valid Payload | IF | guard: `repo` **and** `pr_number` non-empty |
| Stop Invalid Payload | NoOp | end of the "invalid payload" (false) branch |
| Haunted or Possessed | IF | `haunting_level` == `haunted` **or** `possessed` |
| No Alert Needed | NoOp | end of the "not haunted" (false) branch |
| 2 sticky notes | Sticky Note | mark where the two documented nodes go |

The two **documented nodes** (Google Sheets Append, Gmail Send) are not in the JSON — add them by
hand:

### 1.1 Import + attach the webhook credential

1. In n8n: **Workflows → ⋯ → Import from File** → choose `haunting-alert.json` (or paste the JSON).
2. Click the **Bug Hunter Webhook** node. Under **Authentication** it is set to **Header Auth** and
   references a missing credential `BugHunter Header Auth — REPLACE ME`.
   - Create a **Header Auth** credential: **Name** = `X-BugHunter-Secret`, **Value** = your
     `N8N_SHARED_SECRET`.
   - Select it on the node.
   - If your n8n version shows this field under a different label, it is the Webhook node's
     "Authentication" option; set it to **Header Auth** and pick the credential.
3. Note the **Production URL** (bottom of the webhook node). It is `/webhook/bughunter-hunt`.
   Put the full URL into the server's `N8N_HUNT_WEBHOOK_URL` env var.

### 1.2 Insert: Google Sheets Append (between "Valid Payload" → "Haunted or Possessed")

1. Delete the existing link from **Valid Payload** (true) → **Haunted or Possessed**.
2. Add a **Google Sheets** node (search "Google Sheets"). Attach your **Google Sheets OAuth2**
   credential (create it if needed: OAuth2, full drive/spreadsheet access).
3. Configure:
   - **Resource** = `Sheet`
   - **Operation** = `Append` (Append Row)
   - **Document / Spreadsheet** = your Hunt Ledger spreadsheet (paste URL or pick from dropdown)
   - **Sheet** = `Hunt Ledger`
   - **Columns** → mapping mode **Define Below**, in this exact order:

   | # | Column name | Value |
   |---|---|---|
   | 1 | time | `{{ $json.timestamp }}` |
   | 2 | repo | `{{ $json.repo }}` |
   | 3 | PR # | `{{ $json.pr_number }}` |
   | 4 | title | `{{ $json.pr_title }}` |
   | 5 | haunting level | `{{ $json.haunting_level }}` (or `creature_label`) |
   | 6 | demons | `{{ $json.counts.critical }}` |
   | 7 | ghosts | `{{ $json.counts.high }}` |
   | 8 | bats | `{{ $json.counts.medium }}` |
   | 9 | cobwebs | `{{ $json.counts.low }}` |
   | 10 | possession attempt | `{{ $json.possession_attempt }}` |
   | 11 | false alarms exorcised | `{{ $json.false_alarms_exorcised }}` |
   | 12 | PR link | `{{ $json.pr_url }}` |

4. Open node settings (⚙) → **Continue on Fail** = **On**.
5. Connect: **Valid Payload** (true) → Google Sheets → **Haunted or Possessed**.

### 1.3 Insert: Gmail Send (on the TRUE branch of "Haunted or Possessed")

1. Add a **Gmail** node on the 🟢 true branch. Attach your **Gmail OAuth2** credential.
2. Configure:
   - **Resource** = `Message`, **Operation** = `Send`
   - **To** = maintainer email address
   - **Subject** = `🎃 Bug Hunter: PR #{{ $json.pr_number }} is {{ $json.haunting_level }}`
   - **Email type / Message type** = `HTML`
   - **HTML body** (example — adjust to taste):

     ```html
     <h2>🎃 {{ $json.creature_label }}</h2>
     <p>Bug Hunter found <b>{{ $json.total_spirits }}</b> spirits in
     <a href="{{ $json.pr_url }}">{{ $json.repo }} PR #{{ $json.pr_number }}</a>.</p>
     <ul>
       {{ $json.top_findings.map(f => `<li>${f.severity} — ${f.title} (${f.file}:${f.line})</li>`).join('') }}
     </ul>
     <p><a href="{{ $json.pr_url }}">View the Séance Report →</a></p>
     ```

3. **Possession extra line** (SPEC §16.2 step 5): when `possession_attempt` is true, include
   `🪄 Someone tried to possess the reviewer. Bug Hunter resisted.` You can add a second
   expression such as:

   ```
   {{ $json.possession_attempt ? '<p>🪄 Someone tried to possess the reviewer. Bug Hunter resisted.</p>' : '' }}
   ```

4. Open node settings (⚙) → **Continue on Fail** = **On**.

### 1.4 Optional: Discord / Slack

On the same true branch as Gmail, add a **Discord** (or **Slack**) node with:
`💀 Spirits lurk in {{ $json.repo }} PR #{{ $json.pr_number }}: "{{ $json.top_findings[0].title }}"`.
Attach its own credential. Continue on Fail = On.

### 1.5 Error handling ("handled properly")

- ✅ **Guard:** the `Valid Payload` IF already stops bad payloads before Sheets/Gmail.
- ✅ **Continue on Fail:** turn it on for the Sheets and Gmail nodes (above).
- **Error Trigger workflow** (recommended for the "+10"):
  1. Create a new workflow, add an **Error Trigger** node (`n8n-nodes-base.errorTrigger`).
  2. Add a **Google Sheets → Append** node writing to the **`Hunt Errors`** tab (columns e.g.:
     `time, workflow, node, error message`).
  3. In **Haunting Alert → workflow Settings → Error Workflow**, select that workflow.
  A failing Sheets/Gmail node then lands in Hunt Errors instead of being silently dropped.

**Acceptance:** opening the demo PR produces a Hunt Ledger row and (when haunted/possessed) a
Gmail alert; a broken payload is caught by the guard or logged to Hunt Errors.

---

## 2. Workflow 2 — 🌙 Midnight Séance (`midnight-seance.json`)

**Shipped nodes:** Schedule Trigger (**Daily at Midnight**) and Manual Trigger (**Run Séance Now**),
plus a sticky note. The digest pipeline is documented below (Sheets Get rows, Filter, Gemini, Gmail
shapes are version-sensitive).

1. Import `midnight-seance.json`.
2. Add and chain these nodes, connecting **both** triggers into the first one:
   1. **Google Sheets → Get rows** from `Hunt Ledger` (Resource `Sheet`, Operation `Read` / `Get Rows`).
   2. **Filter** (`n8n-nodes-base.filter`): keep items where the hunt time is within the last 24 h.
      E.g. condition: `finished_at` (or `time`) `>=` `{{ new Date(Date.now() - 24*60*60*1000).toISOString() }}`.
      *(If your n8n Filter shape differs, an equivalent IF + a "keep" via a Code node also works.)*
   3. **Google Gemini → Message a Model** (`n8n-nodes-base.googleGemini`). Model: a Gemini flash/Pro
      model. Prompt:

      > Using ONLY these hunt records, write a short, fun nightly séance report (max 150 words) for
      > the dev team: spirits found, scariest one, most haunted repo. Don't invent data.

   4. **Gmail → Send** the report to the team. Continue on Fail = On.

---

## 3. Workflow 3 — 🧿 Exorcism on Demand (`exorcism-on-demand.json`)

**Shipped node:** the **Form Trigger** with one required field, **Pull request URL**, and a static
completion message. The server call + polling + dynamic completion are documented below.

1. Import `exorcism-on-demand.json`.
2. Add after **Exorcism Form**:
   1. **HTTP Request** (`n8n-nodes-base.httpRequest`):
      - **Method** = `POST`
      - **URL** = `{{ $env.BUG_HUNTER_SERVER_URL }}/api/hunt` (or a hardcoded public URL)
      - **Send Headers** = On; header `X-BugHunter-Secret` = `{{ $env.N8N_SHARED_SECRET }}`
      - **Send Body** = On; content type JSON; body `{ "pr_url": "{{ $json['Pull request URL'] }}" }`
   2. **Wait / poll** `GET /api/hunts/:id` until the hunt finishes (a **Wait** node, or an
      HTTP Request + a small retry/poll loop).
   3. **Completion page showing the haunting level.** The static "form submitted" text shipped in
      the trigger is a placeholder. To show the *actual* haunting level you need n8n's **Wait →
      Respond to Webhook** pattern or custom form JavaScript — document that as a follow-up; a
      static "the hunt has been summoned" page is a fine Step-4 MVP.
3. The server endpoints `POST /api/hunt` and `GET /api/hunts/:id` must exist and validate the
   `X-BugHunter-Secret` header (see SPEC §16.4).

---

## 4. Security check — confirm no secrets in the JSON

Run this and confirm the only matches are **names**, never values:

```bash
grep -rniE 'apiKey|password|secret|token|AIza|sk-|gh[pousr]_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY' n8n/*.json
```

Expected: the header **name** `X-BugHunter-Secret` and the credential placeholder
`BugHunter Header Auth — REPLACE ME`. No actual key/token/secret **values** are present.
If anything real shows up, remove it and re-export.

---

## 5. n8n version assumptions & honest uncertainty

Built against **n8n 1.x / 2.x**. Assumptions I'm confident about:

- **Webhook** v2: `responseMode: "onReceived"` = "Respond immediately"; `path` + top-level
  `webhookId` give the `/webhook/bughunter-hunt` production URL; `authentication: "headerAuth"` +
  a `headerAuth` credential for the `X-BugHunter-Secret` check.
- **Set** v3: `assignments.assignments[]` with `id/name/value/type`; `includeOtherFields: true`.
- **IF** v2: `conditions` with `combinator` (`and`/`or`) and per-condition
  `operator { type, operation, singleValue }`.
- **NoOp** v1, **Schedule Trigger** 1.2 (`rule.interval[]` daily), **Manual Trigger** v1,
  **Form Trigger** v1 (`formFields.values[]`, `options.respondWithOptions`).
- **Sticky Note** v1 (`content`, `height`, `width`).

Uncertain (hence **documented, not shipped**): exact parameter shapes for **Google Sheets
Append/Read**, **Gmail Send**, **Google Gemini Message a Model**, **Filter**, and **HTTP Request**,
and the Form Trigger's dynamic-completion options. Drop those in by hand per the sections above and
eyeball each node's current field names in your n8n version (n8n renames resource/operation fields
between minor versions). The shipped nodes are chosen to never fail an import.

## 6. Summary — shipped vs. documented

| Workflow | Shipped in JSON | Documented in this file |
|---|---|---|
| 1 Haunting Alert | Webhook, Set, 2× IF, 2× NoOp, sticky notes | Google Sheets Append, Gmail Send, Discord/Slack, Error Trigger workflow |
| 2 Midnight Séance | Schedule Trigger, Manual Trigger, sticky note | Sheets Get rows, Filter, Gemini, Gmail |
| 3 Exorcism on Demand | Form Trigger, sticky note | HTTP Request, poll, dynamic completion |
