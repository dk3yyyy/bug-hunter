// Landing + dashboard pages. The landing is the hand-designed landing.html; the
// other pages share one shell so every surface matches the green-black v2 design.
import { readFileSync } from "node:fs";
import type { HuntRecord } from "../types";
import type { Learning } from "../learnings";
import { formatUsd } from "../cost";

const landingFile = new URL("./landing.html", import.meta.url);

/** The hand-designed landing page, with the connect/repo links substituted. */
export function renderLanding(opts: { connectUrl: string; repoUrl: string }): string {
  const html = readFileSync(landingFile, "utf8");
  return html
    .replace(/href="#connect"/g, `href="${opts.connectUrl}"`)
    .replace(/href="#repo"/g, `href="${opts.repoUrl}"`);
}

const SHELL_CSS = `
:root{
  --bg:#161c1a;--surface:#1f2725;--ink:#e3e2da;--muted:#8e948d;--line:#33403c;
  --accent:#9fc7b8;--accent-ink:#161c1a;--crit:#e0a96d;
  --font-display:"Red Hat Display",system-ui,sans-serif;
  --font-body:"Red Hat Text",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.2,.7,.2,1);
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--font-body);min-height:100vh}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:6px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{width:min(1120px,100% - 3rem);margin:0 auto;padding:32px 0 56px}
.bar{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding-block:1rem .5rem;flex-wrap:wrap}
.brand{font-family:var(--font-display);font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;font-size:1.05rem;color:var(--ink)}
.brand:hover{text-decoration:none}
.nav{display:flex;gap:1.2rem;flex-wrap:wrap}
.nav a{color:var(--muted);font-size:.95rem}
.nav a:hover{color:var(--ink);text-decoration:none}
h1,h2{font-family:var(--font-display);font-weight:900;text-transform:uppercase;letter-spacing:-0.03em;line-height:1.04;margin:0;text-wrap:balance}
h1{font-size:clamp(2rem,4.2vw,3.2rem);margin:28px 0 10px}
h2{font-size:clamp(1.2rem,2vw,1.5rem);margin:0 0 12px}
.lede{color:var(--muted);max-width:62ch;margin:0 0 8px}
p{max-width:68ch}
.hint{color:var(--muted);font-size:13px;line-height:1.5;margin:6px 0 14px}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:24px;align-items:start}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px;margin:16px 0}
.cols .card{margin:0}
.card p,.card label{color:var(--muted)}
label{display:block;font-size:.92rem;margin:0 0 6px}
input{display:block;width:100%;min-height:46px;margin:0 0 14px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font:inherit;transition:border-color .15s var(--ease)}
input:focus{border-color:var(--accent);outline:none}
button,.btn{display:inline-flex;align-items:center;gap:.5rem;background:var(--accent);color:var(--accent-ink);border:0;border-radius:999px;min-height:46px;padding:11px 22px;font:700 15px/1 var(--font-body);cursor:pointer;text-decoration:none;transition:transform .12s var(--ease),filter .15s var(--ease)}
button:hover,.btn:hover{filter:brightness(1.06);text-decoration:none}
button:active,.btn:active{transform:translateY(1px)}
button:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{display:inline-flex;align-items:center;min-height:46px;padding:11px 22px;border:2px solid var(--line);border-radius:999px;color:var(--ink);font-weight:700;text-decoration:none}
.btn-ghost:hover{border-color:var(--accent);text-decoration:none}
.result{margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--accent) 12%,transparent);font-size:14px;color:var(--ink)}
.result:empty{display:none}
details{margin:0 0 18px}
summary{cursor:pointer;font-weight:700;color:var(--muted);margin-bottom:10px}
summary:hover{color:var(--ink)}
code,.mono{font-family:var(--font-mono);font-size:.86em;background:color-mix(in srgb,var(--ink) 8%,transparent);padding:1px 5px;border-radius:4px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:.94rem}
th,td{text-align:left;border-bottom:1px solid var(--line);padding:11px 12px;vertical-align:top}
th{color:var(--muted);font-weight:500}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 8px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px}
.stat .n{display:block;font-family:var(--font-display);font-weight:900;font-size:2rem;line-height:1;color:var(--accent);font-variant-numeric:tabular-nums}
.stat .lbl{color:var(--muted);font-size:.82rem;margin-top:6px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.b-possessed{background:var(--crit);color:#161c1a}
.b-haunted{background:#6b3a2a;color:#ffd7c2}
.b-restless{background:#3f4a2a;color:#e6f0c2}
.b-whispers{background:#263a33;color:#bfe6d5}
.b-clear{background:#1f3327;color:#9fe3b4}
.foot{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.reveal{animation:rise .5s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.reveal{animation:none}}
@media (max-width:820px){.cols{grid-template-columns:minmax(0,1fr)}}
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#161c1a">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@900&family=Red+Hat+Text:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${SHELL_CSS}</style>
</head>
<body><div class="wrap">
<header class="bar">
  <a class="brand" href="/">Bug Hunter</a>
  <nav class="nav" aria-label="Main">
    <a href="/">Landing</a>
    <a href="/connect">Connect</a>
    <a href="/dashboard">Dashboard</a>
  </nav>
</header>
<main>${body}</main>
<footer class="foot">Bug Hunter · powered by your model · <a href="/">landing</a></footer>
</div></body>
</html>`;
}

