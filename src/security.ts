// Secret scrubber (SPEC §17). Applied to everything posted to GitHub or sent to n8n.

// Each entry is [pattern, replacement]. The generic assignment pattern keeps
// the key name and redacts only the value, so the report stays readable.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]"], // Google API key
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "[redacted]"], // Anthropic API key
  [/sk-or-[A-Za-z0-9_-]{10,}/g, "[redacted]"], // OpenRouter API key
  [/sk-live-[A-Za-z0-9_-]{10,}/g, "[redacted]"], // Stripe secret key
  [/rk-live-[A-Za-z0-9_-]{10,}/g, "[redacted]"], // Stripe restricted key
  [/sk-[A-Za-z0-9]{20,}/g, "[redacted]"], // OpenAI-style key
  [/xox[bpas]-[A-Za-z0-9-]{10,}/g, "[redacted]"], // Slack tokens
  [/npm_[A-Za-z0-9]{20,}/g, "[redacted]"], // npm access tokens
  [/AKIA[0-9A-Z]{16}/g, "[redacted]"], // AWS access key id
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"], // GitHub tokens
  [/ghu_[A-Za-z0-9]{20,}/g, "[redacted]"], // GitHub user-to-server tokens
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"], // fine-grained PAT
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]"], // PEM key
  [
    /((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"])[^'"]{8,}['"]/gi,
    '$1[redacted]"',
  ], // generic `key = "value"` assignments (value only)
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}
