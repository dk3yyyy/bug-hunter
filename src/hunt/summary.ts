import type { SeanceOutputT } from "../types";

/** A safe default summary used when the Séance pass fails (SPEC §11 step 10). */
export function emptySeance(): SeanceOutputT {
  return {
    summary: "",
    change_type: "chore",
    walkthrough: [],
    risk_areas: [],
    effort: 3,
    spooky_tagline: "",
  };
}
