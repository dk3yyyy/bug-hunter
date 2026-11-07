// Model routing. Thin wrapper over config.ts.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { resolveModelConfig } from "./config";

export { resolveModelConfig } from "./config";
export type { LlmProvider, ModelConfig, ModelEnv } from "./config";

/** Fallback conversation id when a caller does not supply one per hunt. */
const FALLBACK_SESSION_ID = `bh-${randomUUID()}`;

/**
 * Resolve a model. `sessionId` should be stable for one conversation (a hunt), so
 * OpenCode Go can route and cache: it rejects requests without
 * `x-opencode-session` with 400 MissingSessionID.
 */
export function getModel(
  role: "review" | "verify" | "fast",
  opts?: { sessionId?: string },
): LanguageModel {
  const cfg = resolveModelConfig(env, role);
  switch (cfg.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined })(cfg.model);
    case "openrouter":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
    case "opencode":
      return createOpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
        headers: {
          // Required by the Go endpoint (400 MissingSessionID otherwise).
          "x-opencode-session": opts?.sessionId ?? FALLBACK_SESSION_ID,
          // Go asks clients to identify themselves rather than look like a raw SDK.
          "user-agent": "bug-hunter/1.0",
        },
      })(cfg.model);
    case "deepseek":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
    case "ollama":
      return createOpenAI({ apiKey: cfg.apiKey || "ollama", baseURL: cfg.baseUrl })(cfg.model);
    case "openai-compatible":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
  }
}
