// Model routing (SPEC §10 + multi-provider BYO key). Thin wrapper over config.ts.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "../env";
import { resolveModelConfig } from "./config";

export { resolveModelConfig } from "./config";
export type { LlmProvider, ModelConfig, ModelEnv } from "./config";

export function getModel(role: "review" | "verify" | "fast"): LanguageModel {
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
    case "ollama":
      return createOpenAI({ apiKey: cfg.apiKey || "ollama", baseURL: cfg.baseUrl })(cfg.model);
    case "openai-compatible":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
  }
}
