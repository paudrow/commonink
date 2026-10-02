// The core's storage interfaces on a Durable Object's embedded SQLite: queries run in-process.
import type { Content, FileStat, SqlDb } from "../../src/core/store.ts";

export class DoDb implements SqlDb {
  constructor(private storage: DurableObjectStorage) {}
  exec(sql: string) {
    this.storage.sql.exec(sql);
  }
  all<T = any>(sql: string, ...params: unknown[]): T[] {
    return this.storage.sql.exec(sql, ...params).toArray() as T[];
  }
  get<T = any>(sql: string, ...params: unknown[]): T | undefined {
    return this.all<T>(sql, ...params)[0];
  }
  run(sql: string, ...params: unknown[]) {
    const { sql: db } = this.storage;
    db.exec(sql, ...params);
    // Looked up only when read, which the few callers that need it do straight after the insert.
    return {
      get lastId() {
        return Number(db.exec("SELECT last_insert_rowid() AS id").one().id);
      },
    };
  }
  tx<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
}

/**
 * Notes live in a `files` table next to the index. Binary files (uploads) have a row here for
 * listing and search, with their bytes in R2 under `blob`.
 */
export class SqlContent implements Content {
  /** `dropBlob` deletes an upload's bytes from R2 once nothing lists it any more. */
  constructor(
    private db: DoDb,
    private dropBlob: (key: string) => void = () => {},
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS files(
      path TEXT PRIMARY KEY, text TEXT, mtime REAL NOT NULL, size INTEGER NOT NULL, blob TEXT, mime TEXT)`);
  }
  read(rel: string) {
    return this.db.get<{ text: string | null }>("SELECT text FROM files WHERE path = ?", rel)?.text ?? null;
  }
  write(rel: string, text: string): FileStat {
    const old = this.blob(rel)?.blob;
    const st = { mtime: Date.now(), size: new TextEncoder().encode(text).length };
    this.db.run(
      `INSERT INTO files(path, text, mtime, size) VALUES (?,?,?,?)
       ON CONFLICT(path) DO UPDATE SET text=excluded.text, mtime=excluded.mtime, size=excluded.size, blob=NULL`,
      rel, text, st.mtime, st.size,
    );
    if (old) this.dropBlob(old);
    return st;
  }
  /** Register an uploaded file whose bytes are in R2. */
  putBlob(rel: string, key: string, size: number, mime: string) {
    const old = this.blob(rel)?.blob;
    this.db.run(
      `INSERT INTO files(path, text, mtime, size, blob, mime) VALUES (?,NULL,?,?,?,?)
       ON CONFLICT(path) DO UPDATE SET text=NULL, mtime=excluded.mtime, size=excluded.size, blob=excluded.blob, mime=excluded.mime`,
      rel, Date.now(), size, key, mime,
    );
    if (old && old !== key) this.dropBlob(old);
  }
  blob(rel: string) {
    return this.db.get<{ blob: string | null; mime: string | null; size: number }>("SELECT blob, mime, size FROM files WHERE path = ?", rel) ?? null;
  }
  remove(rel: string) {
    const key = this.blob(rel)?.blob;
    this.db.run("DELETE FROM files WHERE path = ?", rel);
    if (key) this.dropBlob(key);
  }
  rename(from: string, to: string) {
    this.db.run("UPDATE files SET path = ?, mtime = ? WHERE path = ?", to, Date.now(), from);
  }
  stat(rel: string): FileStat | null {
    return this.db.get<FileStat>("SELECT mtime, size FROM files WHERE path = ?", rel) ?? null;
  }
  same(a: string, b: string) {
    return a === b && !!this.stat(a);
  }
  list() {
    return this.db.all<{ path: string } & FileStat>("SELECT path, mtime, size FROM files WHERE path NOT LIKE '.%' AND path NOT LIKE '%/.%'");
  }
  listUnder(dir: string) {
    return this.db.all<{ path: string } & FileStat>("SELECT path, mtime, size FROM files WHERE substr(path, 1, ?) = ?", dir.length + 1, `${dir}/`);
  }
  get isEmpty() {
    return !this.db.get("SELECT 1 AS x FROM files LIMIT 1");
  }
}
