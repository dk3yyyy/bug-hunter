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
  --bg:#100d15;--surface:#161020;--ink:#ece6dc;--muted:#a396ad;--dim:#8f8399;--line:#322a3d;--line-soft:#241e2e;
  --accent:#e9a15f;--accent-ink:#191220;--crit:#f0a35e;--lilac:#cbb8f0;--calm:#a9dcc8;--danger:#ff8f7f;
  --font-display:"Red Hat Display",system-ui,sans-serif;
  --font-serif:"Instrument Serif",Georgia,serif;
  --font-body:"Red Hat Text",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.2,.7,.2,1);
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{overflow-x:clip}
body{
  margin:0;min-height:100vh;color:var(--ink);font:16px/1.65 var(--font-body);
  background:radial-gradient(circle at 1px 1px,rgba(236,230,220,.05) 1px,transparent 0) 0 0/26px 26px,var(--bg);
  -webkit-font-smoothing:antialiased;
}
::selection{background:var(--accent);color:var(--accent-ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
.wrap{width:min(1180px,100% - clamp(2rem,7vw,5rem));margin:0 auto;padding:0 0 3rem}
.bar{display:flex;align-items:center;gap:1.4rem;padding:1.1rem 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{display:inline-flex;align-items:baseline;gap:.3rem;font-family:var(--font-display);font-weight:900;font-size:1.05rem;letter-spacing:-.02em;text-transform:uppercase;color:var(--ink)}
.brand .mark{color:var(--accent)}
.brand:hover{text-decoration:none}
.nav{display:flex;gap:1.2rem;flex-wrap:wrap;margin-left:auto}
.nav a{font-family:var(--font-mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.nav a:hover{color:var(--ink);text-decoration:none}
.bar .btn{min-height:38px;padding:.5rem 1rem;font-size:.8rem}
.bar .bar-star{min-height:38px;padding:.5rem .9rem;font-size:.8rem}
.bar-star .star{color:var(--accent);font-size:.95rem;line-height:1}
.bar-star:hover .star{color:var(--accent)}
.eyebrow{display:block;margin:2.4rem 0 0;font-family:var(--font-mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.eyebrow b{color:var(--accent);font-weight:500}
h1,h2{font-family:var(--font-display);font-weight:900;text-transform:uppercase;letter-spacing:-.035em;line-height:1;margin:0;text-wrap:balance}
h1{font-size:clamp(2.2rem,5vw,3.6rem);margin:.7rem 0 .4rem}
h1 em{font-family:var(--font-serif);font-style:italic;font-weight:400;text-transform:none;letter-spacing:-.02em;color:var(--accent)}
h2{font-size:1.15rem;margin:2.2rem 0 .5rem;letter-spacing:-.01em}
h3{font-family:var(--font-display);font-weight:900;font-size:1rem;text-transform:uppercase;letter-spacing:.01em;margin:0 0 .4rem}
.lede{color:var(--muted);max-width:62ch;margin:.4rem 0 0}
p{max-width:70ch}
.hint{color:var(--dim);font-size:.82rem;line-height:1.55;margin:.4rem 0 .9rem}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin-top:1.6rem;align-items:start}
.card{background:rgba(22,16,32,.55);border:1px solid var(--line);border-radius:2px;padding:1.3rem;margin:1rem 0}
.cols .card{margin:0}
.card p,.card label{color:var(--muted)}
.panel{border:1px solid var(--line);border-radius:2px;margin:.8rem 0 0;overflow:hidden}
label{display:block;margin:.9rem 0 .35rem;font-family:var(--font-mono);font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
input,textarea{display:block;width:100%;min-height:46px;margin:0 0 .7rem;padding:.65rem .8rem;border:1px solid var(--line);border-radius:2px;background:transparent;color:var(--ink);font:inherit;transition:border-color .15s var(--ease)}
input:focus{border-color:var(--accent);outline:none}
button,.btn{display:inline-flex;align-items:center;gap:.45rem;background:var(--accent);color:var(--accent-ink);border:1px solid var(--accent);border-radius:999px;min-height:46px;padding:.72rem 1.3rem;font:700 .9rem/1 var(--font-body);cursor:pointer;text-decoration:none;box-shadow:0 1px 0 rgba(255,255,255,.18) inset;transition:transform .12s var(--ease),background-color .15s var(--ease),box-shadow .15s var(--ease)}
button:hover,.btn:hover{background:#f0b075;text-decoration:none;box-shadow:0 6px 18px -10px rgba(233,161,95,.7)}
button:active,.btn:active{transform:translateY(1px)}
button:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{display:inline-flex;align-items:center;gap:.45rem;min-height:46px;padding:.72rem 1.2rem;border:1px solid var(--line);border-radius:999px;color:var(--ink);font-weight:500;font-size:.9rem;text-decoration:none;transition:border-color .15s var(--ease),color .15s var(--ease),background-color .15s var(--ease)}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent);background:rgba(233,161,95,.06);text-decoration:none}
.result{margin-top:.9rem;padding:.75rem .9rem;border:1px solid var(--line);border-left:2px solid var(--accent);font-size:.88rem;color:var(--ink)}
.result:empty{display:none}
.result[aria-busy="true"]{border-left-color:var(--lilac);color:var(--muted)}
button.is-loading{position:relative;padding-right:2.7rem;opacity:.9;cursor:progress}
button.is-loading::after{content:"";position:absolute;right:1rem;top:50%;width:14px;height:14px;margin-top:-7px;border:2px solid rgba(25,18,32,.35);border-top-color:#191220;border-radius:50%;animation:bhspin .7s linear infinite}
@keyframes bhspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){button.is-loading::after{animation-duration:2s}}
details{margin:0 0 1rem}
summary{cursor:pointer;font-family:var(--font-mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-bottom:.8rem}
summary:hover{color:var(--ink)}
code{font-family:var(--font-mono);font-size:.84em;background:rgba(236,230,220,.07);padding:1px 5px;border-radius:2px}
.mono{font-family:var(--font-mono);font-size:.86em}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{text-align:left;border-bottom:1px solid var(--line-soft);padding:.65rem .8rem;vertical-align:top}
tr:last-child td{border-bottom:0}
th{font-family:var(--font-mono);font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);font-weight:500}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:1.6rem 0 .8rem}
.stat{background:var(--bg);padding:1rem 1.1rem}
.stat .n{display:block;font-family:var(--font-display);font-weight:900;font-size:1.7rem;line-height:1;color:var(--accent);font-variant-numeric:tabular-nums}
.stat .lbl{display:block;margin-top:.35rem;font-family:var(--font-mono);font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.badge{display:inline-block;padding:.18rem .5rem;border-radius:2px;font-family:var(--font-mono);font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;font-weight:500}
.b-possessed{background:var(--crit);color:#191220}
.b-haunted{background:#5e3140;color:#ffd3dd}
.b-restless{background:#4a3760;color:#e4d6ff}
.b-whispers{background:#352c4a;color:#d3c6f2}
.b-clear{background:#2c3a35;color:#b7e6d6}
.foot{margin-top:3.5rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--dim);font-size:.8rem}
.foot-links{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:.7rem;font-family:var(--font-mono);font-size:.64rem;letter-spacing:.06em;text-transform:uppercase}
.foot-links a{color:var(--muted)}
.foot-links a:hover{color:var(--accent)}
.foot-star{margin-top:.9rem}
.foot-star .star{color:var(--accent);font-size:1rem;line-height:1}
.empty{padding:1.1rem 1.3rem;color:var(--muted);font-size:.9rem}
.empty code{color:var(--ink)}
.reveal{animation:rise .5s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.reveal{animation:none}}
@media (max-width:820px){
  .cols{grid-template-columns:minmax(0,1fr)}
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .nav{margin-left:0}
}
@media (max-width:480px){
  .grid{grid-template-columns:minmax(0,1fr)}
}
`;

function shell(
  title: string,
  body: string,
  opts: { showCta?: boolean; description?: string } = {},
): string {
  const showCta = opts.showCta !== false;
  const description =
    opts.description ??
    "Bug Hunter: an open-source AI pull request reviewer. Bring your own model; verified findings, inline fixes and a themed Séance Report.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#100d15">
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://dk3yyyy.github.io/bug-hunter/og.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="https://dk3yyyy.github.io/bug-hunter/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Red+Hat+Display:wght@900&family=Red+Hat+Text:wght@400;500;700&display=swap" rel="stylesheet">
<style>${SHELL_CSS}</style>
</head>
<body><div class="wrap">
<header class="bar">
  <a class="brand" href="/">Bug<span class="mark">✳</span>Hunter</a>
  <nav class="nav" aria-label="Main">
    <a href="/">Landing</a>
    <a href="/connect">Connect</a>
    <a href="/dashboard">Dashboard</a>
  </nav>
  ${showCta ? '<a class="btn" href="/connect">Connect a repo</a>' : ""}
  <a class="btn-ghost bar-star" href="https://github.com/dk3yyyy/bug-hunter"><span class="star" aria-hidden="true">★</span> Star on GitHub</a>
</header>
<main>${body}</main>
<footer class="foot">
  <p>Bug Hunter · powered by your model · no telemetry.</p>
  <a class="btn-ghost foot-star" href="https://github.com/dk3yyyy/bug-hunter"><span class="star" aria-hidden="true">★</span> Star on GitHub</a>
  <nav class="foot-links" aria-label="Footer">
    <a href="https://github.com/dk3yyyy/bug-hunter/tree/main/docs">Docs</a>
    <a href="https://github.com/dk3yyyy/bug-hunter/blob/main/docs/QUICKSTART.md">Quickstart</a>
    <a href="https://github.com/dk3yyyy/bug-hunter/blob/main/docs/CONFIGURATION.md">Configuration</a>
    <a href="https://github.com/dk3yyyy/bug-hunter/blob/main/SECURITY.md">Security</a>
    <a href="/privacy">Privacy</a>
    <a href="https://github.com/dk3yyyy/bug-hunter">GitHub</a>
  </nav>
</footer>
</div>
<script>
(function(){
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  var path = location.pathname;
  try { var k = 'bh-pv:' + path; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) {}
  var body = JSON.stringify({ path: path });
  if (navigator.sendBeacon) { navigator.sendBeacon('/api/analytics/collect', body); return; }
  fetch('/api/analytics/collect', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function(){});
})();
</script>
</body>
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
  traffic: { total: number; top: Array<{ path: string; count: number }> } = { total: 0, top: [] },
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
    : `<div class="empty">No hunts yet. Open a pull request or POST <code>/api/hunt</code> to summon the first one.</div>`;

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
    : `<div class="empty">No reviewer corrections yet. Reply <code>@bot wrong: &lt;why&gt;</code> on a review comment to teach one.</div>`;

  return shell(
    "Bug Hunter — Dashboard",
    `<span class="eyebrow"><b>Ledger</b> · every hunt this server has run</span>
<h1>Dashboard<em>.</em></h1>
<p class="lede">Hunts, spend and reviewer corrections${learnings.length ? " — including what this repo taught the hunter" : ""}.</p>
<div class="grid">
  <div class="stat"><span class="n">${stats.hunts}</span><span class="lbl">hunts run</span></div>
  <div class="stat"><span class="n">${stats.spirits}</span><span class="lbl">spirits found</span></div>
  <div class="stat"><span class="n">${stats.possessed}</span><span class="lbl">possessed</span></div>
  <div class="stat"><span class="n">${stats.exorcised}</span><span class="lbl">false alarms exorcised</span></div>
  <div class="stat"><span class="n">${stats.learnings}</span><span class="lbl">learnings</span></div>
  <div class="stat"><span class="n">${formatUsd(stats.monthSpend)}</span><span class="lbl">spent this month${cost.capUsd > 0 ? ` of ${formatUsd(cost.capUsd)}` : ""}</span></div>
  <div class="stat"><span class="n">${formatUsd(stats.avgCost)}</span><span class="lbl">avg cost / hunt</span></div>
  <div class="stat"><span class="n">${stats.tokens.toLocaleString("en-US")}</span><span class="lbl">tokens${stats.hunts ? ` (last ${stats.hunts})` : ""}</span></div>
</div>
<h2>Recent hunts</h2>
<div class="panel">${table}</div>
<h2>Learnings</h2>
<div class="panel">${learningRows}</div>
<h2>Traffic · last 7 days</h2>
<div class="panel">${
      traffic.total
        ? `<table><thead><tr><th>Page</th><th>Views</th></tr></thead><tbody>${traffic.top
            .map((t) => `<tr><td class="mono">${escapeHtml(t.path)}</td><td>${t.count}</td></tr>`)
            .join("")}</tbody></table>
<div class="empty">${traffic.total.toLocaleString("en-US")} page view${traffic.total === 1 ? "" : "s"} · first-party, no cookies</div>`
        : `<div class="empty">No page views recorded yet. Views are counted by a cookie-less beacon; Do Not Track is respected.</div>`
    }</div>`,
    { description: "Hunt history, reviewer corrections and LLM spend for this Bug Hunter instance." },
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
    `<span class="eyebrow"><b>Install</b> · the app is connected</span>
<h1>The hunter is <em>summoned.</em></h1>
<p class="lede">${installationId ? `Installation <code>${escapeHtml(installationId)}</code> connected. ` : ""}Open a pull request and watch the hunt begin.</p>
<div class="card"><h2>Connected repos</h2>${repoList}</div>
<p><a class="btn-ghost" href="/dashboard">View recent hunts →</a></p>`,
    { description: "Bug Hunter is installed. Open a pull request to summon the first hunt." },
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
<span class="eyebrow"><b>Setup</b> · connect a repo</span>
<h1>Connect a <em>repo.</em></h1>
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

  function busy(btn, on, out) {
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
    if (out) out.setAttribute('aria-busy', String(on));
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
    busy(huntBtn, true, out);
    // Async: start the hunt, then poll until the result exists. Avoids proxy
    // timeouts when a hunt takes ~2 minutes.
    post('/api/hunt', { pr_url: url, async: true }).then(function (r) {
      if (!r.ok) { busy(huntBtn, false, out); fail(out, r); return; }
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
                busy(huntBtn, false, out);
                out.textContent = '✗ Timed out waiting for the hunt. Check the pull request for the report.';
                return;
              }
              setTimeout(poll, 3000);
              return;
            }
            busy(huntBtn, false, out);
            if (x.status >= 400) { fail(out, { j: x.rec, status: x.status }); return; }
            showDone(out, x.rec);
          })
          .catch(function () { setTimeout(poll, 3000); });
      }
      poll();
    }).catch(function (e) { busy(huntBtn, false, out); out.textContent = '✗ ' + e.message; });
  });

  var connectBtn = document.getElementById('connect-btn');
  if (connectBtn) connectBtn.addEventListener('click', function () {
    var out = document.getElementById('connect-result');
    var repo = document.getElementById('repo').value.trim();
    var publicUrl = document.getElementById('public_url').value.trim();
    if (!repo) { out.textContent = '✗ Enter owner/name.'; return; }
    out.innerHTML = '🕸️ Connecting…';
    busy(connectBtn, true, out);
    post('/api/connect', { repo: repo, public_url: publicUrl }).then(function (r) {
      busy(connectBtn, false, out);
      if (!r.ok) { fail(out, r); return; }
      var hooks = 'https://github.com/' + encodeURI(r.j.repo) + '/settings/hooks';
      out.innerHTML = (r.j.created ? '✅ Webhook created on <b>' : '✅ Already connected: <b>') + esc(r.j.repo) +
        '</b>. Open a PR to trigger a hunt. <a href="' + esc(hooks) + '" target="_blank" rel="noreferrer">View the webhook</a>';
    }).catch(function (e) { busy(connectBtn, false, out); out.textContent = '✗ ' + e.message; });
  });
})();
</script>`;

  return shell("Bug Hunter — Connect a repo", body, { showCta: false, description: "Connect a GitHub repository to Bug Hunter or hunt a pull request now. Bring your own model; no telemetry." });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 404 page, in the same dossier shell as the rest of the site. */
export function renderNotFound(): string {
  return shell(
    "Bug Hunter — Not found",
    `<span class="eyebrow"><b>404</b> · nothing haunts this URL</span>
<h1>This page is a <em>ghost.</em></h1>
<p class="lede">The URL you followed does not exist on this server. It may have moved, or it may never have been here at all.</p>
<div class="cols">
  <div class="card">
    <h2>Try instead</h2>
    <p><a class="btn-ghost" href="/">Landing</a> <a class="btn-ghost" href="/connect">Connect a repo</a> <a class="btn-ghost" href="/dashboard">Dashboard</a></p>
  </div>
  <div class="card">
    <h2>Documentation</h2>
    <p>Quickstart, configuration, self-hosting, the CLI and the eval harness live in the repository.</p>
    <p><a class="btn" href="https://github.com/dk3yyyy/bug-hunter/tree/main/docs">Read the docs →</a></p>
  </div>
</div>`,
  );
}

/** Privacy policy: what the app stores, and what leaves the server. */
export function renderPrivacy(): string {
  return shell(
    "Bug Hunter — Privacy",
    `<span class="eyebrow"><b>Policy</b> · privacy and data</span>
<h1>Privacy, <em>plainly.</em></h1>
<p class="lede">Bug Hunter is open source. This page describes what the hosted instance and a self-hosted copy store, what leaves your server, and how to turn features off. Last updated 2026-11-08.</p>

<div class="panel" style="padding:1.3rem">
  <h2 style="margin-top:0">What is processed</h2>
  <p>To review a pull request, Bug Hunter sends the pull-request diff, title, description, linked issue text and selected repository files to the <strong>model provider you configure</strong> (Google, Anthropic, OpenAI, DeepSeek, OpenRouter, an OpenAI-compatible endpoint, or a local Ollama server). Those requests are subject to that provider's terms. Your API key stays in the server environment.</p>
  <p>Repository rule files (<code>.bughunter.md</code>, <code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.cursorrules</code>) are read from the base branch and sent with the review. API keys and secrets are scrubbed from logs and outgoing payloads.</p>

  <h2>What is stored</h2>
  <p>When <code>DATABASE_URL</code> is set, the server keeps:</p>
  <ul>
    <li><strong>Hunt history</strong> — repository, pull-request number/title/URL, finding counts, token usage and estimated cost.</li>
    <li><strong>Repo authorisation mapping</strong> — the GitHub login and that user's token, encrypted with AES-256-GCM using <code>SESSION_SECRET</code>. Tokens are never stored in plaintext.</li>
    <li><strong>Reviewer learnings</strong> — the correction text and a link to the comment it came from.</li>
    <li><strong>Installed repositories</strong> — the list GitHub reports for the App installation.</li>
    <li><strong>Page views</strong> — the path and a timestamp, with no IP address, user agent or cookie identifier.</li>
  </ul>
  <p>Without <code>DATABASE_URL</code> the same records live in process memory and disappear on restart. There are no third-party analytics scripts, ad trackers or tracking cookies.</p>

  <h2>Cookies and analytics</h2>
  <p>If GitHub login is enabled, one signed session cookie keeps you signed in. It is HTTP-only and encrypted. The site counts page views with a first-party beacon to this server; it stores only the path and time, and it is skipped when your browser sends Do Not Track or Global Privacy Control. Nothing is sent to a third party.</p>

  <h2>Third parties</h2>
  <p>GitHub (webhooks and API), the model provider you choose, and — only if you configure it — your own n8n webhook. There are no other outbound integrations.</p>

  <h2>Retention and deletion</h2>
  <p>Records are kept until the operator deletes them. Delete hunts or learnings through the dashboard/API, clear the database tables, or remove the deployment. For the hosted demo, open a GitHub issue in the repository to request deletion.</p>

  <h2>Self-hosting</h2>
  <p>If you run Bug Hunter yourself, you are the data controller. You decide which model provider receives diffs, whether Postgres is used, and whether n8n is configured. Nothing is sent anywhere else.</p>

  <p class="hint" style="margin-top:1.2rem">Questions or removal requests: open an issue at <a href="https://github.com/dk3yyyy/bug-hunter/issues">github.com/dk3yyyy/bug-hunter/issues</a>. Security reports: see <a href="https://github.com/dk3yyyy/bug-hunter/blob/main/SECURITY.md">SECURITY.md</a>.</p>
</div>`,
    { description: "What Bug Hunter stores, what leaves your server, and how to self-host without third-party analytics." },
  );
}
