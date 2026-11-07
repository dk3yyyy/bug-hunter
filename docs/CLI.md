# CLI

Bug Hunter also runs as a local command-line tool. The CLI takes a diff from
your git working copy and runs the **same pipeline** as the server — prompt
templates, filters, verifier pass and the séance summary — but it prints the
result instead of commenting on a pull request.

No GitHub token is needed. Only the model provider you configure.

## Running it

The package exposes a `bughunter` binary (declared in `package.json`) and a
`cli` script:

```bash
npx tsx src/cli.ts --help   # from a checkout
npm run cli -- --help       # same thing
npx bughunter --help        # via the package bin (tsx shebang)
```

The CLI is ESM + TypeScript; it is meant to be run with `tsx`, as the rest of
the project is.

## Commands

### `bughunter review`

Run a review on local git changes.

```bash
bughunter review                              # git diff --staged (default)
bughunter review --base main                  # git diff main...HEAD
bughunter review --commit HEAD~1              # git show HEAD~1
bughunter review --format json                # full HuntResult as JSON
bughunter review --format prompt-only         # compact list for a coding agent
bughunter review --model anthropic:claude-sonnet-4-5
bughunter review --rules docs/REVIEW-RULES.md
```

| Flag | Meaning |
|---|---|
| `--staged` | Review staged changes (`git diff --staged`). **Default.** |
| `--base <ref>` | Review `<ref>...HEAD` (`git diff <ref>...HEAD`). |
| `--commit <sha>` | Review one commit (`git show <sha>`). |
| `--format text` | Human-readable report. **Default.** |
| `--format json` | The full `HuntResult` object as JSON. |
| `--format prompt-only` | One line per finding: `file:line severity title — fix`. |
| `--model <provider:model>` | Override `LLM_PROVIDER` and the review model for all three passes. |
| `--rules <path>` | Use one rules file instead of the automatic lookup. |

Only one change source may be given. Arguments are passed to git as an array
(never through a shell), and refs/SHAs may not start with `-`.

`prompt-only` is the intended hand-off format for an agent:

```
src/auth/session.ts:42 critical Session token written to the log — remove the token from the log line
src/api/users.ts:88 high Missing authorization check — load the caller and compare owner ids
```

### `bughunter init`

Writes a `.bughunter.md` template into the current repository. An existing file
is never overwritten — the command prints where it is and leaves it alone.

```bash
bughunter init
```

### `bughunter config validate [path]`

Validates a rules file. Defaults to `.bughunter.md` in the current directory.

```bash
bughunter config validate
bughunter config validate docs/REVIEW-RULES.md
```

Checks:

- the file exists (and is a file, not a directory),
- it is not empty,
- it is at most **2000 characters** (the same cap the server applies).

Exit code `0` and `✓ OK: …` on success; exit code `1` and `✗ …` with the reason
otherwise.

### `--help`

```bash
bughunter --help
bughunter review --help
bughunter init --help
bughunter config --help
```

## Configuration

Model settings are read directly from the environment (a `.env` in the current
directory is loaded when present). Server-only variables such as `GITHUB_TOKEN`
and `GITHUB_WEBHOOK_SECRET` are **not** required and are never read.

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `google` | `google`, `openai`, `anthropic`, `opencode`, `deepseek`, `openrouter`, `ollama`, `openai-compatible` |
| `LLM_API_KEY` | empty | Key for every provider except Google |
| `LLM_MODEL_REVIEW` | empty | Review/verify model (required for non-Google providers) |
| `LLM_MODEL_FAST` | `LLM_MODEL_REVIEW` | Model for the séance summary |
| `GEMINI_MODEL_REVIEW` | `gemini-flash-latest` | Google review model |
| `GEMINI_MODEL_FAST` | `GEMINI_MODEL_REVIEW` | Google summary model |
| `GOOGLE_GENERATIVE_AI_API_KEY` | empty | Key when `LLM_PROVIDER=google` |
| `LLM_BASE_URL` | provider default | Override the endpoint (`openai-compatible` requires it) |
| `MAX_FINDINGS` | `12` | Cap on posted findings (pipeline caps at 40) |
| `CONFIDENCE_THRESHOLD` | `0.7` | Minimum verified confidence |

`--model provider:model` overrides the provider, the review model and the fast
model, so a single flag is enough for a one-off run:

```bash
LLM_API_KEY=... bughunter review --model deepseek:deepseek-chat
```

## Repo rules

Without `--rules`, the CLI reads the same filenames the server uses, from the
working tree, in order: `.bughunter.md`, `AGENTS.md`, `CLAUDE.md`,
`.cursorrules`. `.bughunter.md` is capped at 2000 characters and the combined
rules at 6000.

The server reads rules from the PR's **base branch** so a PR cannot change its
own rules. A local working copy has no base-branch notion, so the CLI reads what
is on disk. Use `--rules <path>` when you want an explicit file.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Review completed — **including when findings were reported**. Also `--help`, `init`, and a valid `config validate`. |
| `1` | Usage or configuration error (bad flag, unknown command, invalid rules file, missing API key/model, git failure). |
| `2` | The model call failed (network, auth/credit error, schema failure after retry + repair). |

Findings never fail a build by themselves; parse the `--format json` output or
grep `prompt-only` if you want CI to gate on severity.

## Limitations

- Inline comments, commit statuses and the GitHub review body are **not**
  produced — the CLI only prints. `src/render/*` is untouched.
- There is no GitHub API access: repo rules and context come from the local
  working tree, so files deleted in the diff are simply absent from context.
- The pipeline's `verifierFailed` degradation applies here too: if the verifier
  call fails, findings are printed unverified and the report says so.
- A real model run requires a provider key. `--format text` still needs the
  model; only `--help`, `init` and `config validate` are offline.

## Tests

`tests/cli.test.ts` covers argument parsing, the two text formats and the local
unified-diff parser. It uses fixtures only — no git, no network, no model.

```bash
npx vitest run tests/cli.test.ts
npx tsc --noEmit
```
