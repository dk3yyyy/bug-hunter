// Pure model-config resolution (no env import, fully unit-testable).
export type LlmProvider =
  | "google"
  | "openai"
  | "anthropic"
  | "opencode"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "openai-compatible";

export interface ModelConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface ModelEnv {
  LLM_PROVIDER: LlmProvider;
  LLM_MODEL_REVIEW: string;
  LLM_MODEL_FAST: string;
  GEMINI_MODEL_REVIEW: string;
  GEMINI_MODEL_FAST: string;
  LLM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  LLM_BASE_URL: string;
}

/** Map role + env to a provider/model/apiKey. Default is Google Gemini. */
export function resolveModelConfig(
  e: ModelEnv,
  role: "review" | "verify" | "fast",
): ModelConfig {
  const isFast = role === "fast";
  if (e.LLM_PROVIDER === "google") {
    return {
      provider: "google",
      model: isFast ? e.GEMINI_MODEL_FAST : e.GEMINI_MODEL_REVIEW,
      apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY,
      baseUrl: "",
    };
  }
  const model = isFast ? (e.LLM_MODEL_FAST || e.LLM_MODEL_REVIEW) : e.LLM_MODEL_REVIEW;
  if (e.LLM_PROVIDER === "openrouter") {
    return {
      provider: "openrouter",
      model,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL || "https://openrouter.ai/api/v1",
    };
  }
  if (e.LLM_PROVIDER === "opencode") {
    return {
      provider: "opencode",
      model,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL || "https://opencode.ai/inference/openai/v1",
    };
  }
  if (e.LLM_PROVIDER === "deepseek") {
    return {
      provider: "deepseek",
      model,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL || "https://api.deepseek.com/v1",
    };
  }
  if (e.LLM_PROVIDER === "ollama") {
    return {
      provider: "ollama",
      model,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL || "http://localhost:11434/v1",
    };
  }
  // openai and anthropic use their SDK defaults; only openai-compatible honors LLM_BASE_URL.
  if (e.LLM_PROVIDER === "openai") {
    return { provider: "openai", model, apiKey: e.LLM_API_KEY, baseUrl: "" };
  }
  if (e.LLM_PROVIDER === "anthropic") {
    return { provider: "anthropic", model, apiKey: e.LLM_API_KEY, baseUrl: "" };
  }
  return { provider: e.LLM_PROVIDER, model, apiKey: e.LLM_API_KEY, baseUrl: e.LLM_BASE_URL };
}

/** Human-facing provider name for report footers ("powered by …"). */
export function providerDisplayName(p: LlmProvider): string {
  switch (p) {
    case "google":
      return "Google Gemini";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Claude";
    case "opencode":
      return "OpenCode Go";
    case "deepseek":
      return "DeepSeek";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "openai-compatible":
      return "AI";
  }
}
