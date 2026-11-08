// Landing-page guardrails: the marketing copy must describe the product that
// exists, and the static build must not ship dead links or stale positioning.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/render/landing.html", import.meta.url), "utf8");

describe("landing page", () => {
  it("has no hackathon or abandoned-product framing", () => {
    for (const stale of ["GDG", "Hacktoberfest", "Hack Day", "OpenReview", "Automate the Nightmare"]) {
      expect(html, stale).not.toContain(stale);
    }
  });

  it("describes the shipped toolchain", () => {
    expect(html).toContain('id="toolkit"');
    for (const feature of [
      "Linked issues",
      "Sequence diagrams",
      "It learns from you",
      "Spend, capped",
      "Runs on your machine",
      "Eval in CI",
      "Deterministic linters",
      "Postgres when you want it",
    ]) {
      expect(html, feature).toContain(feature);
    }
  });

  it("lists the supported providers", () => {
    for (const provider of ["Gemini", "Anthropic", "OpenAI", "DeepSeek", "OpenRouter", "Ollama"]) {
      expect(html, provider).toContain(provider);
    }
  });

  it("links the docs absolutely so the static build cannot 404", () => {
    expect(html).toContain("https://github.com/dk3yyyy/bug-hunter/blob/main/docs/QUICKSTART.md");
    expect(html).toContain("https://github.com/dk3yyyy/bug-hunter/blob/main/docs/CLI.md");
    expect(html).toContain("https://github.com/dk3yyyy/bug-hunter/blob/main/SECURITY.md");
  });

  it("offers a Star on GitHub button", () => {
    expect(html).toContain("Star on GitHub");
    expect(html).toContain('class="star-count"');
    expect(html).toContain('href="https://github.com/dk3yyyy/bug-hunter"');
  });

  it("ships share metadata and a favicon", () => {
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('rel="icon"');
  });

  it("keeps element ids unique", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("keeps the connect/repo anchors the build script rewrites", () => {
    expect(html).toContain('href="#connect"');
    expect(html).toContain('href="#repo"');
    expect(html).toContain('href="/dashboard" data-nav="dashboard"');
  });

  it("uses the dossier layout: index rail and numbered sections", () => {
    expect(html).toContain('class="rail"');
    for (const section of ["how", "look", "toolkit", "bestiary", "possession", "automation", "run"]) {
      expect(html, section).toContain(`id="${section}"`);
    }
  });
});
