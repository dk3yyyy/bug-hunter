// Build the static GitHub Pages site (dist/).
//
// - dist/index.html: the landing, with connect/repo/dashboard links resolved.
// - dist/404.html:   the styled not-found page for GitHub Pages.
// - dist/og.png, favicons, site.webmanifest: social + PWA assets.
// - dist/robots.txt, dist/sitemap.xml: crawler metadata.
//
// The server does the landing substitutions in src/render/pages.ts
// (renderLanding) and serves the same assets from docs/.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const repoUrl = (process.env.REPO_URL || "https://github.com/dk3yyyy/bug-hunter").replace(/\/+$/, "");
const appUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
const appSlug = (process.env.APP_SLUG || "").trim();
// Sub-path this site is served from ("/" locally, "/bug-hunter/" on Pages).
const basePath = (process.env.PAGES_BASE || "/").replace(/\/?$/, "/");
// Absolute site URL for sitemap/canonical intent.
const pagesUrl = (
  process.env.PAGES_URL ||
  `https://${(repoUrl.split("/")[3] || "dk3yyyy").toLowerCase()}.github.io/${repoUrl.split("/").pop() || ""}/`
).replace(/\/?$/, "/");

const connectUrl = appSlug
  ? `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`
  : appUrl
    ? `${appUrl}/connect`
    : "#connect";

const html = readFileSync(new URL("../src/render/landing.html", import.meta.url), "utf8")
  .replaceAll('href="#connect"', `href="${connectUrl}"`)
  .replaceAll('href="#repo"', `href="${repoUrl}"`)
  // App-only pages: point at the hosted instance, or drop the link when there
  // is no server to serve them.
  .replaceAll('href="/privacy"', appUrl ? `href="${appUrl}/privacy"` : "/privacy")
  .replace(
    '<meta name="bh-analytics" content="/api/analytics/collect">',
    appUrl
      ? `<meta name="bh-analytics" content="${appUrl}/api/analytics/collect">`
      : '<meta name="bh-analytics" content="/api/analytics/collect">',
  )
  .replace(
    /<a href="\/dashboard" data-nav="dashboard">[\s\S]*?<\/a>/,
    appUrl
      ? `<a href="${appUrl}/dashboard" data-nav="dashboard"><span class="n">↗</span>Dashboard</a>`
      : "",
  );

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);

// 404 for GitHub Pages (served for any unknown path under the project site).
const notFound = readFileSync(new URL("../src/render/404.html", import.meta.url), "utf8")
  .replaceAll("{{base}}", basePath)
  .replaceAll("{{connect}}", connectUrl);
writeFileSync("dist/404.html", notFound);

// Social card + favicon set.
const docs = new URL("../docs/", import.meta.url);
for (const file of [
  "og.png",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
]) {
  copyFileSync(new URL(file, docs), `dist/${file}`);
}


// The manifest's start_url differs between the Pages sub-path and a server root.
const manifest = JSON.parse(readFileSync(new URL("site.webmanifest", docs), "utf8"));
manifest.start_url = basePath;
writeFileSync("dist/site.webmanifest", JSON.stringify(manifest, null, 2) + "\n");

writeFileSync(
  "dist/robots.txt",
  `User-agent: *\nAllow: /\n\nSitemap: ${pagesUrl}sitemap.xml\n`,
);

writeFileSync(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${pagesUrl}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`,
);

console.log(`landing -> dist/index.html (connect: ${connectUrl}, base: ${basePath})`);
