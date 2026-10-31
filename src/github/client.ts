// GitHub auth (SPEC §6). PAT mode (Option A) or GitHub App mode (Step 4).
// Nothing else in the codebase should care which option is in use.
import { Octokit } from "@octokit/rest";
import { env } from "../env";
import { installationOctokit } from "./app";

/**
 * An authenticated Octokit. In PAT mode this is synchronous auth via GITHUB_TOKEN.
 * In App mode the token is installation-scoped, so an installation id is required.
 */
export async function getOctokit(installationId?: number): Promise<Octokit> {
  if (env.GITHUB_MODE === "app") {
    if (installationId === undefined) {
      throw new Error(
        "GITHUB_MODE=app requires an installation id — call getOctokit(installationId).",
      );
    }
    return installationOctokit(installationId);
  }
  return new Octokit({ auth: env.GITHUB_TOKEN });
}
