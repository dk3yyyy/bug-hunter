# Cost accounting

Bug Hunter estimates what each hunt costs in USD so a self-hosted instance can
stay inside a monthly budget. The accounting is **local and offline**: token
counts come from the model provider's response, prices come from the table
below, and no billing API is called.

## What is measured

A hunt normally makes three model calls — review, verify, and a short Séance
summary (the fast model) — plus any retries or JSON-repair passes. Every call is
counted separately.

Each call reports token usage:

| Field | Meaning |
|---|---|
| `inputTokens` | Prompt tokens billed at the input rate |
| `outputTokens` | Completion tokens billed at the output rate |
| `cachedInputTokens` | Prompt tokens served from the provider's prompt cache, when reported |

`cachedInputTokens` is treated as a **subset of `inputTokens`** (the OpenAI and
Google convention). Cost is calculated as:

```
uncached = inputTokens - cachedInputTokens
cost = (uncached × inputPerM + cached × cachedInputPerM + outputTokens × outputPerM) / 1,000,000
```

When a provider does not publish (or the table does not know) a cache-read
price, cached tokens are charged at the full input rate, which overestimates
rather than undercounts.

`sumUsage()` adds the usage of several calls into one `TokenUsage` for the hunt;
`costOf()` returns `null` for a model with no known price, so the caller can
display tokens without a dollar figure instead of inventing one. `formatUsd()`
and `formatTokens()` produce the dashboard strings (`$0.0042`, `$1.23`,
`12,345`, `1.2M`).

## Price table

Approximate public **list** prices, USD per 1M tokens, as of **2026-11**. They
are rough: treat any estimate as a guide, not an invoice.

| Provider | Model family (prefix match) | Input | Output | Cached input |
|---|---|---:|---:|---:|
| `google` | `gemini-2.5-pro` | 1.25 | 10.00 | 0.31 |
| `google` | `gemini-2.5-flash` | 0.30 | 2.50 | 0.075 |
| `google` | `gemini-2.5-flash-lite` | 0.10 | 0.40 | 0.025 |
| `google` | `gemini-2.0-flash` | 0.30 | 2.50 | 0.075 |
| `google` | `gemini-flash-latest` (alias for 2.5 Flash) | 0.30 | 2.50 | 0.075 |
| `anthropic` | `claude-sonnet-4*`, `claude-3-7-sonnet*` | 3.00 | 15.00 | 0.30 |
| `anthropic` | `claude-opus*` | 15.00 | 75.00 | 1.50 |
| `anthropic` | `claude-haiku*` | 1.00 | 5.00 | 0.10 |
| `openai` | `gpt-5*` (not mini/nano) | 1.25 | 10.00 | 0.125 |
| `openai` | `gpt-5-mini*` | 0.25 | 2.00 | 0.025 |
| `openai` | `gpt-5-nano*` | 0.05 | 0.40 | 0.005 |
| `openai` | `gpt-4o*` (not mini) | 2.50 | 10.00 | 1.25 |
| `openai` | `gpt-4o-mini*` | 0.15 | 0.60 | 0.075 |
| `openai` | `o3*` | 2.00 | 8.00 | 0.50 |
| `deepseek` | `deepseek-chat` | 0.28 | 0.42 | 0.028 |
| `deepseek` | `deepseek-reasoner` | 0.28 | 0.42 | 0.028 |
| `ollama` | any (local inference) | 0 | 0 | 0 |

**Matching rules**

- The model id is lowercased; a `provider/` or `provider:` prefix is stripped
  (`anthropic/claude-sonnet-4-5`, `openrouter:google/gemini-2.5-flash`).
- The **longest matching prefix** wins, so `gemini-2.5-flash-lite` is not
  mistaken for `gemini-2.5-flash`, and `gpt-4o-mini` is not mistaken for
  `gpt-4o`. Dated and preview suffixes (`-20250514`, `-preview-05-20`) resolve
  to their family.
- `openrouter`, `opencode`, and `openai-compatible` mirror **all** families,
  because those endpoints can route any of the models above.
- Anything else is unknown and unpriced (`null`); it contributes tokens to the
  dashboard but no dollars. Provider-specific ids such as `deepseek-v4-pro`
  currently have no public list price here.

## Caveats

- **Prices change.** Providers adjust list prices and deprecate models without
  notice; the table is a dated snapshot, and self-hosters on negotiated or
  subscription rates will see different numbers.
- **Cached discounts vary.** Cache-read pricing differs per provider, per
  model, and sometimes per cache lifetime. Where a rate is listed it is the
  common published cache-read price; otherwise cached tokens cost the same as
  input.
- **Ollama is free** at the point of use. Electricity and hardware are real
  costs, but they are not token costs and are not counted here.
- **Estimates only.** Prices exclude taxes, minimum charges, and subscription
  fees (for example an OpenCode Go plan is billed monthly, not per token). Use
  the provider's invoice as the source of truth.

## Monthly cap

Set `MONTHLY_COST_CAP_USD` to a positive dollar amount to enable a monthly
budget. The value is compared with **month-to-date spend**; `0` (or any
non-positive value) means **unlimited**.

The server refuses new hunts when month-to-date spend is **greater than or
equal to** the cap (`overCap()`), and posts an error status explaining why:

> Monthly budget reached ($5.00 of $5.00). Raise MONTHLY_COST_CAP_USD or wait
> for next month.

Hunts already running are allowed to finish; the cap gates new work only.

## Dashboard

Each hunt records its own usage and estimated spend, using the same prices as
`costOf()`. The dashboard shows the per-hunt spend (and token counts) next to
the hunt, plus the month-to-date total used for the cap check. Hunts with an
unknown model show token counts and an unpriced marker rather than a misleading
`$0.00`.
