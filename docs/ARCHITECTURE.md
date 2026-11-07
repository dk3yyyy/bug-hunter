# Architecture

Bug Hunter is one Node process: a Hono HTTP server, an in-process work queue, and
a pure hunt pipeline. It has no external queue. Postgres is optional and used
only to persist hunt history; the review path does not depend on it. This
document describes the moving parts and the path a pull request takes through
them.

## System overview

```
                      ┌─────────────────────────────────────────────┐
 GitHub webhook ─────►│  Hono server (src/server.ts)                │
 POST /api/hunt ─────►│  routes · auth · dedupe · queue · tenancy   │
 /connect form ──────►│                                             │
                      └───────────────┬─────────────────────────────┘
                                      │ runHuntForPr()
                                      ▼
                      ┌─────────────────────────────────────────────┐
                      │  hunt pipeline (src/hunt/pipeline.ts)       │
                      │  sanitize → filter → review → verify →      │
                      │  anchor → rank → summary                    │
                      └───────┬───────────────────────┬─────────────┘
                              │                       │
                 GitHub API ◄─┘                       └─► model provider
              (diff, files, rules,                          (review,
               comments, status)                             verify, séance)
                                      │
                                      ▼
                      ┌─────────────────────────────────────────────┐
                      │  renderers (src/render/)                    │
                      │  Séance Report · inline comments · status   │
                      └───────────────┬─────────────────────────────┘
                                      │
                                      ├─► GitHub: one summary comment,
                                      │           one review with inline
                                      │           comments, commit status
                                      ├─► Postgres (optional): hunt history
                                      └─► n8n webhook (optional)
```

## Request ingress

| Source | Entry point | Authentication |
|---|---|---|
| GitHub webhook | `POST /webhooks/github` | HMAC signature (`GITHUB_WEBHOOK_SECRET`) |
| Manual hunt | `POST /api/hunt` | GitHub session cookie or `X-BugHunter-Secret`; `"async": true` returns a hunt id immediately |
| Connect a repo | `POST /api/connect` | GitHub session cookie or `X-BugHunter-Secret` |
| Browser pages | `/`, `/connect`, `/dashboard`, `/summoned` | none |
| OAuth login | `/auth/github` → `/auth/github/callback` | OAuth state cookie |
| Health | `/health` | none |

The server verifies webhook signatures before parsing a payload, rejects
duplicate `x-github-delivery` ids with a bounded set, and ignores events sent by
bots or by Bug Hunter itself (identified by a hidden marker in its own comments).
Dependabot and renovate PRs are skipped, as are drafts and closed PRs.

Work is serialised through `p-queue` with concurrency 2. A per-PR lock prevents
two hunts of the same PR from racing and double-posting. A sliding-window limiter
allows 10 hunts per PR per hour, and `@bughunter` commands have an additional
five-minute per-PR cooldown. On a `synchronize` event, hunts are debounced by
60 seconds so a burst of pushes costs one review.

## Hunt pipeline

The pipeline (`src/hunt/pipeline.ts`) is deliberately free of network calls. The
server injects the review, verify, and summary model functions, which keeps the
core unit-testable.

1. **Sanitize PR text.** `src/hunt/sanitize.ts` strips HTML comments, zero-width
   and bidi control characters, soft hyphens, and Unicode tag characters
   (ASCII smuggling). Hidden content is retained for the report. Instruction-like
   hidden text, or visible text that directly addresses an AI reviewer, marks a
   **possession attempt**.
2. **Filter changed files.** `src/hunt/filters.ts` drops lockfiles, vendored
   dependencies, build output, minified files, source maps, binaries, and
   generated files. Remaining files are ordered source → tests → config → docs
   and capped at 40.
3. **Build context.** `src/diff/parse.ts` parses patches into hunks with old and
   new line numbers. `src/diff/annotate.ts` renders an annotated diff.
   `src/hunt/context.ts` adds the changed files at head and a bounded set of
   1-hop local imports, plus repository rules from the base branch.
