// Structured-output helpers (SPEC §10).
// Wraps the AI SDK's generateObject with retry + one-shot JSON repair.
// Never logs or includes API keys anywhere.

import { generateObject, generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";

const RETRY_MESSAGE_PATTERN = /429|503|overloaded|rate.?limit|too many/i;

/** True when an error is worth retrying (429 / 5xx / rate-limit / overloaded). */
export function isRetryable(err: unknown): boolean {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504) return true;
  if (code === "429" || code === "500" || code === "502" || code === "503" || code === "504") return true;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === "string" && RETRY_MESSAGE_PATTERN.test(message)) {
    return true;
  }
  return false;
}

/** Exponential backoff with jitter: `250 * 2^attempt + random(0..250)`, capped at 8000ms. */
export function backoffMs(attempt: number): number {
  const base = 250 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 250), 8000);
}

/**
 * Extract the first balanced `{...}` JSON object from a string, preferring a
 * fenced ```json block when present. Returns null when nothing is found.
 */
function extractJsonObject(text: string): string | null {
  // Prefer a fenced code block (```json ... ``` or ``` ... ```).
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract a JSON object from raw model text and validate it against a schema.
 * Returns `{ ok: true, value }` on success, or `{ ok: false, error }`.
 */
export function repairJson<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (json === null) {
    return { ok: false, error: "No JSON object found in the response" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `Schema validation failed: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

/**
 * Pull a short schema-validation message out of a failed generateObject error
 * (the AI SDK puts the Zod error on `cause`). Never includes model output text,
 * headers or keys; capped at 1,000 chars. Returns "" for non-validation errors.
 */
export function validationHint(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const cause = (err as { cause?: unknown }).cause;
  const pick = (e: unknown): string => {
    const m = (e as { message?: unknown } | null)?.message;
    return typeof m === "string" ? m : "";
  };
  const causeMsg = pick(cause);
  const ownMsg = pick(err);
  const msg = causeMsg || (/schema|valid|parse|json|type/i.test(ownMsg) ? ownMsg : "");
  if (!msg || isRetryable(err)) return "";
  return msg.slice(0, 1000);
}

/** Tiny local sleep; avoids importing a timers module in library code. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a validated structured object from the model.
 *
 * Up to 3 attempts with `generateObject`, retrying retryable errors (429/5xx)
 * with exponential backoff. On a non-retryable failure (or exhausted retries),
 * falls back once to a plain `generateText` call and repairs the raw JSON with
 * `repairJson`. Throws a descriptive Error if that also fails. Never includes
 * the API key or model output text in errors.
 */
export async function generateStructured<T>(opts: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  label?: string;
}): Promise<T> {
  const { model, schema, system, prompt, label } = opts;
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await generateObject({
        model,
        schema,
        system,
        prompt,
        temperature: 0.1,
        maxTokens: 8192,
      });
      return result.object;
    } catch (err) {
      lastError = err;
      if (isRetryable(err) && attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      // Non-retryable error, or retries exhausted: fall back to repair path.
      break;
    }
  }

  // One-shot repair (SPEC §10): ask for raw JSON again, including the validation
  // error from the failed attempt, then parse + validate ourselves.
  try {
    const hint = validationHint(lastError);
    const { text } = await generateText({
      model,
      system,
      prompt:
        `${prompt}\n\nReturn ONLY valid JSON matching the schema. No markdown, no prose.` +
        (hint ? `\n\nYour previous answer failed validation with this error; fix it:\n${hint}` : ""),
      temperature: 0,
    });
    const repaired = repairJson(schema, text);
    if (repaired.ok) return repaired.value;
    throw new Error(repaired.error);
  } catch (repairErr) {
    const reason =
      repairErr instanceof Error && repairErr.message ? repairErr.message : "unknown reason";
    throw new Error(
      `generateStructured${label ? ` (${label})` : ""} failed after ${maxAttempts} attempts and one repair pass: ${reason}`,
    );
  }
}
