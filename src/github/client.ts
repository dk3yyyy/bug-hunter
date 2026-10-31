// GitHub auth (SPEC §6). Only PAT mode is wired for the hackathon (Option A).
// Nothing else in the codebase should care which option is in use.
import { Octokit } from "@octokit/rest";
import { env } from "../env";

export function getOctokit(): Octokit {
  if (env.GITHUB_MODE === "app") {
    throw new Error(
      "GitHub App mode is not wired yet (Step 4). Set GITHUB_MODE=pat and provide GITHUB_TOKEN.",
    );
  }
  return new Octokit({ auth: env.GITHUB_TOKEN });
}
