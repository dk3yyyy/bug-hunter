// Load prompt templates from /prompts at runtime (SPEC §12).
import { readFileSync } from "node:fs";

const promptsDir = new URL("../prompts/", import.meta.url);

export function loadPrompt(name: string): string {
  return readFileSync(new URL(`${name}.md`, promptsDir), "utf8");
}
