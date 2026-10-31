/**
 * Words that, found inside hidden content (HTML comments / invisible text),
 * indicate a "possession attempt" aimed at the AI reviewer (SPEC §17 / §11 step 4).
 */
export const POSSESSION_WORDS =
  /(ignore|approve|reviewer|instructions|\bai\b|no issues|safe to merge|ignore previous)/i;

/** Zero-width, bidi-control, BOM and soft-hyphen characters stripped from input. */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g;

/**
 * Strip HTML comments and invisible/bidi characters from PR text.
 *
 * - `hidden`: the (trimmed, invisible-stripped) contents of any HTML comments.
 * - `possession`: true when any hidden fragment contains instruction-like words.
 * - `clean`: the text with comments and invisible characters removed.
 */
export function sanitizeText(text: string): {
  clean: string;
  hidden: string[];
  possession: boolean;
} {
  const hidden: string[] = [];

  let clean = text.replace(/<!--[\s\S]*?-->/g, (match) => {
    const content = match.slice(4, -3).replace(INVISIBLE_RE, "").trim();
    if (content) hidden.push(content);
    return "";
  });

  clean = clean.replace(INVISIBLE_RE, "");

  const possession = hidden.some((h) => POSSESSION_WORDS.test(h));

  return { clean, hidden, possession };
}
