// Build the static GitHub Pages landing (dist/index.html).
//
// The server does the same two substitutions in src/render/pages.ts (renderLanding).
// The connect target is decided here because a static page can only offer:
//   1. APP_SLUG set -> GitHub App install page (real one-click; webhooks need a
//      public server, but the install itself works with no backend).
//   2. APP_URL set  -> that deployment's /connect page.
//   3. neither      -> stay on this page and scroll to the "Connect a repo"
//      self-host section. Never bounce people to a README anchor.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const repoUrl = (process.env.REPO_URL || "https://github.com/dk3yyyy/bug-hunter").replace(/\/+$/, "");
const appUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
const appSlug = (process.env.APP_SLUG || "").trim();

const connectUrl = appSlug
  ? `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`
  : appUrl
    ? `${appUrl}/connect`
    : "#connect";

const html = readFileSync(new URL("../src/render/landing.html", import.meta.url), "utf8")
  .replaceAll('href="#connect"', `href="${connectUrl}"`)
  .replaceAll('href="#repo"', `href="${repoUrl}"`)
  // "/dashboard" only exists on a running server. Point it at the hosted app,
  // or remove the nav item on the static site instead of shipping a 404.
  .replace(
    /<a href="\/dashboard" data-nav="dashboard">[\s\S]*?<\/a>/,
    appUrl
      ? `<a href="${appUrl}/dashboard" data-nav="dashboard"><span class="n">↗</span>Dashboard</a>`
      : "",
  );

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`landing -> dist/index.html (connect: ${connectUrl})`);
