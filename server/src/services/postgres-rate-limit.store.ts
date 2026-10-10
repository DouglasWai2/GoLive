import { createHash } from "node:crypto";
import type { Pool } from "pg";

type RateLimitStoreOptions = {
  routeInfo?: {
    method?: string | string[];
    url?: string;
    path?: string;
  };
};

type RateLimitStoreResult = { current: number; ttl: number };
type RateLimitStoreCallback = (error: Error | null, result?: RateLimitStoreResult) => void;

class PostgresRateLimitStore {
  constructor(
    private readonly pool: Pool,
    private readonly namespace: string,
  ) {}

  incr(key: string, callback: RateLimitStoreCallback, timeWindow: number, _max: number): void {
    const keyHash = createHash("sha256")
      .update(`${this.namespace}\0${key}`)
      .digest("hex");

    void this.pool.query<{ current: number; ttl: number }>(
      `INSERT INTO api_rate_limits (key_hash, hits, expires_at)
       VALUES ($1, 1, clock_timestamp() + ($2::double precision * interval '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE SET
         hits = CASE
           WHEN api_rate_limits.expires_at <= clock_timestamp() THEN 1
           ELSE api_rate_limits.hits + 1
         END,
         expires_at = CASE
           WHEN api_rate_limits.expires_at <= clock_timestamp()
             THEN clock_timestamp() + ($2::double precision * interval '1 millisecond')
           ELSE api_rate_limits.expires_at
         END
       RETURNING hits AS current,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())) * 1000))::integer AS ttl`,
      [keyHash, timeWindow],
    ).then(({ rows }) => {
      const row = rows[0];
      if (!row) {
        callback(new Error("PostgreSQL rate-limit store returned no counter"));
        return;
      }
      callback(null, { current: Number(row.current), ttl: Number(row.ttl) });
    }).catch((error: unknown) => {
      callback(error instanceof Error ? error : new Error("PostgreSQL rate-limit store failed"));
    });
  }

  child(options: object): PostgresRateLimitStore {
    const route = (options as RateLimitStoreOptions).routeInfo;
    const method = Array.isArray(route?.method) ? route.method.join(",") : route?.method;
    const routeName = method || route?.url || route?.path
      ? `${method ?? "*"}:${route?.url ?? route?.path ?? "*"}`
      : "custom";
    return new PostgresRateLimitStore(this.pool, `${this.namespace}:${routeName}`);
  }
}

export function createPostgresRateLimitStore(pool: Pool) {
  return class extends PostgresRateLimitStore {
    constructor(options: RateLimitStoreOptions) {
      super(pool, "global");
      void options;
    }
  };
}
