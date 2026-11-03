// Landing + dashboard pages. The landing is the hand-designed landing.html; the
// dashboard/summoned pages reuse the same design tokens so the surfaces match.
import { readFileSync } from "node:fs";
import type { HuntRecord } from "../types";

const landingFile = new URL("./landing.html", import.meta.url);

/** The hand-designed landing page, with the connect/repo links substituted. */
export function renderLanding(opts: { connectUrl: string; repoUrl: string }): string {
  const html = readFileSync(landingFile, "utf8");
  return html
    .replace(/href="#connect"/g, `href="${opts.connectUrl}"`)
    .replace(/href="#repo"/g, `href="${opts.repoUrl}"`);
}

const SHELL_CSS = `
:root{--bg:#F3EBDD;--ink:#241833;--muted:#5D5170;--line:#D6C9B0;--ember:#B4400A;--spirit:#5B3FA6;--panel:#1D1230;--panel-line:#3A2A58;--panel-ink:#EFE7D6;--panel-muted:#A99CC0;--crit:#FF9A3C;--btn-ink:#F3EBDD;--font-display:"IM Fell English",Georgia,"Times New Roman",serif;--font-body:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#150D24;--ink:#EFE7D6;--muted:#A99CC0;--line:#34264F;--ember:#FF9A3C;--spirit:#B9A4FF;--panel:#20143A;--panel-line:#3A2A58;--btn-ink:#150D24;color-scheme:dark}}
*{box-sizing:border-box}
html,body{overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--font-body);min-height:100vh}
:focus-visible{outline:3px solid var(--spirit);outline-offset:3px;border-radius:4px}
.wrap{width:min(1120px,100% - 3rem);margin:0 auto;padding:40px 0}
h1{font:400 2.6rem/1.08 var(--font-display);margin:0 0 8px;text-wrap:balance}
h2{font:400 1.6rem/1.1 var(--font-display);margin:28px 0 10px;text-wrap:balance}
p{color:var(--muted);max-width:62ch}
a{color:var(--spirit)}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:top}
th{color:var(--muted);font-weight:700}
code,.mono{font-family:var(--font-mono);font-size:13px}
pre{background:var(--panel);color:var(--panel-ink);border:1px solid var(--panel-line);border-radius:10px;padding:14px;overflow-x:auto;font-family:var(--font-mono);font-size:13px;line-height:1.5}
.card{background:var(--panel);color:var(--panel-ink);border:1px solid var(--panel-line);border-radius:14px;padding:22px;margin:16px 0}
.card p,.card label{color:var(--panel-muted)}
input{display:block;width:100%;min-height:44px;margin:6px 0 16px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button{background:var(--ember);color:var(--btn-ink);border:0;border-radius:999px;min-height:44px;padding:11px 22px;font:700 15px/1 var(--font-body);cursor:pointer}
button:hover{filter:brightness(1.08)}
button:active{transform:translateY(1px)}
button:disabled{opacity:.5;cursor:not-allowed}
a.btn{display:inline-block;background:var(--ember);color:var(--btn-ink);border-radius:999px;padding:11px 22px;font-weight:700;text-decoration:none}
a.btn:hover{filter:brightness(1.08)}
summary{cursor:pointer;font-weight:700;color:var(--muted);margin-bottom:10px}
.result{margin-top:14px;padding:12px;border-radius:8px;background:color-mix(in srgb,var(--ember) 12%,transparent);font-size:14px}
.hint{color:var(--muted);font-size:13px;line-height:1.45;margin:-6px 0 14px}
.badge{padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.b-possessed{background:var(--crit);color:#150D24}
.b-haunted{background:#5b1a2e;color:#ffb3c1}
.b-restless{background:#3a2a10;color:#ffce8a}
.b-whispers{background:#22301c;color:#c8f7b0}
.b-clear{background:#16301e;color:#7cff6b}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--panel);color:var(--panel-ink);border:1px solid var(--panel-line);border-radius:14px;padding:16px;text-align:center}
.stat .n{display:block;font:400 2rem/1 var(--font-display);color:var(--crit);font-variant-numeric:tabular-nums}
.foot{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Hanken+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${SHELL_CSS}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

const LEVEL_BADGE: Record<string, string> = {
  possessed: "b-possessed",
  haunted: "b-haunted",
  restless: "b-restless",
  whispers: "b-whispers",
  clear: "b-clear",
};

export function renderDashboard(hunts: HuntRecord[]): string {
  const rows = [...hunts].slice(-50).reverse();
  const stats = {
    hunts: rows.length,
    spirits: rows.reduce((a, r) => a + r.keptCount, 0),
    possessed: rows.filter((r) => r.hauntingLevel === "possessed").length,
    exorcised: rows.reduce((a, r) => a + r.exorcised, 0),
  };

  const table = rows.length
    ? `<table><thead><tr><th>Repo</th><th>PR</th><th>Title</th><th>Haunting</th><th>Spirits</th><th>Exorcised</th></tr></thead><tbody>
