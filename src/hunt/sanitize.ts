/**
 * Instruction-like words found inside hidden content (HTML comments), indicating
 * a "possession attempt" aimed at the AI reviewer (SPEC §17 / §11 step 4).
 * Deliberately narrow: bare words like "reviewer" or "ai" matched too much
 * (e.g. `<!-- ai-generated with cursor -->` forced a do-not-merge verdict).
 */
export const POSSESSION_WORDS =
  /(ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?|approve\s+(this\s+)?(pr|pull\s+request|for\s+merge)|report\s+no\s+issues?|no\s+issues?\s+(found|here)|safe\s+to\s+merge|say\s+.*safe\s+to\s+merge|disregard\s+(all\s+|any\s+)?(previous|prior|above|these)?\s*(instructions?|review)|override\s+.*(instructions?|review)|system\s+prompt|reveal\s+(secrets?|config)|exfiltrat|bypass\s+.*review)/i;

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
 * Strip HTML comments and invisible/bidi characters from PR text.
 *
 * - `hidden`: the (trimmed, invisible-stripped) contents of any HTML comments.
 * - `possession`: true when hidden fragments match instruction patterns, or
 *   when visible text directly addresses an AI reviewer with instructions.
 * - `clean`: the text with comments and invisible characters removed.
 */
export function sanitizeText(text: string): {
  clean: string;
  hidden: string[];
  possession: boolean;
} {
  const hidden: string[] = [];

  let clean = text.replace(/<!--[\s\S]*?-->/g, (match) => {
    const content = stripInvisible(match.slice(4, -3)).trim();
    if (content) hidden.push(content);
    return "";
  });

  clean = stripInvisible(clean);

  const possession = hidden.some((h) => POSSESSION_WORDS.test(h)) || VISIBLE_INSTRUCTION_RE.test(clean);

  return { clean, hidden, possession };
}
