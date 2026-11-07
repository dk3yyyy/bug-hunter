import type { SeanceOutputT } from "../types";

/** A safe default summary used when the Séance pass fails. */
export function emptySeance(): SeanceOutputT {
  return {
    summary: "",
    change_type: "chore",
    walkthrough: [],
    risk_areas: [],
    effort: 3,
    spooky_tagline: "",
    sequence_diagram: null,
    issue_compliance: [],
  };
}
