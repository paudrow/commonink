// The part of the KV API that @cloudflare/workers-oauth-provider uses, on D1. D1 reads see every
// write at once (KV can take a minute to forget a deleted key), so revoking an agent takes effect
// immediately, and there's no extra resource to provision for production or Previews.

interface Put {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

const now = () => Math.floor(Date.now() / 1000);

export class D1Kv {
  constructor(private db: D1Database) {}

  async get(key: string, opts?: "text" | "json" | { type?: "text" | "json" }) {
    const row = await this.db.prepare("SELECT value FROM oauth_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)").bind(key, now()).first<{ value: string }>();
    if (!row) return null;
    const type = typeof opts === "string" ? opts : opts?.type;
    return type === "json" ? JSON.parse(row.value) : row.value;
  }

  async put(key: string, value: string, opts: Put = {}) {
    const expires = opts.expiration ?? (opts.expirationTtl ? now() + opts.expirationTtl : null);
    await this.db
      .prepare("INSERT INTO oauth_kv(key, value, metadata, expires_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, expires_at = excluded.expires_at")
      .bind(key, value, opts.metadata === undefined ? null : JSON.stringify(opts.metadata), expires)
      .run();
    // Expired records are invisible already; sweeping them now and then keeps the table small.
    if (Math.random() < 0.01) await this.db.prepare("DELETE FROM oauth_kv WHERE expires_at <= ?").bind(now()).run();
  }

  async delete(key: string) {
    await this.db.prepare("DELETE FROM oauth_kv WHERE key = ?").bind(key).run();
  }

  /** Keys in order, `limit` at a time; `cursor` is the last key of the previous page. */
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = opts.prefix ?? "";
    const limit = Math.min(opts.limit ?? 1000, 1000);
    const { results } = await this.db
      .prepare(
        `SELECT key, metadata, expires_at FROM oauth_kv
         WHERE substr(key, 1, ?) = ? AND key > ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?`,
      )
      .bind(prefix.length, prefix, opts.cursor ?? "", now(), limit + 1)
      .all<{ key: string; metadata: string | null; expires_at: number | null }>();
    const page = results.slice(0, limit);
    const done = results.length <= limit;
    return {
      keys: page.map((r) => ({
        name: r.key,
        ...(r.expires_at === null ? {} : { expiration: r.expires_at }),
        ...(r.metadata === null ? {} : { metadata: JSON.parse(r.metadata) }),
      })),
      list_complete: done,
      ...(done ? {} : { cursor: page.at(-1)!.key }),
      cacheStatus: null,
    };
  }
}
