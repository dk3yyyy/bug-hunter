import type { ChangedFile } from "../types";

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "poetry.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
]);

const BUILD_DIRS = new Set(["dist", "build", "vendor", "node_modules"]);

const GENERATED_RE = /(auto-?generated|@generated|DO NOT EDIT)/i;

/**
 * Priority used to sort eligible files before the 40-file cap (SPEC §11 step 2):
 * source (1) > tests (2) > config (3) > docs (4).
 */
function priority(f: ChangedFile): number {
  const name = f.filename;
  const lower = name.toLowerCase();

  // docs
  if (/\.(md|mdx)$/i.test(name)) return 4;

  // config
  if (/\.(json|ya?ml|toml)$/i.test(name) || lower.endsWith(".config")) return 3;

  // tests (by directory segment or *.test.* / *.spec.* filename)
  const segments = name.split("/");
  if (
    segments.some((s) => ["test", "tests", "spec", "specs", "__tests__"].includes(s)) ||
    /\.(test|spec)\.[^.]+$/.test(lower)
  ) {
    return 2;
  }

  // everything else is source
  return 1;
}

/** Return a skip reason for a file, or null when it should be hunted. */
function skipReason(f: ChangedFile): string | null {
  const base = f.filename.split("/").pop() ?? f.filename;

  if (LOCKFILES.has(base)) return "lockfile";
  if (f.filename.split("/").some((s) => BUILD_DIRS.has(s))) return "build/vendor/dependency directory";
  if (/\.min\.[^.]+$/.test(base)) return "minified file";
  if (/\.map$/.test(base)) return "source map";
  if (f.isBinary) return "binary file";
  if (!f.patch) return "no patch (binary/large)";

  const lines = f.patch
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (lines.some((l) => GENERATED_RE.test(l))) return "generated file";

  return null;
}

/**
 * Filter changed files: drop lockfiles, build/vendor dirs, minified/source-map
 * files, binaries, and auto-generated files; then order the survivors by
 * priority and cap at 40 (SPEC §11 step 2).
 */
export function filterFiles(files: ChangedFile[]): {
  kept: ChangedFile[];
  skipped: { path: string; reason: string }[];
} {
  const eligible: ChangedFile[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const f of files) {
    const reason = skipReason(f);
    if (reason) skipped.push({ path: f.filename, reason });
    else eligible.push(f);
  }

  eligible.sort((a, b) => priority(a) - priority(b));

  const kept: ChangedFile[] = [];
  for (const f of eligible) {
    if (kept.length >= 40) {
      skipped.push({ path: f.filename, reason: "over 40-file limit" });
    } else {
      kept.push(f);
    }
  }

  return { kept, skipped };
}
