import { describe, expect, it } from "vitest";
import { isRetryableGithubError, withRetry } from "../src/github/api";

describe("isRetryableGithubError", () => {
  it("retries 429/5xx and transient network errors", () => {
    expect(isRetryableGithubError({ status: 500 })).toBe(true);
    expect(isRetryableGithubError({ status: 502 })).toBe(true);
    expect(isRetryableGithubError({ status: 429 })).toBe(true);
    expect(isRetryableGithubError({ message: "read ECONNRESET" })).toBe(true);
    expect(isRetryableGithubError({ message: "socket hang up" })).toBe(true);
  });

  it("does not retry client errors or non-errors", () => {
    expect(isRetryableGithubError({ status: 401 })).toBe(false);
    expect(isRetryableGithubError({ status: 422 })).toBe(false);
    expect(isRetryableGithubError(null)).toBe(false);
    expect(isRetryableGithubError(undefined)).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries a transient failure, then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw { status: 503 };
        return "ok";
      },
      3,
      1,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { status: 401, message: "Bad credentials" };
        },
        3,
        1,
      ),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });
});
