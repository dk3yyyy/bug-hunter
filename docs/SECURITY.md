# Security policy

This is the security policy for Bug Hunter. The canonical copy is
[`/SECURITY.md`](../SECURITY.md) at the repository root; keep both in sync when
changing the policy.

## Supported versions

Bug Hunter is pre-1.0 and ships from `main`. Security fixes are applied to the
latest release and `main` only.

| Version | Supported |
|---|---|
| `0.1.x` (current) | ✅ |
| `< 0.1` | ❌ |

If you run a fork or a pinned image, rebase onto the latest `main` before
reporting a vulnerability that may already be fixed.

## Reporting a vulnerability

**Do not open a public GitHub issue for a suspected vulnerability.**

Email **security@example.com** with:

- a description of the issue and its impact
- the affected version, commit, or image tag
- reproduction steps or a proof of concept
- any relevant logs, with secrets and personal data removed
- whether you would like credit in the advisory

If you have a GitHub account, you can also use the repository's private
vulnerability reporting flow under **Security → Advisories → Report a
vulnerability**.

We aim to:

- acknowledge within **3 business days**
- provide a triage decision within **10 business days**
- agree a disclosure timeline, normally **90 days** from the report or sooner if
  a fix ships first

Please give us a reasonable window to fix the issue before publishing details.
We will credit reporters who want credit.

There is no paid bug bounty program at this time.

## Scope

### In scope

- Webhook authentication and signature verification
- OAuth login, session sealing, and session fixation or CSRF issues
- The shared-secret API (`X-BugHunter-Secret`) and its comparison
- Per-repo authorisation and user attribution (`src/tenancy.ts`)
- Prompt-injection and possession detection bypasses that cause Bug Hunter to
  obey hidden instructions
- Secret leakage into logs, comments, commit statuses, reports, or the n8n
  payload
- Cross-repo access: acting on a repository the caller is not authorised for
- Unauthorised spend of model credits through the public API
- The Docker image, default configuration, and documented deployment paths
- Vulnerabilities in Bug Hunter's own code and dependencies

### Out of scope

- Incorrect review output, false positives, false negatives, or model quality
- The confidence score being an estimate rather than a calibrated probability
- Cost or latency of model calls
- Vulnerabilities in GitHub, a model provider, n8n, Render, Railway, or another
  third-party service — report those upstream
- Misconfiguration that the documentation warns against, such as exposing an
  instance without `ALLOWED_GITHUB_LOGINS` or publishing `.env`
- Denial of service through intentionally enormous inputs beyond the documented
  budgets and rate limits
- Social engineering, physical access, or spam
- Automated scanner output without a demonstrated impact

## Safe harbour

We will not pursue legal action against researchers who:

- test only against their own accounts and repositories
- avoid accessing, modifying, or exfiltrating other people's data
- stop testing and report promptly after discovering a vulnerability
- do not publicly disclose before a coordinated fix

## Secret handling expectations

- Never include real tokens, keys, or private keys in a report.
- Use a disposable repository and a dedicated model key when reproducing.
- If a secret may have been exposed, rotate it first, then report.

## Related documentation

- [Architecture](ARCHITECTURE.md) — authentication modes and trust boundaries
- [Self-hosting](SELF-HOSTING.md) — deployment hardening
- [Configuration](CONFIGURATION.md) — required secrets and safe defaults
