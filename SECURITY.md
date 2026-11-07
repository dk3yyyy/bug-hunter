# Security policy

Bug Hunter takes security reports seriously. The full policy, including scope and
safe harbour, lives in [`docs/SECURITY.md`](docs/SECURITY.md). This root copy is
what GitHub surfaces in the repository's **Security** tab.

## Supported versions

Bug Hunter is pre-1.0 and ships from `main`. Security fixes are applied to the
latest release and `main` only.

| Version | Supported |
|---|---|
| `0.1.x` (current) | ✅ |
| `< 0.1` | ❌ |

## Reporting a vulnerability

**Do not open a public issue.** Email **security@example.com** with a description,
impact, affected version or commit, reproduction steps, and logs with secrets
removed. You can also use **Security → Advisories → Report a vulnerability** on
GitHub.

We aim to acknowledge within **3 business days**, triage within **10 business
days**, and coordinate disclosure, normally within **90 days**. There is no paid
bug bounty program at this time.

## Scope

In scope:

- webhook signature verification and delivery handling
- OAuth login, session sealing, and CSRF or session issues
- the shared-secret API and its constant-time comparison
- per-repo authorisation and user attribution
- prompt-injection detection bypasses that make Bug Hunter obey hidden instructions
- secret leakage into logs, reports, comments, statuses, or the n8n payload
- cross-repo access and unauthorised model-credit spend
- the Docker image, default configuration, and documented deployment paths

Out of scope:

- review quality, false positives, false negatives, or model confidence
- cost and latency of model calls
- vulnerabilities in GitHub, model providers, n8n, or hosting platforms
- misconfiguration the documentation warns against
- denial of service beyond the documented budgets and rate limits
- scanner output without demonstrated impact

## Safe harbour

We will not pursue legal action against researchers who test only against their
own accounts and repositories, avoid accessing other people's data, report
promptly, and do not disclose publicly before a coordinated fix.

## More detail

See [`docs/SECURITY.md`](docs/SECURITY.md) for the complete policy, including
secret-handling expectations and the disclosure timeline.
