// Environment configuration, zod-validated at boot (SPEC §5).
// Never log or print any value; only names appear in error messages.

import { z } from "zod";

// Node 22+: load .env if present. Ignore if unavailable (env already set).
const nodeProc = process as unknown as { loadEnvFile?: (p?: string) => void };
try {
  nodeProc.loadEnvFile?.();
} catch {
  // .env missing is fine.
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GITHUB_MODE: z.enum(["pat", "app"]).default("pat"),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  GITHUB_TOKEN: z.string().default(""),
  GITHUB_APP_ID: z.string().default(""),
  GITHUB_APP_SLUG: z.string().default(""),
  GITHUB_PRIVATE_KEY_PATH: z.string().default("./private-key.pem"),
  // Public base URL of this server (e.g. https://bug-hunter.example.com). Used
  // by the auto-connect endpoint to register repo webhooks. Empty = auto-connect off.
  PUBLIC_URL: z.string().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z
    .string()
    .min(1, "GOOGLE_GENERATIVE_AI_API_KEY is required"),
  GEMINI_MODEL_REVIEW: z.string().default("gemini-flash-latest"),
  GEMINI_MODEL_FAST: z.string().default("gemini-flash-latest"),
  // Multi-provider (BYO model). google (default) uses the Gemini key above;
  // everything else uses LLM_API_KEY (+ LLM_BASE_URL for openai-compatible).
  LLM_PROVIDER: z
    .enum(["google", "openai", "anthropic", "openrouter", "ollama", "openai-compatible"])
    .default("google"),
  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().default(""),
  LLM_MODEL_REVIEW: z.string().default(""),
  LLM_MODEL_FAST: z.string().default(""),
  N8N_HUNT_WEBHOOK_URL: z.string().default(""),
  N8N_SHARED_SECRET: z.string().default("change-me-too"),
  MAX_FINDINGS: z.coerce.number().int().positive().default(12),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  BOT_HANDLE: z.string().default("bughunter"),
}).superRefine((v, ctx) => {
  if (v.GITHUB_MODE === "pat" && !v.GITHUB_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_TOKEN"],
      message: "GITHUB_TOKEN is required when GITHUB_MODE=pat",
    });
  }
  if (v.GITHUB_MODE === "app" && (!v.GITHUB_APP_ID || !v.GITHUB_APP_SLUG)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_APP_ID"],
      message: "GITHUB_APP_ID and GITHUB_APP_SLUG are required when GITHUB_MODE=app",
    });
  }
  if (v.LLM_PROVIDER !== "google" && !v.LLM_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LLM_API_KEY"],
      message: `LLM_API_KEY is required when LLM_PROVIDER=${v.LLM_PROVIDER}`,
    });
  }
  if (v.LLM_PROVIDER !== "google" && !v.LLM_MODEL_REVIEW) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LLM_MODEL_REVIEW"],
      message: `LLM_MODEL_REVIEW is required when LLM_PROVIDER=${v.LLM_PROVIDER}`,
    });
  }
  if (v.LLM_PROVIDER === "openai-compatible" && !v.LLM_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LLM_BASE_URL"],
      message: "LLM_BASE_URL is required when LLM_PROVIDER=openai-compatible",
    });
  }
});

export type Env = z.infer<typeof schema>;

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Names only, never values.
  const names = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`);
  console.error("Bug Hunter cannot start. Environment problem(s):\n- " + names.join("\n- "));
  process.exit(1);
}

export const env: Env = parsed.data;
