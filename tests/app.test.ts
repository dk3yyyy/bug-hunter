// Unit tests for the GitHub App install-flow helpers (SPEC §6, Step 4).
// No network — installUrl is pure and the connectedRepos helpers are in-memory.
import { beforeEach, describe, expect, it, vi } from "vitest";

// env.ts validates + exits at import time, so set required env before importing app.ts.
vi.hoisted(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.N8N_SHARED_SECRET = "this-is-a-long-secret-123";
});

import { installUrl, addRepo, removeRepo, listRepos } from "../src/github/app";

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

describe("connectedRepos", () => {
  beforeEach(() => {
    for (const repo of listRepos()) removeRepo(repo);
  });

  it("starts empty", () => {
    expect(listRepos()).toEqual([]);
  });

  it("adds repos and lists them (deduplicated)", () => {
    addRepo("me/repo");
    addRepo("me/repo"); // Set semantics: no duplicate entries
    addRepo("you/other");
    expect(listRepos().sort()).toEqual(["me/repo", "you/other"]);
  });

  it("removes a repo", () => {
    addRepo("me/repo");
    addRepo("you/other");
    removeRepo("me/repo");
    expect(listRepos()).toEqual(["you/other"]);
  });

  it("listRepos returns a copy, not the live set", () => {
    addRepo("me/repo");
    const snapshot = listRepos();
    snapshot.push("fake/repo");
    expect(listRepos()).toEqual(["me/repo"]);
  });
});