${rows
  .map(
    (r) => `<tr>
<td class="mono">${escapeHtml(r.repo)}</td>
<td><a href="${escapeHtml(r.prUrl)}">#${r.prNumber}</a></td>
<td>${escapeHtml(r.prTitle)}</td>
<td><span class="badge ${LEVEL_BADGE[r.hauntingLevel] ?? "b-clear"}">${escapeHtml(r.hauntingLevel)}</span>${r.possessionAttempt ? " 👻" : ""}</td>
<td>${r.keptCount}</td>
<td>${r.exorcised}</td>
</tr>`,
  )
  .join("")}
</tbody></table>`
    : `<p>No hunts yet. Open a pull request or POST <code>/api/hunt</code> to summon the first one.</p>`;

  return shell(
    "Bug Hunter — Dashboard",
    `<h1>Bug Hunter 🎃 — Dashboard</h1>
<div class="grid">
  <div class="stat"><span class="n">${stats.hunts}</span>hunts run</div>
  <div class="stat"><span class="n">${stats.spirits}</span>spirits found</div>
  <div class="stat"><span class="n">${stats.possessed}</span>possessed</div>
  <div class="stat"><span class="n">${stats.exorcised}</span>false alarms exorcised</div>
</div>
<h2>Recent hunts</h2>
${table}
<div class="foot"><a href="/">← Back to the landing</a> · in-memory history (resets on restart)</div>`,
  );
}

export function renderSummoned(repos: string[] = [], installationId?: string): string {
  const repoList = repos.length
    ? `<ul>${repos
        .map(
          (r) =>
            `<li><a href="https://github.com/${encodeURI(r)}">${escapeHtml(r)}</a></li>`,
        )
        .join("")}</ul>`
    : `<p>No repositories recorded yet. If you just installed the app, refresh in a moment — GitHub's <code>installation</code> webhook may still be arriving.</p>`;

  return shell(
    "Bug Hunter — Summoned",
    `<h1>Bug Hunter 🕯️</h1>
<p>The hunter has been summoned${installationId ? ` for installation <code>${escapeHtml(installationId)}</code>` : ""}. Open a pull request and watch the hunt begin.</p>
<h2>Connected repos</h2>
${repoList}
<p><a href="/dashboard">View recent hunts</a></p>`,
  );
}

