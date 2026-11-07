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

// Force the in-memory store for these tests.
delete process.env.DATABASE_URL;

const SECRET = "tenancy-secret-under-test";

async function remember(repo: string, login: string, token = `gho_${login}`): Promise<void> {
  await rememberRepoConnection(repo, { login, token }, SECRET);
}

beforeEach(async () => {
  await resetRepoConnections();
});

describe("repo connections", () => {
  it("round-trips the user behind a repo", async () => {
    await remember("dk3yyyy/bug-hunter", "dk3yyyy", "gho_abc123");
    expect(await recallRepoConnection("dk3yyyy/bug-hunter", SECRET)).toEqual({
      login: "dk3yyyy",
      token: "gho_abc123",
    });
  });

  it("keeps repos isolated from each other", async () => {
    await remember("alice/project", "alice");
    await remember("bob/project", "bob");
    expect((await recallRepoConnection("alice/project", SECRET))?.login).toBe("alice");
    expect((await recallRepoConnection("bob/project", SECRET))?.login).toBe("bob");
    // Same repo name, different owner: must not collide.
    expect((await recallRepoConnection("alice/project", SECRET))?.token).toBe("gho_alice");
  });

  it("is case-insensitive on the repo name", async () => {
    await remember("Alice/Project", "alice");
    expect((await recallRepoConnection("alice/project", SECRET))?.login).toBe("alice");
    expect((await recallRepoConnection("ALICE/PROJECT", SECRET))?.login).toBe("alice");
  });

  it("returns null for a repo nobody connected", async () => {
    expect(await recallRepoConnection("stranger/repo", SECRET)).toBeNull();
  });

  it("rejects a mapping sealed under a different secret", async () => {
    await remember("alice/project", "alice");
    // A rotated SESSION_SECRET must not silently decrypt to a usable token.
    expect(await recallRepoConnection("alice/project", "rotated-secret")).toBeNull();
  });

  it("treats an expired mapping as absent", async () => {
    await remember("alice/project", "alice");
    const farFuture = Date.now() + 400 * 24 * 60 * 60 * 1000;
    expect(await recallRepoConnection("alice/project", SECRET, farFuture)).toBeNull();
  });

  it("replaces the mapping when a different user reconnects", async () => {
    await remember("shared/repo", "alice");
    await remember("shared/repo", "bob");
    expect((await recallRepoConnection("shared/repo", SECRET))?.login).toBe("bob");
    expect(await repoConnectionCount()).toBe(1);
  });

  it("forgets a repo", async () => {
    await remember("alice/project", "alice");
    expect(await forgetRepoConnection("ALICE/project")).toBe(true);
    expect(await recallRepoConnection("alice/project", SECRET)).toBeNull();
    expect(await forgetRepoConnection("alice/project")).toBe(false);
  });

  it("preserves refresh fields for expiring tokens", async () => {
    const expiresAt = Date.now() + 28_800_000;
    await rememberRepoConnection(
      "alice/project",
      { login: "alice", token: "gho_short", expiresAt, refreshToken: "ghr_refresh" },
      SECRET,
    );
    const conn = await recallRepoConnection("alice/project", SECRET);
    expect(conn?.expiresAt).toBe(expiresAt);
    expect(conn?.refreshToken).toBe("ghr_refresh");
  });

  it("does not hand back a token for an unmapped repo after a reset", async () => {
    await remember("alice/project", "alice");
    await resetRepoConnections();
    expect(await repoConnectionCount()).toBe(0);
    expect(await recallRepoConnection("alice/project", SECRET)).toBeNull();
  });
});
