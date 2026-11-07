# Evaluation

`eval/run.ts` scores the hunt pipeline against a small seeded-bug dataset in
`eval/dataset/`. The harness has two modes: an offline mock mode that proves the
scoring and pipeline wiring, and a live mode that measures the configured model.

```bash
npx tsx eval/run.ts            # mock: deterministic, offline, no key
npx tsx eval/run.ts --json     # mock: one JSON object
npx tsx eval/run.ts --live     # real model (needs a provider key)
```

See `eval/README.md` for the fixture format and the exact scoring formula. This
page is the operator's reference: what to run, what the numbers mean, and what
the harness does not cover.

## Dataset at a glance

| | Count |
|---|---|
| Fixtures | 10 |
| Clean (no bugs) | 3 |
| Buggy | 7 |
| Planted bugs (golden findings) | 7 |

Planted categories: missing `await`, off-by-one, SQL injection via string
interpolation, division by zero, null dereference, hardcoded secret and a
read-modify-write race. Effectively all fixtures are tiny TypeScript files with
diffs under 60 lines.

The expected mock result is:

```text
Precision: 1.000   Recall: 1.000   F1: 1.000
False positives per clean PR: 0.00 (0 FP over 3 clean cases)
Invalid positions: 0 of 7 predictions (0.0%; 0 after validateFindings)
```

## Mock mode vs live mode

| | Mock | Live (`--live`) |
|---|---|---|
| Provider | Fixture lookup table | `getModel()` + `generateStructured()` |
| Network | None | Required |
| API key | Not needed | Required |
| Prompts | Real prompt templates | Real prompt templates |
| Pipeline | Real `runHunt()` | Real `runHunt()` |
| Measures | Wiring, anchoring, scoring | Model quality |
| Expected score | Perfect | Varies by model |

Mock mode injects a fake `HuntDeps` whose review pass returns the golden
findings and whose verifier keeps them. All pipeline stages still run, so a
break in filtering, position resolution, severity handling, capping or the
scorer shows up as a score below 1.0. It cannot detect a prompt or model
regression.

Live mode replaces the fake provider with the real one. It is **diff-only**:
there is no repository checkout, so `context` is empty and `repoRules` is
`"(none)"`. It uses a `0.5` confidence threshold and a `40` finding cap. Model
or network errors are reported per case and do not stop the run.

When live mode has no key it exits `1` with a setup message and no stack trace:

```text
✗ --live has no model key: set GOOGLE_GENERATIVE_AI_API_KEY (LLM_PROVIDER=google). Mock mode needs no key: npx tsx eval/run.ts
```

With `--json` the same failure is emitted as
`{"mode":"live","error":"…"}`. Key requirements match the app: Google uses
`GOOGLE_GENERATIVE_AI_API_KEY`; other providers use `LLM_API_KEY` and
`LLM_MODEL_REVIEW`, plus `LLM_BASE_URL` for `openai-compatible`. Since
`getModel()` imports `src/env.ts`, live mode also requires the normal app
environment to validate (for example `GITHUB_WEBHOOK_SECRET`/`GITHUB_TOKEN`).
Mock mode needs none of it.

## Metric definitions

Predictions are `kept` + `lurking` findings, scored at the resolved position and
adjusted severity. A prediction matches a golden finding when the file is the
same, the line is within ±3, and the severity is at most one rung away
(`critical > high > medium > low > nitpick`). Matching is greedy and
one-to-one; the closest line wins.

| Metric | Definition | Reading |
|---|---|---|
| Precision | `TP / (TP + FP)` | Of what it reported, how much was real |
| Recall | `TP / (TP + FN)` | Of what was planted, how much it found |
| F1 | `2PR / (P + R)` | Balance of the two |
| FP / clean PR | `FP on clean cases / clean cases` | Noise on PRs with nothing wrong |
| Invalid-position rate | unanchored findings / all predictions | Pre-validation anchoring health |

Zero-denominator conventions: precision and recall are `1`; an empty
invalid-position rate is `0`.

`validateFindings()` re-resolves every prediction against the commentable-line
map and removes findings with no anchor before matching. The invalid-position
rate is therefore always exactly `0` **after** validation; the printed rate is
measured **before** it, which is the useful number. Values above zero mean the
model pointed at lines that cannot carry an inline comment (or the report had
to demote them to "Lurking outside the diff").

Per-case pass/fail is strict: no false positives, no false negatives and no
invalid positions. Clean cases must stay silent.

## Adding a fixture

1. Add `eval/dataset/<id>.json` with `{ id, name, diff, golden, clean }`.
2. Use a real unified diff with accurate hunk headers; keep it under 60 lines.
3. `clean` must be `true` with an empty `golden`, or `false` with 1–3 golden
   findings.
4. Every `golden.line` is a **new-file** line that appears as a `+` or context
   line in the diff. The harness checks this before running.
5. Run the mock mode. A non-commentable golden line is a setup error and exits
   `1`, naming the file and line.

Example golden entry:

```json
{ "file": "src/db/query.ts", "line": 4, "severity": "critical", "title": "SQL injection via template interpolation", "category": "security" }
```

## CI

```bash
npx tsx eval/run.ts --json
```

The JSON payload is deterministic (no timestamps), so it can be diffed or
asserted in a job. Exit `0` means the harness ran; assert on the metrics if a
low score should fail the build. Exit `1` is a setup failure, not a metric
failure.

## Limitations

- Ten tiny fixtures do not support claims about real-world precision/recall.
- The dataset is diff-only; missing-context bugs are out of scope.
- Mock mode is a self-consistency check of the harness, not of the model.
- The live run depends on provider availability and can be slow or costly; run
  it manually, not on every pull request.
