// Context builder (SPEC §11 step 5). Changed-file content at head, truncated,
// plus 1-hop local imports (Step 3). Guidelines come from the BASE branch
// separately and are passed as repoRules.
import type { Octokit } from "@octokit/rest";
import type { ChangedFile } from "../types";
import { getFileContent } from "../github/api";

// Repo-rules files read from the PR's BASE branch (never head): a PR cannot
// change its own rules. .bughunter.md is capped at 2,000 chars; the
// concatenated rules at 6,000.
export const REPO_RULE_FILES = [".bughunter.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"] as const;
export const BUGHUNTER_MAX = 2000;
export const REPO_RULES_MAX = 6000;

export async function buildRepoRules(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseRef: string,
): Promise<string> {
  const parts: string[] = [];
  for (const path of REPO_RULE_FILES) {
    const content = await getFileContent(octokit, owner, repo, path, baseRef);
    if (!content) continue;
    const capped = path === ".bughunter.md" ? content.slice(0, BUGHUNTER_MAX) : content.slice(0, 2000);
    if (!capped.trim()) continue;
    parts.push(`### From ${path}\n${capped}`);
    if (parts.join("\n\n").length >= REPO_RULES_MAX) break;
  }
  const out = parts.join("\n\n").slice(0, REPO_RULES_MAX);
  return out.trim() ? out : "(none)";
}

const MAX_CONTEXT_FILES = 12;
const FULL_FILE_LINES = 400;
const WINDOW = 40;
const MAX_IMPORTS = 8;
const IMPORT_FILE_LINES = 300;

const REL_IMPORT_RE = /(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])(\.{1,2}\/[^'"]+)/g;

const IMPORT_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

function resolveImport(fromFile: string, imp: string): string | null {
  const base = fromFile.split("/").slice(0, -1).join("/");
  const raw = base ? `${base}/${imp}` : imp;
  // Normalize ../ and ./
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

async function importTargets(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  file: ChangedFile,
): Promise<{ path: string; content: string }[]> {
  const content = await getFileContent(octokit, owner, repo, file.filename, headSha);
  if (!content) return [];
  const targets = new Set<string>();
  for (const m of content.matchAll(REL_IMPORT_RE)) {
    const resolved = resolveImport(file.filename, m[1]);
    if (!resolved) continue;
    targets.add(resolved);
    if (targets.size >= MAX_IMPORTS) break;
  }
  const out: { path: string; content: string }[] = [];
  for (const path of targets) {
    for (const ext of IMPORT_EXTS) {
      const candidate = ext ? `${path}${ext}` : path;
      const text = await getFileContent(octokit, owner, repo, candidate, headSha);
      if (text !== null) {
        out.push({ path: candidate, content: text });
        break;
      }
    }
  }
  return out;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.filter(([s, e]) => s <= e).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export async function buildContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  files: ChangedFile[],
): Promise<string> {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const f of files.slice(0, MAX_CONTEXT_FILES)) {
    if (f.isBinary || !f.patch) continue;
    const content = await getFileContent(octokit, owner, repo, f.filename, headSha);
    if (content === null) continue;
    seen.add(f.filename);
    const lines = content.split("\n");
    if (lines.length <= FULL_FILE_LINES) {
      parts.push(`### [file] ${f.filename}\n${content}`);
    } else {
      const ranges = mergeRanges(
        f.hunks.map((h) => [Math.max(1, h.newStart - WINDOW), h.newStart + WINDOW] as [number, number]),
      );
      for (const [s, e] of ranges) {
        const slice = lines
          .slice(s - 1, e)
          .map((l, i) => `${s + i}: ${l}`)
          .join("\n");
        parts.push(`### [file] ${f.filename} (lines ${s}-${e})\n${slice}`);
      }
    }
  }
  // 1-hop local imports for the first few changed files.
  let added = 0;
  for (const f of files.slice(0, MAX_CONTEXT_FILES)) {
    if (f.isBinary || !f.patch) continue;
    for (const { path, content } of await importTargets(octokit, owner, repo, headSha, f)) {
      if (seen.has(path) || added >= MAX_IMPORTS) continue;
      seen.add(path);
      added += 1;
      const lines = content.split("\n");
      const truncated = lines.length > IMPORT_FILE_LINES;
      const body = truncated ? lines.slice(0, IMPORT_FILE_LINES).join("\n") : content;
      parts.push(
        `### [import] ${path}${truncated ? ` (first ${IMPORT_FILE_LINES} lines)` : ""}\n${body}`,
      );
    }
  }
  return parts.join("\n\n");
}
