// Linked-issue parsing (pure) + the prompt-ready form.
// GitHub issues are fetched by the server; Jira/Linear keys are surfaced as text
// because fetching them needs credentials the app does not own.

export interface IssueRefs {
  /** GitHub issue/PR numbers referenced with a linking keyword or `owner/repo#n`. */
  github: number[];
  /** Jira/Linear-style keys, e.g. `ENG-123`. */
  keys: string[];
}

export interface LinkedIssue {
  ref: string;
  title: string;
  body?: string;
}

/** Encodings/algorithms that look like tracker keys but are not issues. */
const NOT_A_KEY =
  /^(UTF|SHA|ISO|RFC|HTTP|HTTPS|TLS|SSL|AES|RSA|MD5|BASE|GB|MB|KB|ECMA|W3C|IPV|IPV4|IPV6)$/;

/**
 * Parse `fixes #12`, `closes #12`, `refs #12`, `owner/repo#12` and `PROJ-123`
 * from arbitrary PR text (title/body/branch). Pure; dedupes and keeps order.
 */
export function parseIssueRefs(text: string): IssueRefs {
  const github = new Set<number>();
  const keys = new Set<string>();

  const linked = /(?:^|[^\w])(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?|see)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
  for (const m of text.matchAll(linked)) github.add(Number(m[1]));

  const crossRepo = /\b[\w.-]+\/[\w.-]+#(\d+)\b/g;
  for (const m of text.matchAll(crossRepo)) github.add(Number(m[1]));

  const trackerKey = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
  for (const m of text.matchAll(trackerKey)) {
    if (NOT_A_KEY.test(m[1])) continue;
    keys.add(`${m[1]}-${m[2]}`);
  }

  return {
    github: [...github].sort((a, b) => a - b),
    keys: [...keys],
  };
}

/** Compact, untrusted-data block for the prompt (bodies truncated). */
export function formatLinkedIssues(issues: LinkedIssue[]): string {
  if (issues.length === 0) return "(none)";
  return issues
    .map((i) => {
      const body = (i.body ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      return `- ${i.ref}: ${i.title}${body ? ` — ${body}` : ""}`;
    })
    .join("\n");
}
