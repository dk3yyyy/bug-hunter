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
:root{--bg:#F3EBDD;--ink:#241833;--muted:#5D5170;--line:#D6C9B0;--ember:#B4400A;--spirit:#5B3FA6;--panel:#1D1230;--panel-ink:#EFE7D6;--panel-muted:#A99CC0;--crit:#FF9A3C;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#150D24;--ink:#EFE7D6;--muted:#A99CC0;--line:#34264F;--ember:#FF9A3C;--spirit:#B9A4FF;--panel:#20143A;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}
.wrap{width:min(1120px,100% - 3rem);margin:0 auto;padding:40px 0}
h1{font:400 2.6rem/1.08 "IM Fell English",Georgia,serif;margin:0 0 8px}
h2{font:400 1.6rem/1.1 "IM Fell English",Georgia,serif;margin:28px 0 10px}
p{color:var(--muted);max-width:62ch}
a{color:var(--spirit)}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:top}
th{color:var(--muted);font-weight:700}
code,.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px}
pre{background:var(--panel);color:var(--panel-ink);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px;line-height:1.5}
.card{background:var(--panel);color:var(--panel-ink);border:1px solid var(--line);border-radius:14px;padding:22px;margin:16px 0}
input{display:block;width:100%;margin:6px 0 16px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button{background:var(--ember,#B4400A);color:#fff;border:0;border-radius:8px;padding:11px 20px;font:600 15px/1 "Hanken Grotesk",system-ui,sans-serif;cursor:pointer}
button:hover{filter:brightness(1.08)}
.result{margin-top:14px;padding:12px;border-radius:8px;background:color-mix(in srgb,var(--ember) 12%,transparent);font-size:14px}
.badge{padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.b-possessed{background:var(--crit);color:#150D24}
.b-haunted{background:#5b1a2e;color:#ffb3c1}
.b-restless{background:#3a2a10;color:#ffce8a}
.b-whispers{background:#22301c;color:#c8f7b0}
.b-clear{background:#16301e;color:#7cff6b}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--panel);color:var(--panel-ink);border:1px solid var(--line);border-radius:14px;padding:16px;text-align:center}
.stat .n{display:block;font:400 2rem/1 "IM Fell English",Georgia,serif;color:var(--crit)}
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

export function renderSummoned(): string {
  return shell(
    "Bug Hunter — Summoned",
    `<h1>Bug Hunter 🕯️</h1>
<p>The hunter has been summoned. Open a pull request and watch the hunt begin.</p>
<p><a href="/dashboard">View recent hunts</a></p>`,
  );
}

/** Connect page: hunt a PR now or auto-create a webhook (SPEC §6, §7). */
export function renderConnect(publicUrl: string, botHandle: string): string {
  const autoConnect = publicUrl
    ? `<h2>Auto-connect a repo</h2>
<p>Create a webhook on a repo so future PRs are hunted automatically:</p>
<div class="card">
<label for="repo">Repo</label>
<input id="repo" placeholder="owner/name" />
<button id="connect-btn" type="button">Connect</button>
<div class="result" id="connect-result"></div>
</div>`
    : `<h2>Auto-connect (webhook)</h2>
<p class="muted">Off — set <code>PUBLIC_URL</code> to this server's public URL to enable one-click webhook registration.</p>`;

  const body = `
<h1>Bug Hunter 🎃 — Connect a repo</h1>
<p>Connect Bug Hunter to a repo and it hunts every pull request, posts the 🔮 Séance Report, and drops inline comments on the exact lines.</p>

<div class="card">
<label for="secret">Shared secret (<code>N8N_SHARED_SECRET</code>)</label>
<input id="secret" type="password" placeholder="your shared secret" />

<h2>Hunt a PR now</h2>
<p>No webhook needed — paste a PR URL and hunt it immediately.</p>
<label for="pr_url">Pull request URL</label>
<input id="pr_url" placeholder="https://github.com/owner/repo/pull/42" />
<button id="hunt-btn" type="button">🔦 Hunt this PR</button>
<div class="result" id="hunt-result"></div>
</div>

${autoConnect}

<p>Or comment <code>@${botHandle} hunt</code> on a pull request to summon a hunt in-thread.</p>
<p><a href="/dashboard">View recent hunts →</a></p>

<script>
(function () {
  function secret() { return document.getElementById('secret').value; }
  function post(path, body, outEl) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-BugHunter-Secret': secret() },
      body: JSON.stringify(body),
    }).then(async function (r) {
      const j = await r.json().catch(function () { return {}; });
      return { ok: r.ok, j: j };
    });
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var huntBtn = document.getElementById('hunt-btn');
  if (huntBtn) huntBtn.addEventListener('click', function () {
    var out = document.getElementById('hunt-result');
    var url = document.getElementById('pr_url').value.trim();
    if (!url) { out.textContent = '✗ Enter a PR URL.'; return; }
    out.innerHTML = '🔦 Hunting… this can take a minute.';
    huntBtn.disabled = true;
    post('/api/hunt', { pr_url: url }, out).then(function (r) {
      huntBtn.disabled = false;
      if (!r.ok) { out.innerHTML = '<b>✗</b> ' + esc(r.j.error || ('HTTP ' + r.ok)); return; }
      out.innerHTML = '🕯️ <b>Hunt complete.</b> Haunting level: <b>' + esc(r.j.hauntingLevel) +
        '</b> · ' + r.j.keptCount + ' spirit(s) · ' + (r.j.exorcised||0) + ' exorcised · ' +
        '<a href="' + esc(r.j.prUrl) + '" target="_blank">view PR</a>';
    }).catch(function (e) { huntBtn.disabled = false; out.textContent = '✗ ' + e.message; });
  });

  var connectBtn = document.getElementById('connect-btn');
  if (connectBtn) connectBtn.addEventListener('click', function () {
    var out = document.getElementById('connect-result');
    var repo = document.getElementById('repo').value.trim();
    if (!repo) { out.textContent = '✗ Enter owner/name.'; return; }
    out.innerHTML = '🕸️ Connecting…';
    connectBtn.disabled = true;
    post('/api/connect', { repo: repo }, out).then(function (r) {
      connectBtn.disabled = false;
      if (!r.ok) { out.innerHTML = '<b>✗</b> ' + esc(r.j.error || ('HTTP ' + r.ok)); return; }
      out.innerHTML = '✅ Webhook created on <b>' + esc(r.j.repo) + '</b>. Open a PR to trigger a hunt.';
    }).catch(function (e) { connectBtn.disabled = false; out.textContent = '✗ ' + e.message; });
  });
})();
</script>`;

  return shell("Bug Hunter — Connect a repo", body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
