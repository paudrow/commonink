// The two things the core needs from its environment. Locally: node:sqlite + a folder of files.
// On Cloudflare: a Durable Object's embedded SQLite for both.
import { legacyActor } from "./actor.ts";
import { newNoteId } from "./ids.ts";
import { compactNote } from "./changeTexts.ts";

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
  /** Whether two paths name one existing file (on a case-insensitive disk, "Notes.md" and "notes.md" do). */
  same(a: string, b: string): boolean;
  /** Every note and asset, hidden paths excluded. */
  list(): Array<{ path: string } & FileStat>;
  /** Every file under the folder `dir`, hidden or not (Trash lives in one). */
  listUnder(dir: string): Array<{ path: string } & FileStat>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notes(
     path TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, stem TEXT NOT NULL,
     version TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, id TEXT, date TEXT)`,
  `CREATE INDEX IF NOT EXISTS notes_stem ON notes(stem)`,
  // A file new to the index looks for the note it was renamed from by content.
  `CREATE INDEX IF NOT EXISTS notes_version ON notes(version)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
     path, title, body, tokenize='porter unicode61 remove_diacritics 2', prefix='2 3')`,
  `CREATE TABLE IF NOT EXISTS links(src TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS links_key ON links(key)`,
  `CREATE INDEX IF NOT EXISTS links_src ON links(src)`,
  // Where each tag is used: a note line (frontmatter or body), a task line, or an asset (line 0).
  `CREATE TABLE IF NOT EXISTS tags(tag TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag)`,
  `CREATE INDEX IF NOT EXISTS tags_path ON tags(path)`,
  // How each tag is shown: segment by segment, the way it was first written.
  `CREATE TABLE IF NOT EXISTS tag_names(tag TEXT PRIMARY KEY, display TEXT NOT NULL)`,
  // Each note's tasks as read when it was indexed (see Vault.tasks): the columns queries filter on, the rest as JSON.
  `CREATE TABLE IF NOT EXISTS tasks(path TEXT NOT NULL, line INTEGER NOT NULL, done INTEGER NOT NULL, due TEXT, start TEXT, task TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tasks_path ON tasks(path)`,
  `CREATE TABLE IF NOT EXISTS changes(
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, path TEXT NOT NULL, op TEXT NOT NULL,
     source TEXT NOT NULL, version TEXT, summary TEXT, from_path TEXT, before TEXT, note_id TEXT, person TEXT, agent TEXT,
     autosave INTEGER, base_id INTEGER)`,
  // One-off upgrades to stored data that have finished, by name.
  `CREATE TABLE IF NOT EXISTS upgrades(name TEXT PRIMARY KEY)`,
  `CREATE INDEX IF NOT EXISTS changes_path ON changes(path, version)`,
  // Labels: a name on one version of a note ("Sent to Alex", "v1"), after the change
  // `change_id` (null if the log has no change at that version). A label keeps the version's `text`
  // itself, so it stays whatever becomes of the change log, until the label is deleted or its note is
  // deleted forever.
  `CREATE TABLE IF NOT EXISTS labels(
     id TEXT PRIMARY KEY, note_id TEXT NOT NULL, change_id INTEGER, name TEXT NOT NULL, description TEXT,
     version TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL, person TEXT, agent TEXT)`,
  `CREATE INDEX IF NOT EXISTS labels_note ON labels(note_id, change_id)`,
  // Each person's starred notes, in their order. `path` is where the note was last seen, so a star
  // can find its note again if the note comes back under a new ID (deleted, then restored).
  `CREATE TABLE IF NOT EXISTS favorites(
     user TEXT NOT NULL, note_id TEXT NOT NULL, path TEXT NOT NULL, pos INTEGER NOT NULL,
     PRIMARY KEY(user, note_id))`,
  // Saved note queries in the sidebar (see query.ts). A null `owner` shares one with the whole
  // workspace; a user ID makes it just that person's.
  `CREATE TABLE IF NOT EXISTS smart_folders(
     id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, owner TEXT, pos INTEGER NOT NULL)`,
  // Tags someone added by name before anything carried them, shared with the whole workspace. One
  // stays until a note, task or asset uses it (or a tag under it); then it's an ordinary tag.
  `CREATE TABLE IF NOT EXISTS added_tags(tag TEXT PRIMARY KEY)`,
];

/**
 * Create or upgrade the index + change log tables. Safe to run on every start. `local`: a vault on
 * disk, whose old change log reads differently (see legacyActor).
 */
export function migrate(db: SqlDb, opts: { local?: boolean } = {}) {
  const lacks = (table: string) => {
    try {
      db.get(`SELECT 1 FROM ${table} LIMIT 1`);
      return false;
    } catch {
      return true;
    }
  };
  const stale = lacks("tags") || lacks("tasks");
  for (const stmt of SCHEMA) db.exec(stmt);
  // An index from before tags (or tasks): have the next sync read every note again to find them.
  if (stale) db.run("UPDATE notes SET mtime = -1");
  // Links are kept by the name they end in, without folders (see backlinks in the core). An index from
  // before that has keys with folders in them: the next sync reads every note again to replace them.
  if (db.get("SELECT 1 FROM links WHERE key LIKE '%/%' LIMIT 1")) db.run("UPDATE notes SET mtime = -1");
  // Indexes from before stable IDs lack the column. (ALTER, not a pragma: Durable Objects allow it.)
  try {
    db.exec("ALTER TABLE notes ADD COLUMN id TEXT");
  } catch {}
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id ON notes(id)");
  for (const { path } of db.all<{ path: string }>("SELECT path FROM notes WHERE id IS NULL")) {
    db.run("UPDATE notes SET id = ? WHERE path = ?", newNoteId(), path);
  }
  // Names are indexed in composed Unicode (see stemOf): the next sync reads again any note indexed before that.
  for (const { path, stem } of db.all<{ path: string; stem: string }>("SELECT path, stem FROM notes")) {
    if (stem !== stem.normalize("NFC")) db.run("UPDATE notes SET mtime = -1 WHERE path = ?", path);
  }
  // Each note's row in the full-text index (`fts`), so reindexing a note replaces its row directly:
  // FTS5 can only find a row by path by reading every row. Older indexes learn theirs in one pass.
  db.tx(() => {
    try {
      db.exec("ALTER TABLE notes ADD COLUMN fts INTEGER");
    } catch {
      return;
    }
    for (const r of db.all<{ fts: number; path: string }>("SELECT rowid AS fts, path FROM notes_fts")) db.run("UPDATE notes SET fts = ? WHERE path = ?", r.fts, r.path);
  });
  // Change logs from before changes carried the note's ID: fill it in where the log can tell. One
  // transaction, so an upgrade that dies partway leaves the column out and runs again next start.
  db.tx(() => {
    try {
      db.exec("ALTER TABLE changes ADD COLUMN note_id TEXT");
    } catch {
      return;
    }
    backfillChangeNoteIds(db);
  });
  db.exec("CREATE INDEX IF NOT EXISTS changes_note ON changes(note_id, id)");
  // Who made each change, a person or an agent for one, so History can tell them apart. Older
  // rows get theirs from the source text, once, in the same transaction as the new columns.
  db.tx(() => {
    try {
      db.exec("ALTER TABLE changes ADD COLUMN person TEXT");
      db.exec("ALTER TABLE changes ADD COLUMN agent TEXT");
    } catch {
      return;
    }
    for (const { source } of db.all<{ source: string }>("SELECT DISTINCT source FROM changes")) {
      const a = legacyActor(source, !!opts.local);
      db.run("UPDATE changes SET person = ?, agent = ? WHERE source = ?", a.person, a.agent, source);
    }
  });
  db.exec("CREATE INDEX IF NOT EXISTS changes_agent ON changes(agent, id)");
  // Each note's own date (see dateOf), for sort=date. An index from before it reads every note again.
  try {
    db.exec("ALTER TABLE notes ADD COLUMN date TEXT");
    db.run("UPDATE notes SET mtime = -1");
  } catch {}
  // Older local indexes predate the `before` column.
  try {
    db.exec("ALTER TABLE changes ADD COLUMN before TEXT");
  } catch {}
  // Which changes are a person's editor autosaves, that a later one in the same sitting may join.
  // Older rows stay unmarked: nothing joins them.
  try {
    db.exec("ALTER TABLE changes ADD COLUMN autosave INTEGER");
  } catch {}
  // Older texts are deltas from newer ones (see changeTexts.ts). A log from before that keeps every
  // text whole until this pass stores them as deltas, note by note (see compactNote).
  try {
    db.exec("ALTER TABLE changes ADD COLUMN base_id INTEGER");
  } catch {}
  db.exec("CREATE INDEX IF NOT EXISTS changes_base ON changes(base_id) WHERE base_id IS NOT NULL");
  if (!db.get("SELECT 1 FROM upgrades WHERE name = 'change deltas'")) {
    let converted = 0;
    for (const { note_id } of db.all<{ note_id: string }>("SELECT DISTINCT note_id FROM changes WHERE note_id IS NOT NULL AND before IS NOT NULL ORDER BY note_id")) {
      converted += compactNote(db, note_id);
    }
    db.run("INSERT INTO upgrades(name) VALUES ('change deltas')");
    // SQLite reuses the pages the deltas freed but never gives them back. A vault on disk gets them
    // back once; a Durable Object can't VACUUM.
    if (opts.local && converted && !db.get("SELECT 1 FROM upgrades WHERE name = 'vacuum after deltas'")) vacuum(db);
  }
}

/** Rebuild the database file without its free pages, once, saying how much that gave back. */
function vacuum(db: SqlDb) {
  const bytes = () => db.get<{ n: number }>("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()")!.n;
  const was = bytes();
  db.exec("VACUUM");
  db.run("INSERT INTO upgrades(name) VALUES ('vacuum after deltas')");
  console.error(`Stored History's older versions as edits: the index went from ${fmtMB(was)} to ${fmtMB(bytes())}.`);
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Walk the log newest first from where each note is now: a move hands the ID (or nothing, if that
 * note is gone) back to the path it came from, and a create ends that path's history (anything
 * earlier there was a different note).
 */
function backfillChangeNoteIds(db: SqlDb) {
  const idAt = new Map(db.all<{ path: string; id: string }>("SELECT path, id FROM notes").map((r) => [r.path, r.id]));
  for (const c of db.all<{ id: number; path: string; op: string; from_path: string | null }>("SELECT id, path, op, from_path FROM changes ORDER BY id DESC")) {
    const id = idAt.get(c.path);
    if (id) db.run("UPDATE changes SET note_id = ? WHERE id = ?", id, c.id);
    if (c.from_path || c.op === "create") idAt.delete(c.path);
    if (c.from_path) id ? idAt.set(c.from_path, id) : idAt.delete(c.from_path);
  }
}
