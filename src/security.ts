// Secret scrubber (SPEC §17). Applied to everything posted to GitHub or sent to n8n.

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API key
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style key
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g, // fine-grained PAT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM key
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}
