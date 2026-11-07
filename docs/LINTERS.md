# Local linters

Deterministic, local checks that run before the model sees a PR. They catch the
things a model is bad at: known secret patterns, injected/unsafe constructs, and
lint-rule violations. Results are normalized into `LintFinding`s and treated as
**advisory** context — they never block a merge on their own.

Implementation: [`src/lint/index.ts`](../src/lint/index.ts) (runner) and
[`src/lint/tools.ts`](../src/lint/tools.ts) (exec, probe, parsers, path helpers).

## Where they run today

- **CLI:** `LINT_ENABLED=true bughunter review --staged` runs the installed tools
  against the local checkout, prints a one-line summary to stderr, and passes the
  findings to the review prompt as an advisory `DETERMINISTIC SCANNER FINDINGS`
  block.
- **Hosted server:** not wired. A GitHub webhook delivers a diff but no checkout,
  so semgrep/eslint have nothing to read; running gitleaks alone on patch text is
  possible but is not enabled yet. Hosted hunts receive `(none)` for that block.

## When they run (wiring contract)

This module is deliberately self-contained: it does **not** read environment
variables and is not started by the server on its own. The wiring layer is
responsible for:

1. Gating on `LINT_ENABLED=true`. When the variable is unset or `false`, do not
   call `runLinters` at all (zero child processes, zero latency).
2. Building the input from the PR's changed files:

   ```ts
   interface ChangedInput {
     path: string;   // repo-relative path from the PR files API
     patch: string;  // unified-diff patch for that file
     content?: string; // full post-change content when available
   }
   ```

3. Calling `await runLinters(files, { cwd, timeoutMs, maxFindings })` and passing
   the resulting `findings` to the reviewer as untrusted advisory context.
   `toolsRun` and `skipped` can be surfaced in logs or the report footer.

`runLinters` never throws. A missing binary, missing config, crash, unusable
output or timeout ends up in `skipped` with a short reason; the other tools keep
running.

## What runs

| Tool | Required | Command (exact argv) | Default severity / category |
|---|---|---|---|
| gitleaks | binary on `PATH` | `gitleaks detect --no-git --pipe --report-format json --report-path -` | every hit: `critical` / `security` |
| semgrep | binary on `PATH` | `semgrep --json --quiet --config p/default --error <changed paths...>` | ERROR → `high`, WARNING → `medium`, INFO → `low`; `security` when the rule id contains `security`, `injection` or `secret`, otherwise `bug` |
| eslint | binary on `PATH` **and** a config file at repo root | `eslint --format json --no-error-on-unmatched-pattern <changed paths...>` | 2 → `medium`, 1 → `low`; always `maintainability` |

Details:

- **gitleaks** receives the concatenated patches on stdin, each preceded by
  `+++ b/<path>`. `--no-git` means it scans only that input, not the repository
  history. The matched `Secret` from the JSON report is never read into a
  finding; `detail` says `gitleaks matched rule <RuleID>` and both the rule id
  and description are passed through `scrubSecrets` from `src/security.ts`.
- **semgrep** runs only on the changed paths. `--error` makes it exit `1` when it
  finds something, which is expected and not treated as a failure. First runs
  fetch `p/default` from the semgrep registry; if that fails (offline host,
  blocked egress), the run is skipped with the exit code and **not retried**.
- **eslint** is skipped unless `eslint.config.*` or `.eslintrc*` exists at the
  repo root. Exit `1` means "lint errors found" and is expected; only unusable
  JSON is a skip. A fatal parse error inside ESLint is reported as
  `ESLint: parse error`.

## Paths and output

- Tool paths are made repo-relative (strip `cwd`, leading `./`, and gitleaks'
  `a/`/`b/` diff prefixes).
- Findings for files outside the changed set are dropped.
- Duplicate `(file, line, title)` findings are collapsed.
- The rest are sorted by severity (`critical` > `high` > `medium` > `low`), then
  file, then line.
- **Cap:** at most `maxFindings` (default **30**) survive, and the cap is applied
  *after* sorting, so the most severe findings are the ones kept. The wiring
  layer can raise or lower the cap per call.

## Install hints

```bash
# gitleaks (macOS)
brew install gitleaks
# or grab a release binary: https://github.com/gitleaks/gitleaks/releases

# semgrep
pipx install semgrep
# or: brew install semgrep ; or: python -m pip install semgrep

# eslint (in the repo being reviewed, so its config and plugins resolve)
npm install --save-dev eslint
```

A tool that is absent is simply reported as `not installed`; there is no hard
dependency on any of them.

## Limits and sandboxing

- One exec per tool, arguments passed as an array (never a shell string).
- Per-tool timeout: `timeoutMs`, default **20 000 ms**. A timeout kills the child
  and is reported as `timed out after <n>ms`.
- No retries: a crash, timeout or failed config fetch is final for that run.
- gitleaks scans stdin only (`--no-git --pipe`), so it does not walk the repo or
  its history.
- semgrep may write its own cache under the user's home directory and may fetch
  rules from the registry on first use. For strict privacy set
  `SEMGREP_SEND_METRICS=off` in the worker environment.
- eslint reads the repo's config and the changed files. `cwd` must be the
  checked-out PR head so relative imports and config resolve correctly.

## Privacy

In this step the patches and file contents are written only to the stdin/argv of
local child processes on the machine running the reviewer. They are **not** sent
to the LLM, n8n, GitHub, or any other service by this module. (semgrep's optional
registry fetch retrieves rules; it does not upload the PR source.) Secret matches
are scrubbed before findings leave the module, so a leaked key cannot be repeated
back into a report, comment or log.

## Advisory, not authoritative

Lint findings are context, not a verdict. They can be false positives, stale
rules, or style preferences that do not matter for the PR. The reviewer may cite,
merge or ignore them, and nothing here should be used to block a merge by itself.
