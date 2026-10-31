// Load prompt templates from /prompts at runtime. Cached at startup.
// Placeholders use {{name}} and are filled with fillTemplate, which throws
// if any placeholder is left unfilled — never send "{{...}}" to Gemini.
import { readFileSync } from "node:fs";

const promptsDir = new URL("../prompts/", import.meta.url);

const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const text = readFileSync(new URL(`${name}.md`, promptsDir), "utf8");
  cache.set(name, text);
  return text;
}

/** All four LLM prompt templates, loaded once. */
export function loadAllPrompts(): {
  system: string;
  user: string;
  verify: string;
  seance: string;
} {
  return {
    system: loadPrompt("review.system"),
    user: loadPrompt("review.user"),
    verify: loadPrompt("verify"),
    seance: loadPrompt("seance"),
  };
}

/**
 * Replace {{key}} placeholders with vars. Throws when a key is missing or
 * when any {{...}} placeholder survives the fill.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (!(k in vars)) {
      missing.add(k);
      return m;
    }
    return vars[k];
  });
  if (missing.size > 0) {
    throw new Error(`missing template vars: ${[...missing].join(", ")}`);
  }
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`unfilled placeholder in prompt: ${leftover[0]}`);
  }
  return out;
}

/** Test-only: clear the cached prompts so file edits take effect. */
export function resetPromptCache(): void {
  cache.clear();
}
