// Unit tests for the GitHub App install-flow helpers.
// No network — installUrl is pure and the connectedRepos helpers are in-memory.
import { beforeEach, describe, expect, it, vi } from "vitest";

// env.ts validates + exits at import time, so set required env before importing app.ts.
vi.hoisted(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
});

import { installUrl, connectUrlFor, addRepo, removeRepo, listRepos } from "../src/github/app";

describe("installUrl", () => {
  it("builds the install URL without a state param", () => {
    expect(installUrl("bug-hunter")).toBe(
      "https://github.com/apps/bug-hunter/installations/new",
    );
  });

  it("appends the state param when provided", () => {
    expect(installUrl("bug-hunter", "abc123")).toBe(
      "https://github.com/apps/bug-hunter/installations/new?state=abc123",
    );
  });

  it("URL-encodes the state", () => {
    expect(installUrl("bug-hunter", "a b")).toBe(
      "https://github.com/apps/bug-hunter/installations/new?state=a%20b",
    );
  });
});

describe("connectUrlFor", () => {
  it("uses GitHub's install page in App mode", () => {
    expect(
      connectUrlFor({ mode: "app", appSlug: "bug-hunter", appUrl: "https://bh.example.com" }),
    ).toBe("https://github.com/apps/bug-hunter/installations/new");
  });

  it("uses APP_URL's /connect in PAT mode when a deployment URL is set", () => {
    expect(
      connectUrlFor({ mode: "pat", appSlug: "", appUrl: "https://bh.example.com/" }),
    ).toBe("https://bh.example.com/connect");
  });

  it("falls back to this origin's /connect in PAT mode without APP_URL", () => {
    expect(connectUrlFor({ mode: "pat", appSlug: "", appUrl: "" })).toBe("/connect");
    expect(connectUrlFor({ mode: "pat", appSlug: "", appUrl: "   " })).toBe("/connect");
  });
});

describe("connectedRepos", () => {
  beforeEach(async () => {
    for (const repo of await listRepos()) await removeRepo(repo);
  });

  it("starts empty", async () => {
    expect(await listRepos()).toEqual([]);
  });

  it("adds repos and lists them (deduplicated)", async () => {
    await addRepo("me/repo");
    await addRepo("me/repo"); // Set semantics: no duplicate entries
    await addRepo("you/other");
    expect((await listRepos()).sort()).toEqual(["me/repo", "you/other"]);
  });

  it("removes a repo", async () => {
    await addRepo("me/repo");
    await addRepo("you/other");
    await removeRepo("me/repo");
    expect(await listRepos()).toEqual(["you/other"]);
  });

  it("listRepos returns a copy, not the live list", async () => {
    await addRepo("me/repo");
    const snapshot = await listRepos();
    snapshot.push("fake/repo");
    expect(await listRepos()).toEqual(["me/repo"]);
  });

  it("is case-insensitive", async () => {
    await addRepo("Me/Repo");
    expect(await listRepos()).toEqual(["me/repo"]);
    await removeRepo("ME/REPO");
    expect(await listRepos()).toEqual([]);
  });
});
