// Persistence. Postgres when DATABASE_URL is set, in-memory otherwise, so
// production survives restarts without breaking local dev/test.
import { Pool } from "pg";
import type { HuntRecord } from "./types";

export interface HuntStore {
  save(record: HuntRecord): Promise<void>;
  get(id: string): Promise<HuntRecord | null>;
  list(limit: number): Promise<HuntRecord[]>;
  setConnection(repo: string, sealed: string): Promise<void>;
  getConnection(repo: string): Promise<string | null>;
  deleteConnection(repo: string): Promise<boolean>;
  connectionCount(): Promise<number>;
  /** Test/maintenance helper: drop every connection mapping. */
  clearConnections(): Promise<void>;
  close(): Promise<void>;
}

const MAX_MEMORY = 500;

class MemoryHuntStore implements HuntStore {
  private readonly hunts = new Map<string, HuntRecord>();
  private readonly connections = new Map<string, string>();

  async save(record: HuntRecord): Promise<void> {
    this.hunts.set(record.id, record);
    while (this.hunts.size > MAX_MEMORY) {
      const oldest = this.hunts.keys().next().value;
      if (oldest === undefined) break;
      this.hunts.delete(oldest);
    }
  }

  async get(id: string): Promise<HuntRecord | null> {
    return this.hunts.get(id) ?? null;
  }

  async list(limit: number): Promise<HuntRecord[]> {
    return [...this.hunts.values()].slice(-limit).reverse();
  }

  async setConnection(repo: string, sealed: string): Promise<void> {
    this.connections.set(repo, sealed);
  }

  async getConnection(repo: string): Promise<string | null> {
    return this.connections.get(repo) ?? null;
  }

  async deleteConnection(repo: string): Promise<boolean> {
    return this.connections.delete(repo);
  }

  async connectionCount(): Promise<number> {
    return this.connections.size;
  }

  async clearConnections(): Promise<void> {
    this.connections.clear();
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
           CREATE INDEX IF NOT EXISTS hunts_finished_at_idx ON hunts (finished_at DESC);
           CREATE TABLE IF NOT EXISTS repo_connections (
             repo TEXT PRIMARY KEY,
             sealed TEXT NOT NULL,
             updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
           );`,
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

  async setConnection(repo: string, sealed: string): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO repo_connections (repo, sealed, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (repo) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = now()`,
      [repo, sealed],
    );
  }

  async getConnection(repo: string): Promise<string | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ sealed: string }>(
      "SELECT sealed FROM repo_connections WHERE repo = $1",
      [repo],
    );
    return rows[0]?.sealed ?? null;
  }

  async deleteConnection(repo: string): Promise<boolean> {
    await this.ensure();
    const result = await this.pool.query("DELETE FROM repo_connections WHERE repo = $1", [repo]);
    return (result.rowCount ?? 0) > 0;
  }

  async connectionCount(): Promise<number> {
    await this.ensure();
    const { rows } = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM repo_connections",
    );
    return Number(rows[0]?.n ?? 0);
  }

  async clearConnections(): Promise<void> {
    await this.ensure();
    await this.pool.query("DELETE FROM repo_connections");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createHuntStore(databaseUrl: string): HuntStore {
  const url = databaseUrl.trim();
  return url ? new PgHuntStore(url) : new MemoryHuntStore();
}

let singleton: HuntStore | null = null;

/** Process-wide store, used by modules that cannot receive it as an argument. */
export function store(): HuntStore {
  if (!singleton) singleton = createHuntStore(process.env.DATABASE_URL ?? "");
  return singleton;
}