const LEVEL_BADGE: Record<string, string> = {
  possessed: "b-possessed",
  haunted: "b-haunted",
  restless: "b-restless",
  whispers: "b-whispers",
  clear: "b-clear",
};

export function renderDashboard(
  hunts: HuntRecord[],
  learnings: Learning[] = [],
  cost: { monthSpendUsd: number; capUsd: number } = { monthSpendUsd: 0, capUsd: 0 },
): string {
  const rows = [...hunts].slice(-50).reverse();
  const priced = rows.filter((r) => typeof r.costUsd === "number");
  const avgCost = priced.length
    ? priced.reduce((a, r) => a + (r.costUsd ?? 0), 0) / priced.length
    : 0;
  const tokens = rows.reduce(
    (a, r) => a + (r.usage ? r.usage.inputTokens + r.usage.outputTokens : 0),
    0,
  );
  const stats = {
    hunts: rows.length,
    spirits: rows.reduce((a, r) => a + r.keptCount, 0),
    possessed: rows.filter((r) => r.hauntingLevel === "possessed").length,
    exorcised: rows.reduce((a, r) => a + r.exorcised, 0),
    learnings: learnings.length,
    monthSpend: cost.monthSpendUsd,
    avgCost,
    tokens,
  };

  const table = rows.length
    ? `<table><thead><tr><th>Repo</th><th>PR</th><th>Title</th><th>Haunting</th><th>Spirits</th><th>Exorcised</th><th>Cost</th></tr></thead><tbody>
${rows
  .map(
    (r) => `<tr>
<td class="mono">${escapeHtml(r.repo)}</td>
<td><a href="${escapeHtml(r.prUrl)}">#${r.prNumber}</a></td>
<td>${escapeHtml(r.prTitle)}</td>
<td><span class="badge ${LEVEL_BADGE[r.hauntingLevel] ?? "b-clear"}">${escapeHtml(r.hauntingLevel)}</span>${r.possessionAttempt ? " 🪄" : ""}</td>
<td>${r.keptCount}</td>
<td>${r.exorcised}</td>
<td class="mono">${typeof r.costUsd === "number" ? formatUsd(r.costUsd) : "—"}</td>
</tr>`,
  )
  .join("")}
</tbody></table>`
    : `<div class="card"><p>No hunts yet. Open a pull request or POST <code>/api/hunt</code> to summon the first one.</p></div>`;

  const learningRows = learnings.length
    ? `<table><thead><tr><th>Repo</th><th>Learning</th><th>Source</th><th>Added</th></tr></thead><tbody>
${learnings
  .map(
    (l) => `<tr>
<td class="mono">${escapeHtml(l.repo)}</td>
<td>${l.sourceUrl ? `<a href="${escapeHtml(l.sourceUrl)}">${escapeHtml(l.text)}</a>` : escapeHtml(l.text)}</td>
<td class="mono">${escapeHtml(l.source)}</td>
<td class="mono">${escapeHtml(l.createdAt.slice(0, 10))}</td>
</tr>`,
  )
  .join("")}
</tbody></table>`
    : `<div class="card"><p>No reviewer corrections yet. Reply <code>@bot wrong: &lt;why&gt;</code> on a review comment to teach one.</p></div>`;

  return shell(
    "Bug Hunter — Dashboard",
    `<h1 class="reveal">Dashboard</h1>
<p class="lede">Every hunt this server has run${learnings.length ? ", and the corrections reviewers taught it" : ""}.</p>
<div class="grid">
  <div class="stat"><span class="n">${stats.hunts}</span><span class="lbl">hunts run</span></div>
  <div class="stat"><span class="n">${stats.spirits}</span><span class="lbl">spirits found</span></div>
  <div class="stat"><span class="n">${stats.possessed}</span><span class="lbl">possessed</span></div>
  <div class="stat"><span class="n">${stats.exorcised}</span><span class="lbl">false alarms exorcised</span></div>
  <div class="stat"><span class="n">${stats.learnings}</span><span class="lbl">learnings</span></div>
  <div class="stat"><span class="n">${formatUsd(stats.monthSpend)}</span><span class="lbl">spent this month${cost.capUsd > 0 ? ` of ${formatUsd(cost.capUsd)}` : ""}</span></div>
  <div class="stat"><span class="n">${formatUsd(stats.avgCost)}</span><span class="lbl">avg cost / hunt</span></div>
  <div class="stat"><span class="n">${stats.tokens.toLocaleString("en-US")}</span><span class="lbl">tokens (last ${stats.hunts})</span></div>
</div>
<h2 style="margin-top:32px">Recent hunts</h2>
${table}
<h2 style="margin-top:32px">Learnings</h2>
${learningRows}`,
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
    `<h1 class="reveal">The hunter is summoned.</h1>
<p class="lede">${installationId ? `Installation <code>${escapeHtml(installationId)}</code> connected. ` : ""}Open a pull request and watch the hunt begin.</p>
<div class="card"><h2>Connected repos</h2>${repoList}</div>
<p><a class="btn-ghost" href="/dashboard">View recent hunts →</a></p>`,
  );
}

