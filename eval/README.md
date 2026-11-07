# Bug Hunter eval harness

A small, deterministic benchmark for the hunt pipeline. It answers two
different questions:

- **Mock mode** — does the pipeline + scorer behave correctly end to end?
- **Live mode** — how well does the configured model find the planted bugs?

It is deliberately tiny (10 fixtures, 7 planted bugs). Treat it as a smoke
test and a wiring check, not a statistically meaningful benchmark.

## Run it

No install step and no new dependencies. From the repo root:

```bash
# Deterministic, offline, no API key. This is the CI mode.
npx tsx eval/run.ts

# Machine-readable (one JSON object on stdout).
npx tsx eval/run.ts --json

# Real model: uses getModel/generateStructured and the real prompts.
npx tsx eval/run.ts --live
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | The run completed. Low metrics still exit `0`; check the table/JSON. |
| `1` | Setup error: bad flags, invalid fixture, unreadable dataset, or `--live` with no model key. |

`--live --json` prints `{"mode":"live","error":"…"}` when credentials are
missing and exits `1`.

## What the two modes prove

### Mock mode (default)

The runner injects a fake provider into the **real** `runHunt()` pipeline. For
each buggy fixture the fake review pass returns exactly the golden findings;
the fake verifier keeps them; the fake séance pass returns a safe summary.
Clean fixtures return no findings.

This proves:

- the fixtures parse into `ChangedFile[]` correctly;
- diff filtering keeps the source files;
- the review → verify → position-resolution → confidence → cap wiring works;
- every golden line is anchorable by `resolvePosition`;
- the scorer's TP/FP/FN, precision/recall/F1, severity tolerance and
  false-positive accounting are correct.

Because the provider is a lookup table, mock mode is expected to score
`1.000 / 1.000 / 1.000`. Anything lower means a pipeline or fixture
regression. It **cannot** measure model quality or prompt quality.

### Live mode (`--live`)

The same fixtures run through the real pipeline with `getModel()` and
`generateStructured()` using `prompts/review.*`, `prompts/verify.md` and
`prompts/seance.md`.

Live mode is **diff-only**: there is no GitHub checkout, so `context` is empty
and `repoRules` is `"(none)"`. The confidence threshold is `0.5` and the
finding cap is `40`. A model can legitimately do worse here than on a real PR
where it also sees surrounding files.

Without a model key it prints a clear message and exits `1`:

```text
✗ --live has no model key: set GOOGLE_GENERATIVE_AI_API_KEY (LLM_PROVIDER=google). Mock mode needs no key: npx tsx eval/run.ts
```

Provider requirements mirror the app: Google needs
`GOOGLE_GENERATIVE_AI_API_KEY`; every other provider needs `LLM_API_KEY` and
`LLM_MODEL_REVIEW` (plus `LLM_BASE_URL` for `openai-compatible`). Keys are read
from the environment or `.env`; they are never printed.

Because `getModel()` imports the app's boot config (`src/env.ts`), live mode
also validates the normal application environment (for example the GitHub
token/webhook secret needed by the server). Mock mode imports none of that.

A per-case model/network error is reported as a failed case with its error
message, and the remaining cases still run.

## Scoring rules

Predictions are the findings the pipeline accepted (`kept`) **plus** findings it
could only report outside the diff (`lurking`). Each prediction is scored at its
resolved position (`position.start_line`) and adjusted severity
(`adjusted_severity`), not at the raw model line.

A prediction `p` matches a golden finding `g` when:

```text
same file
  AND |p.line − g.line| <= 3
  AND |rank(p.severity) − rank(g.severity)| <= 1

rank: critical=0, high=1, medium=2, low=3, nitpick=4
```

Matching is one-to-one and greedy: for each golden finding (in fixture order)
the closest unused matching prediction wins. Unmatched predictions are false
positives; unmatched golden findings are false negatives.

```text
TP = matched pairs
FP = predictions − TP
FN = golden − TP

precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2 × precision × recall / (precision + recall)

false positives per clean PR = (FP on clean cases) / (number of clean cases)
invalid-position rate        = findings without an anchor / all predictions
```

When a denominator is zero, precision and recall are defined as `1` and the
empty invalid-position rate is `0`.

Before matching, `validateFindings()` re-resolves every prediction against the
commentable-line map and drops anything without a valid anchor. Those dropped
findings are counted in the invalid-position rate, so the rate **after**
validation is exactly `0` by construction. A non-zero pre-validation rate
means the model/report produced findings that could not be placed inline.

A case passes only when it has no false positives, no false negatives and no
invalid positions. A clean case therefore passes only when it produces zero
findings.

## Dataset format

One JSON file per case in `eval/dataset/`:

```json
{
  "id": "missing-await",
  "name": "Load a user by id with an audit trail",
  "diff": "diff --git a/src/api/users.ts b/src/api/users.ts\n…",
  "golden": [
    {
      "file": "src/api/users.ts",
      "line": 4,
      "severity": "high",
      "title": "Missing await on db.findUser",
      "category": "bug"
    }
  ],
  "clean": false
}
```

Rules enforced at load time (a violation is a setup error, exit `1`):

- `id` is kebab-case and unique across the dataset.
- `clean: true` has an empty `golden` array; `clean: false` has 1–3 golden
  findings.
- `severity` is one of `critical | high | medium | low | nitpick`.
- `category` is one of the categories in `src/types.ts`.
- every `golden.file` exists in the diff, and every `golden.line` is a `+` or
  context line that `resolvePosition()` can anchor to.

Keep each diff under 60 lines.

## Adding a case

1. Copy an existing fixture in `eval/dataset/` and give it a new file name and
   `id`.
2. Write a tiny unified diff. Use real hunk headers (`@@ -a,b +c,d @@`) and
   keep the new-file line numbers accurate.
3. For each planted bug, add a golden finding whose `line` is the **new-file**
   line that should receive the inline comment. Use the line a reviewer would
   comment on, not an arbitrary line in the hunk.
4. Run `npx tsx eval/run.ts`. If you see
   `golden line is not commentable`, re-count the hunk lines.
5. Optionally run `npx tsx eval/run.ts --live` to see how the model performs on
   the new case.

## Layout

```text
eval/
  run.ts            runner, parser, mock provider, scorer, CLI
  dataset/*.json    10 fixtures (3 clean, 7 with one planted bug each)
  README.md         this file
docs/EVAL.md        runbook and metric reference
```