4. **Apply the input budget.** `src/hunt/budget.ts` splits roughly 30k tokens
   (105,000 characters) between the diff and the context, trimming context first.
5. **Review.** The model returns structured JSON, validated by Zod
   (`src/hunt/review.ts`, `src/types.ts`). Invalid output is repaired or retried.
   Findings are assigned ids and capped at 40.
6. **Verify.** A second call (`prompts/verify.md`) keeps, drops, downgrades, or
   recalibrates each candidate (`src/hunt/verify.ts`). A verifier failure does not
   kill the hunt: candidates are kept unverified, marked as such in the report, and
   receive no one-click fixes.
7. **Anchor findings.** `src/diff/commentable.ts` snaps each finding to a valid
   changed line using its evidence quote. Findings that cannot be anchored move to
   "Lurking outside the diff": reported, but not counted in the haunting level and
   not posted inline.
8. **Rank and cap.** Findings below `CONFIDENCE_THRESHOLD` or downgraded to
   nitpick are recorded as exorcised. The rest are sorted by severity and
   confidence, capped at `MAX_FINDINGS`, and limited to three per file.
9. **Summarise.** A third, usually cheaper model call writes the Séance summary.
   Failure degrades to a visible "summary unavailable" message rather than a blank
   section.
10. **Render and post.** `src/render/seance.ts` builds the report,
    `src/render/inline.ts` builds the review payload, and `src/render/status.ts`
    builds the commit status. The server posts one summary comment (updated in
    place via a hidden marker), one review with anchored inline comments, and the
    status. `src/render/theme.ts` and `prompts/voice.json` hold all styling and
    wording. The finished record is saved through `src/store.ts` (Postgres when
    `DATABASE_URL` is set, otherwise memory).

The haunting level is deterministic:

| Condition | Level | Commit status |
|---|---|---|
| Any critical finding, or a possession attempt | 💀 possessed | failure |
| Any high finding | 👻 haunted | neutral |
| Any medium finding | 🦇 restless | neutral |
| Low or nitpick findings only | 🕯️ whispers | success |
| No findings | 🌕 clear | success |

## Modules

| Module | Responsibility |
|---|---|
| `src/server.ts` | Hono routes, auth, sessions, queueing, dedupe, rate limits, tenancy, GitHub posting |
| `src/env.ts` | Zod-validated environment at boot; platform URL derivation |
| `src/auth.ts` | GitHub OAuth web flow: authorize URL, code exchange, refresh, user lookup |
| `src/session.ts` | Sealed session cookies (AES-256-GCM) |
| `src/tenancy.ts` | Which user authorised each repo, sealed in process memory |
| `src/store.ts` | Hunt history: Postgres when `DATABASE_URL` is set, in-memory fallback otherwise |
| `src/connect.ts` | Webhook URL rules and auto-connect helpers |
| `src/github/` | Octokit clients, GitHub App auth and install flow, REST helpers, pure webhook filters |
| `src/diff/` | Patch parsing, line mapping, annotated diff, commentable-line resolution |
| `src/hunt/` | Sanitisation, filtering, context, budgets, review, verify, pipeline, summary |
| `src/llm/` | Provider configuration, model construction, structured-output retries |
| `src/render/` | Séance Report, inline review, commit status, theme, HTML pages |
| `src/prompts.ts`, `src/voice.ts` | Prompt and voice-template loading with placeholder filling |
| `src/security.ts` | HMAC verification and secret scrubbing |
| `src/n8n.ts` | Fire-and-forget `hunt.completed` delivery |
| `src/types.ts` | Shared domain types and Zod schemas |

## Authentication and authorisation

Three credentials are deliberately separate.

### GitHub access

- **PAT mode** (`GITHUB_MODE=pat`) uses `GITHUB_TOKEN` for all GitHub calls.
- **App mode** (`GITHUB_MODE=app`) mints installation-scoped tokens from
  `GITHUB_APP_ID` and a private key. Installation webhooks maintain the connected
  repo list.

### Human login (optional)

`GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` enable "Connect with
GitHub". The OAuth App uses `read:user` and `repo` scopes. The session cookie is
sealed with `SESSION_SECRET` (or a key derived from `N8N_SHARED_SECRET`), and
OAuth access tokens are refreshed silently when GitHub issues expiring tokens.
`ALLOWED_GITHUB_LOGINS` is an optional allowlist that should be set on any
publicly reachable instance.

### Machine access

`N8N_SHARED_SECRET` guards `POST /api/hunt`, `POST /api/connect`, the hunt JSON
endpoints, and the outgoing n8n webhook. Comparison is constant-time over SHA-256
hashes. This path is intended for scripts and automation.

### Whose token posts the review

When a signed-in user connects a repo, Bug Hunter remembers that user for the repo
in `src/tenancy.ts`, sealed with the session key. Later webhook hunts for that repo
use the user's token, so GitHub enforces their permissions and the review is
attributed to them. The mapping is process memory: a restart clears it and those
repos fall back to the server token until reconnected. Hunt history can live in
Postgres, but repo-user mappings deliberately stay in process memory, sealed and
never written to the database.

## State

State is bounded, and only hunt history can be durable:

| State | Storage and bound |
|---|---|
| Hunt history | Postgres when `DATABASE_URL` is set; otherwise in memory, last 500 records |
| Dashboard and `/api/hunts` | 50 most recent records from the same store |
| Seen webhook deliveries | process memory, 5,000 ids |
| Per-PR rate windows | process memory, one hour |
| Per-repo user mappings | process memory, sealed, process lifetime |
| In-flight hunts | process memory, one per PR |
| Queue concurrency | 2 |

With `DATABASE_URL`, `src/store.ts` creates a `hunts` table and index on first
use if they do not exist. Each row stores the full hunt record as JSONB plus a
`finished_at` timestamp. Without it, the same interface is backed by a bounded
in-memory map.

A restart always clears rate-limit windows and repo-user mappings, so reconnecting
repos restores correct attribution. Hunt history survives a restart only when
`DATABASE_URL` is set; the in-memory fallback does not.

## Deployment

The production image is `node:22-slim` running `npx tsx src/server.ts`. The
`Dockerfile` installs dev dependencies because `tsx` and TypeScript are used at
runtime.

- **Docker:** build and run with environment variables.
- **Render:** `render.yaml` creates a Docker web service, generates the webhook
  and shared secrets, and prompts for GitHub and model credentials.
- **Railway:** `railway.json` uses the same Dockerfile and health check.

`PUBLIC_URL` is derived from `RENDER_EXTERNAL_URL` or `RAILWAY_PUBLIC_DOMAIN` when
it is not set, so a first deploy can register webhooks without copying a URL.
The server exposes `/health` for platform health checks.

Set `DATABASE_URL` to a Postgres connection string to persist hunt history.
The `hunts` table is created automatically on first use. Leave it empty for the
in-memory store. The bundled Render blueprint does not provision a database; add
a Render Postgres instance and set `DATABASE_URL` yourself if you want one.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Verifier call fails | Hunt continues with unverified findings and a visible banner; no one-click fixes |
| Séance summary call fails | Hunt continues; summary section states it is unavailable |
| Review call fails | Hunt fails with a scrubbed cause returned to the caller and logged |
| n8n is down | Delivery times out after 5 seconds and is ignored; the hunt is unaffected |
| Postgres is unreachable | The review is still posted, but saving the hunt record fails; the manual API returns an error after posting, and the webhook path logs the failure |
| Inline comment rejected (422) | Server logs the skip and still posts the Séance Report |
| Webhook instance asleep | GitHub does not retry; the delivery is lost |
| Duplicate delivery | Ignored by delivery id |
| Hunt already running for a PR | `409 HUNT_IN_PROGRESS` |
| PR over rate limit | `429 RATE_LIMITED` |

Secrets are scrubbed from log lines and outgoing n8n payloads by
`src/security.ts`. Error messages are truncated and never include configuration
values.

## Related docs

- [Configuration](CONFIGURATION.md)
- [Self-hosting](SELF-HOSTING.md)
- [Quickstart](QUICKSTART.md)
