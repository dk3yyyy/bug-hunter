// Hunt history. Postgres when DATABASE_URL is set, in-memory otherwise, so the
// dashboard survives restarts in production without breaking local dev/test.
import { Pool } from "pg";
import type { HuntRecord } from "./types";

export interface HuntStore {
  save(record: HuntRecord): Promise<void>;
  get(id: string): Promise<HuntRecord | null>;
  list(limit: number): Promise<HuntRecord[]>;
  close(): Promise<void>;
}

const MAX_MEMORY = 500;

class MemoryHuntStore implements HuntStore {
  private readonly map = new Map<string, HuntRecord>();

  async save(record: HuntRecord): Promise<void> {
    this.map.set(record.id, record);
    while (this.map.size > MAX_MEMORY) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  async get(id: string): Promise<HuntRecord | null> {
    return this.map.get(id) ?? null;
  }

  async list(limit: number): Promise<HuntRecord[]> {
    return [...this.map.values()].slice(-limit).reverse();
  }

  async close(): Promise<void> {
    // nothing to close
  }
}

class PgHuntStore implements HuntStore {
  private readonly pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS hunts (
             id TEXT PRIMARY KEY,
             record JSONB NOT NULL,
             finished_at TIMESTAMPTZ NOT NULL
           );
           CREATE INDEX IF NOT EXISTS hunts_finished_at_idx ON hunts (finished_at DESC);`,
        )
        .then(() => undefined)
        .catch((e) => {
          this.ready = null;
          throw e;
        });
    }
    return this.ready;
  }

  async save(record: HuntRecord): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO hunts (id, record, finished_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, finished_at = EXCLUDED.finished_at`,
      [record.id, JSON.stringify(record), record.finishedAt],
    );
  }

  async get(id: string): Promise<HuntRecord | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ record: HuntRecord }>(
      "SELECT record FROM hunts WHERE id = $1",
      [id],
    );
    return rows[0]?.record ?? null;
  }

  async list(limit: number): Promise<HuntRecord[]> {
    await this.ensure();
    const { rows } = await this.pool.query<{ record: HuntRecord }>(
      "SELECT record FROM hunts ORDER BY finished_at DESC LIMIT $1",
      [limit],
    );
    return rows.map((r) => r.record);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createHuntStore(databaseUrl: string): HuntStore {
  const url = databaseUrl.trim();
  return url ? new PgHuntStore(url) : new MemoryHuntStore();
}
