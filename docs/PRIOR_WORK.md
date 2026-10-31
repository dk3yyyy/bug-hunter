# Prior-work disclosure

The event rules require honest disclosure of what existed before the event and what was
built during it (spec §0 rule 5, §20). This file is that record.

## Before the event

Bug Hunter is adapted from an earlier open-source project, **`open-pr-reviewer`** — a
Next.js + Prisma AI PR reviewer. The following already existed before the hackathon:

- **GitHub connection + webhook handling**, including HMAC signature verification on the
  raw body, `x-github-delivery` dedupe, and self-loop guards (ignoring bot senders).
- **A diff engine** with per-line mapping (`{type, oldLine, newLine}`), annotated diffs, and
  commentable-line sets with `evidence_quote` snapping so findings anchor to valid diff lines.
- **Validated posting** — exactly one `createReview` per run, inline comment positions
  validated against the diff before posting, and a persistent summary comment (a hidden
  marker + update/create).
- **Structured LLM output** (Zod-validated) with repair retries.
- **Envelope-encrypted provider keys** (AES-256-GCM, AAD-bound) stored server-side only.
- **Admin-token auth** for the dashboard and API.

All of the above is prior work. Per spec §0.5 ("keep working code and adapt this design to
it"), the diff, webhook, and posting algorithms were **ported and adapted** from that repo
rather than written fresh for this event.

## Built during the event

What was actually built at **GDG Sunderland Hacktoberfest 2026 AI Hack Day**:

- The **Gemini review + verifier two-pass pipeline** — structured JSON findings from one
  Gemini call, then a skeptical second pass that keeps/drops/downgrades and calibrates
  confidence.
- **Possession-attempt (prompt-injection) detection** — stripping hidden HTML comments and
  zero-width characters from PR text and flagging instruction-like content.
- The **Halloween Séance renderer** — deterministic creature severities (💀👻🦇🕸️🍬),
  haunting levels (🌕 → 💀 Possessed), and the Séance Report template.
- The **n8n integration** — a shared-secret webhook that logs each hunt to Google Sheets and
  sends a Gmail alert for haunted/possessed PRs.
- The **`demo/` haunted-candy-shop** — a demo repo with five planted bugs and a hidden
  possession attempt in the PR description.