/** Connect page: hunt a PR now or connect a repo for automatic hunts. */
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
<p>Bug Hunter runs as a GitHub App. Install it on the repos you want hunted — no secret or webhook setup.</p>
<p><a class="btn" href="${escapeHtml(opts.installUrl ?? "https://github.com/apps")}">Install the GitHub App</a></p>
<p class="hint">GitHub's <code>installation</code> webhook keeps the connected-repo list in sync.</p>`
      : `<h2>Connect a repo</h2>
<p>Create a webhook so every new pull request is hunted automatically. GitHub has to reach this server.</p>
<label for="repo">Repo</label>
<input id="repo" placeholder="owner/name" autocomplete="off" spellcheck="false" />
<label for="public_url">Public URL of this server</label>
<input id="public_url" placeholder="https://abc123.ngrok-free.app" value="${escapeHtml(opts.publicUrl)}" autocomplete="off" spellcheck="false" />
<p class="hint">${
          opts.publicUrl
            ? "Pre-filled from <code>PUBLIC_URL</code>. Change it for a different tunnel (for smee, paste the full channel URL)."
            : "No <code>PUBLIC_URL</code> set. Paste a tunnel URL (ngrok, cloudflared), or set <code>PUBLIC_URL</code> in <code>.env</code> and restart."
        }</p>
<button id="connect-btn" type="button">Connect this repo</button>
<div class="result" id="connect-result"></div>`;

  const notice = opts.loginNotice
    ? `<div class="result" role="status">${escapeHtml(opts.loginNotice)}</div>`
    : "";

  const loginCard = opts.session
    ? `<div class="card">
<p><b>Signed in as @${escapeHtml(opts.session.login)}</b>${
        opts.session.name ? ` <span class="hint">(${escapeHtml(opts.session.name)})</span>` : ""
      }</p>
<p class="hint">Connecting a repo uses your own GitHub permissions, so Bug Hunter can only touch repos you administer.</p>
<p><a href="/logout">Sign out</a></p>
</div>`
    : opts.oauthEnabled
      ? `<div class="card">
<h2>Connect with GitHub</h2>
<p>One click — no secret to copy. GitHub asks you to allow reading pull requests and managing repo webhooks.</p>
<p><a class="btn" href="/auth/github">Connect with GitHub</a></p>
<p class="hint">Your GitHub account decides which repos you can connect. Nothing is stored beyond a signed cookie.</p>
</div>`
      : "";

  const secretSummary = opts.session
    ? "Advanced: shared secret (not needed while signed in)"
    : opts.oauthEnabled
      ? "Advanced: use a shared secret instead of signing in"
      : "Shared secret";

  const body = `
<h1 class="reveal">Connect a repo.</h1>
<p class="lede">Hunt a pull request right now, or wire a repo so every new PR is reviewed and turned into a 🔮 Séance Report.</p>
${notice}
${loginCard}
<div class="cols">
  <section class="card">
    <details${opts.oauthEnabled || opts.session ? "" : " open"}>
      <summary>${escapeHtml(secretSummary)}</summary>
      <label for="secret">Shared secret (<code>N8N_SHARED_SECRET</code>)</label>
      <input id="secret" type="password" placeholder="your shared secret" autocomplete="off" />
      <p class="hint">Required only for direct API calls. A signed-in browser session is authorised automatically.</p>
    </details>
    <h2>Hunt a PR now</h2>
    <p>No webhook needed — paste a PR URL and hunt it immediately.</p>
    <label for="pr_url">Pull request URL</label>
    <input id="pr_url" placeholder="https://github.com/owner/repo/pull/42" autocomplete="off" spellcheck="false" />
    <button id="hunt-btn" type="button">🔦 Hunt this PR</button>
    <div class="result" id="hunt-result" role="status" aria-live="polite"></div>
  </section>
  <section class="card">
    ${connectSection}
  </section>
</div>
<p class="hint">Or comment <code>@${escapeHtml(opts.botHandle)} hunt</code> on a pull request to summon a hunt in-thread.</p>
<p><a class="btn-ghost" href="/dashboard">View recent hunts →</a></p>

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
  function statusHint(status) {
    if (status === 502 || status === 504 || status === 524) {
      return 'The proxy timed out. The hunt may still finish - check the pull request for the report before retrying.';
    }
    if (status === 429) return 'This PR hit its hourly hunt limit. Try again later.';
    if (status === 0) return 'No response from the server.';
    return '';
  }
  function fail(out, r) {
    var msg = '<b>✗</b> ' + esc(r.j.error || ('HTTP ' + r.status));
    var sh = statusHint(r.status);
    if (sh) msg += '<br><span class="hint">' + esc(sh) + '</span>';
    if (r.j && r.j.login_url) msg += ' <a href="' + esc(r.j.login_url) + '">Sign in with GitHub</a>';
    if (r.j && r.j.hint) msg += '<br><span class="hint">' + esc(r.j.hint) + '</span>';
    out.innerHTML = msg;
  }

  function showDone(out, rec) {
    out.innerHTML = '🕯️ <b>Hunt complete.</b> Haunting level: <b>' + esc(rec.hauntingLevel) +
      '</b> · ' + esc(rec.keptCount) + ' spirit(s) · ' + esc(rec.exorcised || 0) + ' exorcised · ' +
      '<a href="' + esc(rec.prUrl) + '" target="_blank" rel="noreferrer">view PR</a>';
  }

  var huntBtn = document.getElementById('hunt-btn');
  if (huntBtn) huntBtn.addEventListener('click', function () {
    var out = document.getElementById('hunt-result');
    var url = document.getElementById('pr_url').value.trim();
    if (!url) { out.textContent = '✗ Enter a PR URL.'; return; }
    out.innerHTML = '🔦 Hunting… this can take a minute.';
    huntBtn.disabled = true;
    // Async: start the hunt, then poll until the result exists. Avoids proxy
    // timeouts when a hunt takes ~2 minutes.
    post('/api/hunt', { pr_url: url, async: true }).then(function (r) {
      if (!r.ok) { huntBtn.disabled = false; fail(out, r); return; }
      var id = r.j.id;
      var started = Date.now();
      function poll() {
        fetch('/api/hunts/' + encodeURIComponent(id), { headers: { 'X-BugHunter-Secret': secret() } })
          .then(function (pr) {
            return pr.json().then(function (rec) { return { status: pr.status, rec: rec }; });
          })
          .then(function (x) {
            if (x.status === 404) {
              if (Date.now() - started > 240000) {
                huntBtn.disabled = false;
                out.textContent = '✗ Timed out waiting for the hunt. Check the pull request for the report.';
                return;
              }
              setTimeout(poll, 3000);
              return;
            }
            huntBtn.disabled = false;
            if (x.status >= 400) { fail(out, { j: x.rec, status: x.status }); return; }
            showDone(out, x.rec);
          })
          .catch(function () { setTimeout(poll, 3000); });
      }
      poll();
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
