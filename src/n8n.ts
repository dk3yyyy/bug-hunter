// Outgoing hunt.completed event to n8n (SPEC §16.1). Fire-and-forget, never throws.
import { env } from "./env";
import { scrubSecrets } from "./security";
import type { HuntCounts } from "./types";

export interface HuntNotifyPayload {
  event: "hunt.completed";
  hunt_id: string;
  repo: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  haunting_level: string;
  counts: HuntCounts;
  top_findings: Array<{ severity: string; title: string; file: string; line: number }>;
  possession_attempt: boolean;
  false_alarms_exorcised: number;
  finished_at: string;
}

const TIMEOUT_MS = 5000;

export async function notifyHunt(payload: HuntNotifyPayload): Promise<void> {
  if (!env.N8N_HUNT_WEBHOOK_URL) return;
  const body = scrubSecrets(JSON.stringify(payload));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(env.N8N_HUNT_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-BugHunter-Secret": env.N8N_SHARED_SECRET,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // n8n being down must never break a hunt.
  }
}
