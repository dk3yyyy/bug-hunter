// List available model ids for the configured provider. Reads keys from .env,
// prints model NAMES only (never keys/tokens). Run: npm run check:models

const proc = process as unknown as { loadEnvFile?: (p?: string) => void };
try {
  proc.loadEnvFile?.();
} catch {
  // .env missing is fine.
}

type AnyObj = Record<string, unknown>;

const provider = process.env.LLM_PROVIDER ?? "google";
const key = process.env.LLM_API_KEY ?? "";
const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
const baseUrl = process.env.LLM_BASE_URL ?? "";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function idOf(m: unknown): string {
  if (typeof m === "object" && m !== null) {
    const o = m as AnyObj;
    if (typeof o.id === "string") return o.id;
    if (typeof o.name === "string") return o.name;
  }
  return "";
}

async function main(): Promise<void> {
  let url = "";
  const headers: Record<string, string> = {};

  switch (provider) {
    case "google": {
      if (!googleKey) fail("GOOGLE_GENERATIVE_AI_API_KEY is not set");
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${googleKey}`;
      break;
    }
    case "openai": {
      if (!key) fail("LLM_API_KEY is not set");
      url = "https://api.openai.com/v1/models";
      headers.Authorization = `Bearer ${key}`;
      break;
    }
    case "anthropic": {
      if (!key) fail("LLM_API_KEY is not set");
      url = "https://api.anthropic.com/v1/models";
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      break;
    }
    case "opencode": {
      if (!key) fail("LLM_API_KEY is not set (your OpenCode Go token)");
      url = "https://opencode.ai/inference/v1/models";
      headers.Authorization = `Bearer ${key}`;
      break;
    }
    case "deepseek": {
      if (!key) fail("LLM_API_KEY is not set (your DeepSeek key)");
      url = "https://api.deepseek.com/v1/models";
      headers.Authorization = `Bearer ${key}`;
      break;
    }
    case "openrouter": {
      url = "https://openrouter.ai/api/v1/models";
      break;
    }
    case "ollama": {
      url = "http://localhost:11434/api/tags";
      break;
    }
    case "openai-compatible": {
      if (!baseUrl) fail("LLM_BASE_URL is not set");
      url = `${baseUrl.replace(/\/$/, "")}/models`;
      headers.Authorization = `Bearer ${key || "dummy"}`;
      break;
    }
    default:
      fail(`unknown LLM_PROVIDER: ${provider}`);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) fail(`HTTP ${res.status} from ${url}`);
  const data = (await res.json()) as AnyObj;

  const raw: unknown[] = [];
  if (Array.isArray(data.data)) raw.push(...data.data);
  if (Array.isArray(data.models)) raw.push(...data.models);
  const names = [...new Set(raw.map(idOf).map((s) => s.replace(/^models\//, "")).filter(Boolean))].sort();

  console.log(`\nAvailable models for ${provider} (${names.length}):\n`);
  for (const n of names) console.log(`  ${n}`);
  if (provider === "google") {
    console.log(`\nSet GEMINI_MODEL_REVIEW / GEMINI_MODEL_FAST to one of these ids.\n`);
  } else {
    console.log(`\nSet LLM_MODEL_REVIEW / LLM_MODEL_FAST to one of these ids.\n`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
