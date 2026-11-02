// Public-URL handling for the "Connect a repo" flow.
//
// A repo webhook only works if GitHub can reach this server, so the base URL
// must be public. Keeping the check pure means the /connect page, the API and
// the tests all agree on what "public" means instead of each guessing.

export type PublicUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const LOCAL_HOSTS = /^(localhost|.*\.localhost|.*\.local)$/i;

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOCAL_HOSTS.test(h)) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10 || a === 0) return true; // loopback / private / "this host"
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/**
 * Normalise a user-supplied base URL (PUBLIC_URL or the /connect form field).
 * Returns the origin only, so a pasted `https://x.ngrok.app/` or
 * `https://x.ngrok.app/some/path` both become `https://x.ngrok.app`.
 */
export function normalizePublicUrl(input: string): PublicUrlCheck {
  const raw = input.trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        "PUBLIC_URL not set — pass public_url (your tunnel URL) or set PUBLIC_URL in .env",
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That doesn't look like a URL — use e.g. https://abc123.ngrok-free.app" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The public URL must start with https:// (or http:// for a tunnel)" };
  }

  if (isPrivateHost(url.hostname)) {
    return {
      ok: false,
      reason:
        "GitHub can't reach localhost or a private address. Use a public tunnel (ngrok, smee, cloudflared) or deploy this server, then paste that URL.",
    };
  }

  return { ok: true, url: url.origin };
}

/**
 * The exact URL GitHub should POST to.
 *
 * Most tunnels expose this server at their origin, so `/webhooks/github` is
 * appended. Two exceptions:
 * - smee.io gives each channel its own path (https://smee.io/<channel>) and
 *   forwards that path to the local target, so the channel URL is the webhook
 *   URL — appending `/webhooks/github` there would 404.
 * - A full `.../webhooks/github` URL is used as pasted, not appended twice.
 */
export function webhookUrlFor(input: string): PublicUrlCheck {
  const target = normalizePublicUrl(input);
  if (!target.ok) return target;

  const raw = new URL(input.trim());
  const host = raw.hostname.toLowerCase();
  const path = raw.pathname.replace(/\/+$/, "");

  if (host === "smee.io") {
    if (!path) {
      return {
        ok: false,
        reason: "Paste the full smee channel URL — https://smee.io/<your-channel>",
      };
    }
    return { ok: true, url: `https://smee.io${path}` };
  }

  if (path.endsWith("/webhooks/github")) {
    return { ok: true, url: `${target.url}${path}` };
  }

  return { ok: true, url: `${target.url}/webhooks/github` };
}
