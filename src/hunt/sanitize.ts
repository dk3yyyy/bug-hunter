/**
 * Instruction-like words found inside hidden content (HTML comments), indicating
 * a "possession attempt" aimed at the AI reviewer (SPEC §17 / §11 step 4).
 * Deliberately narrow: bare words like "reviewer" or "ai" matched too much
 * (e.g. `<!-- ai-generated with cursor -->` forced a do-not-merge verdict).
 */
export const POSSESSION_WORDS =
  /(ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?|ignore\s+(all\s+)?issues?|ai\s+reviewers?\b[\s\S]{0,80}?\b(approve|ignore|merge|report)|approve\s+(this\s+)?(pr|pull\s+request|for\s+merge)|report\s+no\s+issues?|no\s+issues?\s+(found|here)|safe\s+to\s+merge|say\s+.*safe\s+to\s+merge|disregard\s+(all\s+|any\s+)?(previous|prior|above|these)?\s*(instructions?|review)|override\s+.*(instructions?|review)|system\s+prompt|reveal\s+(secrets?|config)|exfiltrat|bypass\s+.*review)/i;

/**
 * Strict reviewer-directed imperatives for VISIBLE text (title, body). Visible
 * prose must name the reviewer to count — "there are no issues here" is benign.
 */
export const VISIBLE_INSTRUCTION_RE =
  /(ai\s+(code\s+)?reviewers?\s*:|ignore\s+(all\s+)?(previous|prior)\s+instructions|do\s+not\s+report\s+(any\s+|no\s+)?(issues?|bugs?|problems?)|report\s+no\s+issues?)/i;

/** Zero-width, bidi-control, BOM and soft-hyphen characters stripped from input. */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g;

/** Strip invisible/bidi characters (titles and diffs ride raw into prompts). */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, "");
}

/** True when visible text directly instructs an AI reviewer. */
export function scanVisible(text: string): boolean {
  return VISIBLE_INSTRUCTION_RE.test(stripInvisible(text));
}

/**
 * Unicode "tag" characters (U+E0000–U+E007F). They render as nothing, and
 * U+E0020–U+E007E map 1:1 onto printable ASCII, so they are a known way to
 * smuggle invisible instructions into text ("ASCII smuggling").
 */
const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;

/** Decode a run of Unicode tag characters into the ASCII text it hides. */
function decodeTagRun(run: string): string {
  let out = "";
  for (const ch of run) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

/**
 * Strip HTML comments, invisible/bidi characters and Unicode tag characters
 * from PR text (title or body).
 *
 * - `hidden`: the (trimmed, invisible-stripped) contents of any HTML comments,
 *   plus any text decoded from Unicode tag characters.
 * - `possession`: true when hidden fragments match instruction patterns, or
 *   when visible text directly addresses an AI reviewer with instructions.
 * - `clean`: the text with comments, tag characters and invisible characters
 *   removed.
 */
export function sanitizeText(text: string): {
  clean: string;
  hidden: string[];
  possession: boolean;
} {
  const hidden: string[] = [];

  // Tag-character text: decode it, keep it for analysis, remove it.
  let clean = text.replace(TAG_RUN_RE, (run) => {
    const decoded = decodeTagRun(run).trim();
    if (decoded) hidden.push(decoded);
    return "";
  });

  clean = clean.replace(/<!--[\s\S]*?-->/g, (match) => {
    const content = stripInvisible(match.slice(4, -3)).trim();
    if (content) hidden.push(content);
    return "";
  });

  clean = stripInvisible(clean);

  const possession = hidden.some((h) => POSSESSION_WORDS.test(h)) || VISIBLE_INSTRUCTION_RE.test(clean);

  return { clean, hidden, possession };
}
