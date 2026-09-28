// The two things the core needs from its environment. Locally: node:sqlite + a folder of files.
// On Cloudflare: a Durable Object's embedded SQLite for both.
import { newNoteId } from "./ids.ts";

/** A synchronous SQLite connection (node:sqlite locally, ctx.storage.sql in a Durable Object). */
export interface SqlDb {
  exec(sql: string): void;
  all<T = any>(sql: string, ...params: unknown[]): T[];
  get<T = any>(sql: string, ...params: unknown[]): T | undefined;
  run(sql: string, ...params: unknown[]): { lastId: number };
  tx<T>(fn: () => T): T;
}

export interface FileStat {
  mtime: number;
  size: number;
}

/** Where notes (and the list of binary assets) live. Paths are vault-relative, POSIX style. */
export interface Content {
  /** Text of a note, or null if it doesn't exist (or is binary). */
  read(rel: string): string | null;
  write(rel: string, text: string): FileStat;
  remove(rel: string): void;
  rename(from: string, to: string): void;
  stat(rel: string): FileStat | null;
  /** Every note and asset, hidden paths excluded. */
  list(): Array<{ path: string } & FileStat>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notes(
     path TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, stem TEXT NOT NULL,
     version TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, id TEXT)`,
  `CREATE INDEX IF NOT EXISTS notes_stem ON notes(stem)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
     path, title, body, tokenize='porter unicode61 remove_diacritics 2', prefix='2 3')`,
  `CREATE TABLE IF NOT EXISTS links(src TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS links_key ON links(key)`,
  `CREATE INDEX IF NOT EXISTS links_src ON links(src)`,
  `CREATE TABLE IF NOT EXISTS changes(
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, path TEXT NOT NULL, op TEXT NOT NULL,
     source TEXT NOT NULL, version TEXT, summary TEXT, from_path TEXT, before TEXT, note_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS changes_path ON changes(path, version)`,
];

/** Create or upgrade the index + change log tables. Safe to run on every start. */
export function migrate(db: SqlDb) {
  for (const stmt of SCHEMA) db.exec(stmt);
  // Indexes from before stable IDs lack the column. (ALTER, not a pragma: Durable Objects allow it.)
  try {
    db.exec("ALTER TABLE notes ADD COLUMN id TEXT");
  } catch {}
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id ON notes(id)");
  for (const { path } of db.all<{ path: string }>("SELECT path FROM notes WHERE id IS NULL")) {
    db.run("UPDATE notes SET id = ? WHERE path = ?", newNoteId(), path);
  }
  // Change logs from before changes carried the note's ID: fill it in where the log can tell.
  let added = true;
  try {
    db.exec("ALTER TABLE changes ADD COLUMN note_id TEXT");
  } catch {
    added = false;
  }
  if (added) db.tx(() => backfillChangeNoteIds(db));
  db.exec("CREATE INDEX IF NOT EXISTS changes_note ON changes(note_id, id)");
  // Older local indexes predate the `before` column. (Durable Objects may refuse pragmas; their
  // databases are always created with the current schema, so there's nothing to upgrade.)
  let cols: string[];
  try {
    cols = db.all<{ name: string }>("SELECT name FROM pragma_table_info('changes')").map((c) => c.name);
  } catch {
    return;
  }
  if (!cols.includes("before")) db.exec("ALTER TABLE changes ADD COLUMN before TEXT");
}

/**
 * Walk the log newest first from where each note is now: a move hands the ID back to the path it
 * came from, and a create ends that path's history (anything earlier there was a different note).
 */
function backfillChangeNoteIds(db: SqlDb) {
  const idAt = new Map(db.all<{ path: string; id: string }>("SELECT path, id FROM notes").map((r) => [r.path, r.id]));
  for (const c of db.all<{ id: number; path: string; op: string; from_path: string | null }>("SELECT id, path, op, from_path FROM changes ORDER BY id DESC")) {
    const id = idAt.get(c.path);
    if (!id) continue;
    db.run("UPDATE changes SET note_id = ? WHERE id = ?", id, c.id);
    if (c.from_path || c.op === "create") idAt.delete(c.path);
    if (c.from_path) idAt.set(c.from_path, id);
  }
}