/** Connect page: hunt a PR now or connect a repo for automatic hunts (SPEC §6, §7). */
export function renderConnect(opts: {
  publicUrl: string;
  botHandle: string;
  mode: "pat" | "app";
  installUrl?: string;
  /** Offer the OAuth login button (an OAuth App is configured). */
  oauthEnabled?: boolean;
  /** Set when the visitor is signed in. null/undefined = anonymous. */
  session?: { login: string; name?: string; avatar?: string } | null;
  /** Human-readable result of a just-completed login redirect. */
  loginNotice?: string;
}): string {
  const connectSection =
    opts.mode === "app"
      ? `<h2>Connect a repo</h2>
<p>Bug Hunter is running as a GitHub App. Install it on the repos you want hunted — no secret or webhook setup needed.</p>
<div class="card">
<p><a class="btn" href="${escapeHtml(opts.installUrl ?? "https://github.com/apps")}">Install the GitHub App</a></p>
<p class="hint">GitHub's <code>installation</code> webhook keeps the connected-repo list in sync.</p>
</div>`
      : `<h2>Connect a repo (webhooks)</h2>
<p>Create a webhook so every new pull request is hunted automatically. GitHub has to be able to reach this server.</p>
<div class="card">
<label for="repo">Repo</label>
<input id="repo" placeholder="owner/name" autocomplete="off" spellcheck="false" />
<label for="public_url">Public URL of this server</label>
<input id="public_url" placeholder="https://abc123.ngrok-free.app" value="${escapeHtml(opts.publicUrl)}" autocomplete="off" spellcheck="false" />
<p class="hint">${
          opts.publicUrl
            ? "Pre-filled from <code>PUBLIC_URL</code>. Change it if you're using a different tunnel (for smee, paste the full channel URL)."
            : "No <code>PUBLIC_URL</code> set. Paste a tunnel URL (ngrok, cloudflared) or a full smee channel URL, or set <code>PUBLIC_URL</code> in <code>.env</code> and restart."
        }</p>
<button id="connect-btn" type="button">Connect this repo</button>
<div class="result" id="connect-result"></div>
</div>`;

  const notice = opts.loginNotice
    ? `<div class="result" role="status">${escapeHtml(opts.loginNotice)}</div>`
    : "";

  // Who you are. A signed-in session replaces the pasted shared secret for every
  // /api/* call from this page, because the cookie travels automatically.
  const loginCard = opts.session
    ? `<div class="card">
<p><b>Signed in as @${escapeHtml(opts.session.login)}</b>${
        opts.session.name ? ` <span class="hint">(${escapeHtml(opts.session.name)})</span>` : ""
      }</p>
<p class="hint">Connecting a repo uses your own GitHub permissions, so Bug Hunter can only touch repos you can administer.</p>
<p><a href="/logout">Sign out</a></p>
</div>`
    : opts.oauthEnabled
      ? `<div class="card">
<h2>Connect with GitHub</h2>
<p>One click — no secret to copy. GitHub asks you to allow reading pull requests and managing repo webhooks.</p>
<p><a class="btn" href="/auth/github">Connect with GitHub</a></p>
<p class="hint">Your GitHub account decides which repos you can connect. Nothing is stored on this server beyond a signed cookie.</p>
</div>`
      : "";

  // The shared secret stays available for scripts and n8n, and the input keeps its
  // id so existing callers (and tests) that drive this form are unaffected.
  const secretSummary = opts.session
    ? "Advanced: shared secret (not needed while signed in)"
    : opts.oauthEnabled
      ? "Advanced: use a shared secret instead of signing in"
      : "Shared secret";

  const body = `
<h1>Bug Hunter 🎃 — Connect a repo</h1>
<p>Connect Bug Hunter to a repo and it hunts every pull request, posts the 🔮 Séance Report, and drops inline comments on the exact lines.</p>
${notice}
${loginCard}
<div class="card">
<details${opts.oauthEnabled || opts.session ? "" : " open"}>
<summary>${escapeHtml(secretSummary)}</summary>
<label for="secret">Shared secret (<code>N8N_SHARED_SECRET</code>)</label>
<input id="secret" type="password" placeholder="your shared secret" />
<p class="hint">Required only for direct API calls. A signed-in browser session is authorised automatically.</p>
</details>

<h2>Hunt a PR now</h2>
<p>No webhook needed — paste a PR URL and hunt it immediately.</p>
<label for="pr_url">Pull request URL</label>
<input id="pr_url" placeholder="https://github.com/owner/repo/pull/42" />
<button id="hunt-btn" type="button">🔦 Hunt this PR</button>
<div class="result" id="hunt-result"></div>
</div>

${connectSection}

<p>Or comment <code>@${opts.botHandle} hunt</code> on a pull request to summon a hunt in-thread.</p>
<p><a href="/dashboard">View recent hunts →</a></p>

<script>
(function () {
  function secret() { return document.getElementById('secret').value; }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-BugHunter-Secret': secret() },
      body: JSON.stringify(body),
    }).then(async function (r) {
      const j = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, j: j };
    });
  }
  function fail(out, r) {
    var msg = '<b>✗</b> ' + esc(r.j.error || ('HTTP ' + r.status));
    if (r.j && r.j.login_url) msg += ' <a href="' + esc(r.j.login_url) + '">Sign in with GitHub</a>';
    // The server sends an actionable hint alongside the message (provider credit,
    // token scopes, rate limit). Show it rather than making people guess.
    if (r.j && r.j.hint) msg += '<br><span class="hint">' + esc(r.j.hint) + '</span>';
    out.innerHTML = msg;
  }

  var huntBtn = document.getElementById('hunt-btn');
  if (huntBtn) huntBtn.addEventListener('click', function () {
    var out = document.getElementById('hunt-result');
    var url = document.getElementById('pr_url').value.trim();
    if (!url) { out.textContent = '✗ Enter a PR URL.'; return; }
    out.innerHTML = '🔦 Hunting… this can take a minute.';
    huntBtn.disabled = true;
    post('/api/hunt', { pr_url: url }).then(function (r) {
      huntBtn.disabled = false;
      if (!r.ok) { fail(out, r); return; }
      out.innerHTML = '🕯️ <b>Hunt complete.</b> Haunting level: <b>' + esc(r.j.hauntingLevel) +
        '</b> · ' + esc(r.j.keptCount) + ' spirit(s) · ' + esc(r.j.exorcised || 0) + ' exorcised · ' +
        '<a href="' + esc(r.j.prUrl) + '" target="_blank" rel="noreferrer">view PR</a>';
    }).catch(function (e) { huntBtn.disabled = false; out.textContent = '✗ ' + e.message; });
  });

  var connectBtn = document.getElementById('connect-btn');
  if (connectBtn) connectBtn.addEventListener('click', function () {
    var out = document.getElementById('connect-result');
    var repo = document.getElementById('repo').value.trim();
    var publicUrl = document.getElementById('public_url').value.trim();
    if (!repo) { out.textContent = '✗ Enter owner/name.'; return; }
    out.innerHTML = '🕸️ Connecting…';
    connectBtn.disabled = true;
    post('/api/connect', { repo: repo, public_url: publicUrl }).then(function (r) {
      connectBtn.disabled = false;
      if (!r.ok) { fail(out, r); return; }
      var hooks = 'https://github.com/' + encodeURI(r.j.repo) + '/settings/hooks';
      out.innerHTML = (r.j.created ? '✅ Webhook created on <b>' : '✅ Already connected: <b>') + esc(r.j.repo) +
        '</b>. Open a PR to trigger a hunt. <a href="' + esc(hooks) + '" target="_blank" rel="noreferrer">View the webhook</a>';
    }).catch(function (e) { connectBtn.disabled = false; out.textContent = '✗ ' + e.message; });
  });
})();
</script>`;

  return shell("Bug Hunter — Connect a repo", body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
