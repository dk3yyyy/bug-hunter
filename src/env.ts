// Environment configuration, zod-validated at boot.
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
  // PEM file on disk. Used when GITHUB_PRIVATE_KEY is empty (local dev / Docker
  // volume). Hosts that only expose env vars (Render, Railway, Fly secrets) set
  // GITHUB_PRIVATE_KEY instead, since they cannot mount a file.
  GITHUB_PRIVATE_KEY_PATH: z.string().default("./private-key.pem"),
  // Inline PEM content (takes precedence over GITHUB_PRIVATE_KEY_PATH). Literal
  // "\n" sequences are normalised at use, so a single-line env var works too.
  GITHUB_PRIVATE_KEY: z.string().default(""),
  // Public base URL of this server (e.g. https://bug-hunter.example.com), as
  // reachable from GitHub. Used by the auto-connect endpoint to register repo
  // webhooks. Empty = the /connect form asks for a tunnel/deployment URL.
  PUBLIC_URL: z.string().default(""),
  // GitHub repo URL for the landing page "View the repo" buttons. Empty = keep "#".
  LANDING_REPO_URL: z.string().default(""),
  // Public URL of a hosted app. When set, the landing "Connect a repo" button
  // links to <APP_URL>/connect (same rule as the GitHub Pages build). Empty =
  // this server's own /connect.
  APP_URL: z.string().default(""),
  // "Connect with GitHub" OAuth App. Both empty = the login button is hidden and
  // the shared-secret path keeps working exactly as before, so existing
  // deployments and the test suite boot unchanged.
  GITHUB_OAUTH_CLIENT_ID: z.string().default(""),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().default(""),
  // Optional explicit callback override. Empty = derive from PUBLIC_URL/APP_URL,
  // which is what a Render deploy wants (one less thing to misconfigure).
  GITHUB_OAUTH_REDIRECT_URI: z.string().default(""),
  // Key for sealing the session cookie. Empty = derived from N8N_SHARED_SECRET so
  // a deployment that only sets that still gets working logins.
  SESSION_SECRET: z.string().default(""),
  // Comma-separated GitHub logins allowed to sign in. Empty = anyone GitHub
  // authenticates, whose own token then limits what they can actually touch.
  ALLOWED_GITHUB_LOGINS: z.string().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  GEMINI_MODEL_REVIEW: z.string().default("gemini-flash-latest"),
  GEMINI_MODEL_FAST: z.string().default("gemini-flash-latest"),
  // Multi-provider (BYO model). google (default) uses the Gemini key above;
  // everything else uses LLM_API_KEY (+ LLM_BASE_URL for openai-compatible).
  LLM_PROVIDER: z
    .enum(["google", "openai", "anthropic", "opencode", "deepseek", "openrouter", "ollama", "openai-compatible"])
    .default("google"),
  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().default(""),
  LLM_MODEL_REVIEW: z.string().default(""),
  LLM_MODEL_FAST: z.string().default(""),
  // Postgres connection string for hunt history. Empty = in-memory (dev/test).
  DATABASE_URL: z.string().default(""),
  N8N_HUNT_WEBHOOK_URL: z.string().default(""),
  N8N_SHARED_SECRET: z.string().default("change-me-too"),
  MAX_FINDINGS: z.coerce.number().int().positive().default(12),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  // Month-to-date LLM spend cap in USD. 0 = unlimited (the default).
  MONTHLY_COST_CAP_USD: z.coerce.number().min(0).default(0),
  // Run deterministic linters (gitleaks/semgrep/eslint) where a checkout exists.
  LINT_ENABLED: z.string().default(""),
  BOT_HANDLE: z.string().default("bughunter"),
}).superRefine((v, ctx) => {
  if (v.N8N_SHARED_SECRET === "change-me-too") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["N8N_SHARED_SECRET"],
      message: "N8N_SHARED_SECRET still has the documented default — set a random secret (min 16 chars)",
    });
  } else if (v.N8N_SHARED_SECRET.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["N8N_SHARED_SECRET"],
      message: "N8N_SHARED_SECRET must be at least 16 characters",
    });
  }
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
  if (v.LLM_PROVIDER === "google" && !v.GOOGLE_GENERATIVE_AI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GOOGLE_GENERATIVE_AI_API_KEY"],
      message: "GOOGLE_GENERATIVE_AI_API_KEY is required when LLM_PROVIDER=google",
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

/**
 * The public origin the hosting platform assigns to this service. Render sets
 * RENDER_EXTERNAL_URL, Railway sets RAILWAY_PUBLIC_DOMAIN (a bare host, no
 * scheme). Used only when PUBLIC_URL is empty, so a first deploy works without
 * someone hand-copying the URL — the missing PUBLIC_URL was what made
 * POST /api/connect return 400 on a fresh instance.
 */
function platformPublicUrl(): string {
  const render = process.env.RENDER_EXTERNAL_URL?.trim();
  if (render) return render.replace(/\/+$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) {
    const withScheme = railway.startsWith("http") ? railway : `https://${railway}`;
    return withScheme.replace(/\/+$/, "");
  }
  return "";
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Names only, never values.
  const names = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`);
  console.error("Bug Hunter cannot start. Environment problem(s):\n- " + names.join("\n- "));
  process.exit(1);
}

const data = parsed.data;
if (!data.PUBLIC_URL.trim()) {
  const derived = platformPublicUrl();
  if (derived) data.PUBLIC_URL = derived;
}

export const env: Env = data;
