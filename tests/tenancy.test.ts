// Per-repo authorisation: the user who connects a repo is remembered, and their
// token — not the operator's — is used for that repo's hunts. These pin the
// isolation and sealing properties, which are the whole point of the feature.
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRepoConnection,
  recallRepoConnection,
  rememberRepoConnection,
  repoConnectionCount,
  resetRepoConnections,
} from "../src/tenancy";

const SECRET = "tenancy-secret-under-test";

function remember(repo: string, login: string, token = `gho_${login}`): void {
  rememberRepoConnection(repo, { login, token }, SECRET);
}

beforeEach(() => {
  resetRepoConnections();
});

describe("repo connections", () => {
  it("round-trips the user behind a repo", () => {
    remember("dk3yyyy/bug-hunter", "dk3yyyy", "gho_abc123");
    expect(recallRepoConnection("dk3yyyy/bug-hunter", SECRET)).toEqual({
      login: "dk3yyyy",
      token: "gho_abc123",
    });
  });

  it("keeps repos isolated from each other", () => {
    remember("alice/project", "alice");
    remember("bob/project", "bob");
    expect(recallRepoConnection("alice/project", SECRET)?.login).toBe("alice");
    expect(recallRepoConnection("bob/project", SECRET)?.login).toBe("bob");
    // Same repo name, different owner: must not collide.
    expect(recallRepoConnection("alice/project", SECRET)?.token).toBe("gho_alice");
  });

  it("is case-insensitive on the repo name", () => {
    remember("Alice/Project", "alice");
    expect(recallRepoConnection("alice/project", SECRET)?.login).toBe("alice");
    expect(recallRepoConnection("ALICE/PROJECT", SECRET)?.login).toBe("alice");
  });

  it("returns null for a repo nobody connected", () => {
    expect(recallRepoConnection("stranger/repo", SECRET)).toBeNull();
  });

  it("rejects a mapping sealed under a different secret", () => {
    remember("alice/project", "alice");
    // A rotated SESSION_SECRET must not silently decrypt to a usable token.
    expect(recallRepoConnection("alice/project", "rotated-secret")).toBeNull();
  });

  it("treats an expired mapping as absent", () => {
    remember("alice/project", "alice");
    const farFuture = Date.now() + 400 * 24 * 60 * 60 * 1000;
    expect(recallRepoConnection("alice/project", SECRET, farFuture)).toBeNull();
  });

  it("replaces the mapping when a different user reconnects", () => {
    remember("shared/repo", "alice");
    remember("shared/repo", "bob");
    expect(recallRepoConnection("shared/repo", SECRET)?.login).toBe("bob");
    expect(repoConnectionCount()).toBe(1);
  });

  it("forgets a repo", () => {
    remember("alice/project", "alice");
    expect(forgetRepoConnection("ALICE/project")).toBe(true);
    expect(recallRepoConnection("alice/project", SECRET)).toBeNull();
    expect(forgetRepoConnection("alice/project")).toBe(false);
  });

  it("preserves refresh fields for expiring tokens", () => {
    const expiresAt = Date.now() + 28_800_000;
    rememberRepoConnection(
      "alice/project",
      { login: "alice", token: "gho_short", expiresAt, refreshToken: "ghr_refresh" },
      SECRET,
    );
    const conn = recallRepoConnection("alice/project", SECRET);
    expect(conn?.expiresAt).toBe(expiresAt);
    expect(conn?.refreshToken).toBe("ghr_refresh");
  });

  it("does not hand back a token for an unmapped repo after a reset", () => {
    remember("alice/project", "alice");
    resetRepoConnections();
    expect(repoConnectionCount()).toBe(0);
    expect(recallRepoConnection("alice/project", SECRET)).toBeNull();
  });
});
