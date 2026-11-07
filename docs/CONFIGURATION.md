# Configuration

Bug Hunter reads configuration from environment variables and from an optional
`.bughunter.md` file in the reviewed repository. This page is the reference for
both.

The environment is validated at boot. If a required value is missing or invalid,
the server exits and prints the **names** of the offending variables, never their
values.

## Environment variables

### Server

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `PUBLIC_URL` | for webhooks | derived | Public base URL GitHub can reach. Derived from `RENDER_EXTERNAL_URL` or `RAILWAY_PUBLIC_DOMAIN` when empty |
| `APP_URL` | no | empty | Hosted instance URL used by the landing page's connect button |
| `LANDING_REPO_URL` | no | empty | Repository URL for the landing page's "View the repo" buttons |
| `DATABASE_URL` | no | empty | Postgres connection string for hunt history. Empty uses the in-memory store |

`PUBLIC_URL` must be an `https://` URL reachable from GitHub. `localhost` works
only with a tunnel.

`DATABASE_URL` is optional. When set, hunt history is stored in Postgres and the
`hunts` table is created on first use; when empty, the last 500 hunts are kept in
memory. See [Postgres](SELF-HOSTING.md#postgres).

### GitHub access

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_MODE` | no | `pat` | `pat` or `app` |
| `GITHUB_TOKEN` | in `pat` mode | empty | Fine-grained PAT or classic token |
| `GITHUB_APP_ID` | in `app` mode | empty | GitHub App id |
| `GITHUB_APP_SLUG` | in `app` mode | empty | GitHub App slug, used for the install URL |
| `GITHUB_PRIVATE_KEY_PATH` | no | `./private-key.pem` | PEM file for App mode |
| `GITHUB_PRIVATE_KEY` | no | empty | Inline PEM contents; takes precedence over the path. Literal `\n` is accepted |
| `GITHUB_WEBHOOK_SECRET` | **yes** | — | HMAC secret for `POST /webhooks/github`; must match the repository webhook |

**PAT permissions:**

- Contents: read
- Pull requests: read & write
- Issues: read & write
- Commit statuses: read & write
- Metadata: read
- Webhooks: read & write (only for one-click `/api/connect`)

A classic token needs `repo`, or `admin:repo_hook` for webhook management alone.

**GitHub App permissions and events:** Pull requests, Issues, and Commit statuses
read & write; Contents and Metadata read. Subscribe to Pull request, Issue
comment, and Installation. Set the Setup URL to `<PUBLIC_URL>/summoned`.

### GitHub login (optional)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | no | empty | OAuth App client id |
| `GITHUB_OAUTH_CLIENT_SECRET` | no | empty | OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | no | derived | Override the callback URL; default is `<PUBLIC_URL>/auth/github/callback` |
| `SESSION_SECRET` | recommended | derived from `N8N_SHARED_SECRET` | Seals session and tenancy cookies. Changing it signs everyone out |
| `ALLOWED_GITHUB_LOGINS` | recommended on public instances | empty | Comma-separated GitHub logins allowed to sign in |

Both OAuth values must be set to enable the login button. With neither set, the
button is hidden and the shared-secret path still works.

An OAuth App needs the `read:user` and `repo` scopes and a callback of
`<PUBLIC_URL>/auth/github/callback`.

### API secret

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `N8N_SHARED_SECRET` | **yes** | — | Guards `POST /api/hunt`, `POST /api/connect`, the hunt JSON endpoints, and the outgoing n8n webhook. Minimum 16 characters |

The documented placeholder value is rejected at boot. Generate one:

```bash
python3 -c "import secrets; print(secrets.token_hex(24))"
```

Clients send it as `X-BugHunter-Secret`. Comparison is constant-time.

### Model provider

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | no | `google` | One of `google`, `openai`, `anthropic`, `opencode`, `deepseek`, `openrouter`, `ollama`, `openai-compatible` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for `google` | empty | Google AI Studio key |
| `GEMINI_MODEL_REVIEW` | no | `gemini-flash-latest` | Review and verify model for Gemini |
| `GEMINI_MODEL_FAST` | no | `gemini-flash-latest` | Summary model for Gemini |
| `LLM_API_KEY` | for non-Google | empty | Provider key |
| `LLM_BASE_URL` | for `openai-compatible` | provider default | Override the API base URL |
| `LLM_MODEL_REVIEW` | for non-Google | empty | Review and verify model id |
| `LLM_MODEL_FAST` | no | falls back to review | Summary model id |

A hunt normally makes three model calls: review, verify, and a short Séance
summary. The fast model is used for the summary. Using a cheaper or faster model there lowers
cost and latency without changing the findings.

### Hunt behaviour

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MAX_FINDINGS` | no | `12` | Maximum posted findings. Values above 40 are clamped to the schema limit |
| `CONFIDENCE_THRESHOLD` | no | `0.7` | Minimum adjusted confidence for a finding to be posted, `0`–`1` |
| `BOT_HANDLE` | no | `bughunter` | Mention used for PR commands, e.g. `@bughunter hunt` |

Each file is also limited to three posted findings regardless of
`MAX_FINDINGS`. The per-PR limit of 10 hunts per hour and the one-hunt-per-PR
lock are fixed in the server, not configurable.

### n8n integration (optional)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `N8N_HUNT_WEBHOOK_URL` | no | empty | Receives a `hunt.completed` POST after every finished hunt |

Delivery is fire-and-forget with a 5-second timeout. A failed delivery never
breaks a hunt. The request is signed with `X-BugHunter-Secret`.

## Providers

Provider defaults when `LLM_BASE_URL` is empty:

| `LLM_PROVIDER` | Default base URL | Notes |
|---|---|---|
| `google` | Google AI SDK | Uses `GOOGLE_GENERATIVE_AI_API_KEY` and `GEMINI_MODEL_*` |
| `anthropic` | Anthropic SDK | Claude models |
| `openai` | OpenAI SDK | OpenAI models |
| `opencode` | `https://opencode.ai/inference/go/openai/v1` | OpenCode Go subscription. Set `LLM_BASE_URL=https://opencode.ai/inference/openai/v1` for Console pay-as-you-go |
| `deepseek` | `https://api.deepseek.com/v1` | |
| `openrouter` | `https://openrouter.ai/api/v1` | |
| `ollama` | `http://localhost:11434/v1` | Local models. `LLM_API_KEY` may be any non-empty value |
| `openai-compatible` | none | `LLM_BASE_URL` is required |

Examples:

```dotenv
# Claude
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL_REVIEW=claude-sonnet-4-5

# OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL_REVIEW=gpt-4o

# OpenCode Go
LLM_PROVIDER=opencode
LLM_API_KEY=<Go API key>
LLM_MODEL_REVIEW=deepseek-v4-pro

# DeepSeek
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-...
LLM_MODEL_REVIEW=deepseek-chat

# Local Ollama
LLM_PROVIDER=ollama
LLM_API_KEY=ollama
LLM_MODEL_REVIEW=qwen2.5-coder:14b

# Any OpenAI-compatible endpoint
LLM_PROVIDER=openai-compatible
LLM_API_KEY=...
LLM_BASE_URL=https://your-endpoint/v1
LLM_MODEL_REVIEW=your-model-id
```

List valid ids for the configured provider:

```bash
npm run check:models
```

### OpenCode Go and `402`

If OpenCode Go returns `402 Insufficient account funds`, check the base URL
before topping up. The subscription is served from `/inference/go/...`, while
`/inference/openai/...` is the pay-as-you-go Console balance. Bug Hunter defaults
to the subscription endpoint.

## Repository rules

Add `.bughunter.md` to the repository's default branch. Bug Hunter reads it from
the **base branch of the pull request**, so a PR cannot change the rules that
review it.

```markdown
# 🎃 Bug Hunter rules

## Always check
- Every new API route has an error path.
- Database access goes through the repository layer.
- New environment variables are documented in `.env.example`.

## Conventions we accept (don't flag)
- We use `any` in generated bindings under `src/gen/`.
- Test fixtures contain intentionally weak credentials.

## Extra attention (paths or areas)
- `src/billing/` — money paths need extra care.
- `src/auth/` — token handling.
```

Rules can add checks or suppress accepted patterns. They **cannot** switch off
security findings.

Bug Hunter also reads, in this order:

1. `.bughunter.md` — capped at 2,000 characters
2. `AGENTS.md`
3. `CLAUDE.md`
4. `.cursorrules`

All rules together are capped at 6,000 characters. Missing files are ignored.
If no rules exist, the prompt receives `(none)`.

## Report voice and prompts

| File | Contents |
|---|---|
| `prompts/voice.json` | Every posted string: creature names, haunting levels, section headings, inline-comment templates, status text |
| `prompts/review.system.md` | Reviewer system prompt |
| `prompts/review.user.md` | Reviewer user prompt |
| `prompts/verify.md` | Verifier pass |
| `prompts/seance.md` | Summary pass |
| `prompts/witching-hour.md` | Additional review guidance |

Change wording in `voice.json` without touching code. Placeholders use
`{{name}}` syntax; a missing placeholder fails loudly rather than sending an
unfilled template to the model. Prompts are loaded from disk at hunt time, so a
restart is not required after editing them in a local development run.

## Validation rules summary

The server refuses to start when:

- `GITHUB_WEBHOOK_SECRET` is empty
- `N8N_SHARED_SECRET` is the documented placeholder or shorter than 16 characters
- `GITHUB_MODE=pat` and `GITHUB_TOKEN` is empty
- `GITHUB_MODE=app` and `GITHUB_APP_ID` or `GITHUB_APP_SLUG` is empty
- `LLM_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` is empty
- `LLM_PROVIDER` is not Google and `LLM_API_KEY` or `LLM_MODEL_REVIEW` is empty
- `LLM_PROVIDER=openai-compatible` and `LLM_BASE_URL` is empty
- `CONFIDENCE_THRESHOLD` is outside `0`–`1`

## Related docs

- [Self-hosting](SELF-HOSTING.md)
- [Architecture](ARCHITECTURE.md)
- [Quickstart](QUICKSTART.md)
