import { describe, expect, it } from "vitest";
import { resolveModelConfig, type ModelEnv } from "../src/llm/config";

const base: ModelEnv = {
  LLM_PROVIDER: "google",
  LLM_MODEL_REVIEW: "gpt-4o-mini",
  LLM_MODEL_FAST: "gpt-4o-mini",
  GEMINI_MODEL_REVIEW: "gemini-flash-latest",
  GEMINI_MODEL_FAST: "gemini-flash-latest",
  LLM_API_KEY: "llm-key",
  GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
  LLM_BASE_URL: "https://example.com/v1",
};

describe("resolveModelConfig", () => {
  it("defaults to google with the Gemini key and per-role model", () => {
    expect(resolveModelConfig(base, "review")).toEqual({
      provider: "google",
      model: "gemini-flash-latest",
      apiKey: "google-key",
      baseUrl: "",
    });
    expect(resolveModelConfig(base, "fast").model).toBe("gemini-flash-latest");
  });

  it("routes openai/anthropic to LLM_API_KEY", () => {
    expect(resolveModelConfig({ ...base, LLM_PROVIDER: "openai" }, "review")).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "llm-key",
      baseUrl: "",
    });
    expect(resolveModelConfig({ ...base, LLM_PROVIDER: "anthropic" }, "review").provider).toBe(
      "anthropic",
    );
  });

  it("uses OpenRouter's default base URL", () => {
    expect(resolveModelConfig({ ...base, LLM_PROVIDER: "openrouter" }, "review").baseUrl).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("uses OpenCode Go's default base URL", () => {
    expect(
      resolveModelConfig({ ...base, LLM_PROVIDER: "opencode", LLM_BASE_URL: "" }, "review").baseUrl,
    ).toBe("https://opencode.ai/inference/openai/v1");
  });

  it("uses localhost for ollama", () => {
    expect(resolveModelConfig({ ...base, LLM_PROVIDER: "ollama" }, "review").baseUrl).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("uses the custom base URL for openai-compatible", () => {
    expect(resolveModelConfig({ ...base, LLM_PROVIDER: "openai-compatible" }, "review").baseUrl).toBe(
      "https://example.com/v1",
    );
  });

  it("falls back to the review model when the fast model is empty", () => {
    expect(
      resolveModelConfig({ ...base, LLM_PROVIDER: "openai", LLM_MODEL_FAST: "" }, "fast").model,
    ).toBe("gpt-4o-mini");
  });
});
