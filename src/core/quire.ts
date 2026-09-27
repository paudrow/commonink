import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { diffLines } from "diff";
import { cleanPath, isHidden, kindOf, linkKey, QuireError, stemOf, type NoteKind } from "./paths.ts";
import { extractLinks, outlineOf, searchableText, splitFrontmatter, titleOf, type Heading } from "./parse.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_VAULT = process.env.QUIRE_VAULT
  ? path.resolve(process.env.QUIRE_VAULT)
  : path.join(PROJECT_ROOT, "vault");

export interface NoteMeta {
  path: string;
  kind: NoteKind;
  title: string;
  version: string;
  mtime: number;
  size: number;
}
export interface Note extends NoteMeta {
  content: string;
}
export interface SearchHit {
  path: string;
  title: string;
  kind: NoteKind;
  snippet: string;
  score: number;
  lines: Array<{ line: number; text: string }>;
}
export interface Change {
  id: number;
  ts: number;
  path: string;
  op: "create" | "edit" | "move" | "delete" | "archive" | "unarchive";
  source: string;
  version: string | null;
  summary: string | null;
  from_path: string | null;
}
export interface Backlink {
  path: string;
  title: string;
  kind: string;
  line: number;
  text: string;
}

/** Archiving moves a note under Archive/, keeping its original path: Archive/Projects/Old plan.md */
export const ARCHIVE = "Archive/";
export const isArchived = (p: string) => p.startsWith(ARCHIVE);
export type ArchiveScope = "active" | "archived" | "all";
const inScope = (p: string, scope: ArchiveScope) => scope === "all" || (scope === "archived") === isArchived(p);

export interface FeedItem {
  path: string;
  kind: NoteKind;
  title: string;
  mtime: number;
  archived: boolean;
  excerpt: string;
  tags: string[];
  lines: Array<{ line: number; text: string }>;
  lastSource: string | null;
}

export interface Task {
  path: string;
  title: string;
  line: number;
  text: string;
  done: boolean;
  heading: string | null;
}

const TASK = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

export const versionOf = (content: string | Buffer) =>
  crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);

const CHANGE_COLS = "id, ts, path, op, source, version, summary, from_path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes(
  path TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, stem TEXT NOT NULL,
  version TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notes_stem ON notes(stem);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path, title, body, tokenize='porter unicode61 remove_diacritics 2', prefix='2 3');
CREATE TABLE IF NOT EXISTS links(src TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS links_key ON links(key);
CREATE INDEX IF NOT EXISTS links_src ON links(src);
CREATE TABLE IF NOT EXISTS changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, path TEXT NOT NULL, op TEXT NOT NULL,
  source TEXT NOT NULL, version TEXT, summary TEXT, from_path TEXT, before TEXT);
CREATE INDEX IF NOT EXISTS changes_path ON changes(path, version);
`;

/**
 * The one core every surface (web UI, MCP server, CLI) talks to.
 * Files on disk are the source of truth; SQLite is a rebuildable index + change log.
 */
export class Quire {
  private stmts = new Map<string, StatementSync>();

  private constructor(
    readonly root: string,
    readonly db: DatabaseSync,
  ) {}

  static open(root = DEFAULT_VAULT): Quire {
    fs.mkdirSync(path.join(root, ".quire"), { recursive: true });
    const db = new DatabaseSync(path.join(root, ".quire", "index.db"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
    db.exec(SCHEMA);
    const cols = (db.prepare("PRAGMA table_info(changes)").all() as any[]).map((c) => c.name);
    if (!cols.includes("before")) db.exec("ALTER TABLE changes ADD COLUMN before TEXT");
    const q = new Quire(root, db);
    q.sync();
    return q;
  }

  private sql(query: string): StatementSync {
    let s = this.stmts.get(query);
    if (!s) this.stmts.set(query, (s = this.db.prepare(query)));
    return s;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  // ---------------------------------------------------------------- indexing

  private *walk(dir = ""): Generator<string> {
    for (const ent of fs.readdirSync(this.abs(dir), { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const rel = dir ? `${dir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) yield* this.walk(rel);
      else if (ent.isFile() && kindOf(rel)) yield rel;
    }
  }

  /** Incrementally bring the index in line with the files on disk. Cheap: stats only, reads changed files. */
  sync(): { indexed: number; removed: number } {
    const known = new Map<string, { mtime: number; size: number }>();
    for (const r of this.sql("SELECT path, mtime, size FROM notes").all() as any[]) known.set(r.path, r);
    let indexed = 0;
    let removed = 0;
    for (const rel of this.walk()) {
      const st = fs.statSync(this.abs(rel));
      const k = known.get(rel);
      known.delete(rel);
      if (!k || k.mtime !== st.mtimeMs || k.size !== st.size) {
        this.indexFile(rel);
        indexed++;
      }
    }
    for (const rel of known.keys()) {
      this.unindex(rel);
      removed++;
    }
    return { indexed, removed };
  }

  /** (Re)index one file. Returns null if it no longer exists or isn't a note/asset. */
  indexFile(rel: string, content?: string): NoteMeta | null {
    const kind = kindOf(rel);
    if (!kind || isHidden(rel)) return null;
    let st: fs.Stats;
    try {
      st = fs.statSync(this.abs(rel));
    } catch {
      this.unindex(rel);
      return null;
    }
    if (!st.isFile()) return null;
    let version: string;
    let title: string;
    let body = "";
    if (kind === "asset") {
      version = versionOf(`${st.size}:${st.mtimeMs}`);
      title = path.posix.basename(rel);
    } else {
      content ??= fs.readFileSync(this.abs(rel), "utf8");
      version = versionOf(content);
      title = titleOf(content, kind, rel);
      body = searchableText(content, kind);
    }
    const meta: NoteMeta = { path: rel, kind, title, version, mtime: st.mtimeMs, size: st.size };
    this.tx(() => {
      this.sql(
        `INSERT INTO notes(path, kind, title, stem, version, mtime, size) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, title=excluded.title, stem=excluded.stem,
           version=excluded.version, mtime=excluded.mtime, size=excluded.size`,
      ).run(rel, kind, title, stemOf(rel), version, st.mtimeMs, st.size);
      this.sql("DELETE FROM notes_fts WHERE path = ?").run(rel);
      this.sql("DELETE FROM links WHERE src = ?").run(rel);
      if (kind !== "asset") {
        this.sql("INSERT INTO notes_fts(path, title, body) VALUES (?,?,?)").run(rel, title, body);
      }
      if (kind === "md" && content) {
        const ins = this.sql("INSERT INTO links(src, key, kind, line) VALUES (?,?,?,?)");
        for (const l of extractLinks(content)) ins.run(rel, l.key, l.kind, l.line);
      }
    });
    return meta;
  }

  unindex(rel: string): void {
    this.tx(() => {
      this.sql("DELETE FROM notes WHERE path = ?").run(rel);
      this.sql("DELETE FROM notes_fts WHERE path = ?").run(rel);
      this.sql("DELETE FROM links WHERE src = ?").run(rel);
    });
  }

  meta(rel: string): NoteMeta | null {
    return (this.sql("SELECT path, kind, title, version, mtime, size FROM notes WHERE path = ?").get(rel) as any) ?? null;
  }

  // ---------------------------------------------------------------- reading

  /** All notes, or one folder's. Archived notes are left out unless asked for (or you list Archive/). */
  list(folder?: string, scope: ArchiveScope = "active"): NoteMeta[] {
    const rows = this.sql("SELECT path, kind, title, version, mtime, size FROM notes ORDER BY path COLLATE NOCASE").all() as any[];
    if (!folder) return rows.filter((r) => inScope(r.path, scope));
    const prefix = cleanPath(folder).replace(/\/?$/, "/");
    return rows.filter((r) => r.path.startsWith(prefix) && (isArchived(prefix) || inScope(r.path, scope)));
  }

  recent(limit = 20): NoteMeta[] {
    return this.sql(
      "SELECT path, kind, title, version, mtime, size FROM notes WHERE kind != 'asset' AND path NOT LIKE 'Archive/%' ORDER BY mtime DESC LIMIT ?",
    ).all(limit) as any[];
  }

  /**
   * Resolve a path, a path without extension, or an Obsidian-style [[name]] to a vault path.
   * `from` lets links prefer notes in the same folder.
   */
  resolve(target: string, from?: string): string | null {
    const t = target.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/#.*$/, "").replace(/\|.*$/, "");
    if (!t) return null;
    const candidates: string[] = [];
    if (from) candidates.push(path.posix.join(path.posix.dirname(from), t));
    candidates.push(t);
    for (const c of candidates) {
      for (const p of kindOf(c) ? [c] : [`${c}.md`, c]) {
        try {
          const rel = cleanPath(p);
          if (kindOf(rel) && fs.statSync(this.abs(rel)).isFile()) return rel;
        } catch {}
      }
    }
    const key = linkKey(t);
    const base = key.split("/").pop()!;
    const rows = (this.sql("SELECT path FROM notes WHERE stem = ?").all(base) as any[])
      .map((r) => r.path as string)
      .filter((p) => linkKey(p).endsWith(key));
    if (!rows.length) return null;
    const dir = from ? path.posix.dirname(from) : null;
    rows.sort((a, b) => Number(path.posix.dirname(b) === dir) - Number(path.posix.dirname(a) === dir) || a.length - b.length);
    return rows[0];
  }

  private mustResolve(target: string): string {
    const rel = this.resolve(target);
    if (!rel) throw new QuireError(`No note matches "${target}". Try search_notes to find it.`, "not_found");
    return rel;
  }

  read(target: string): Note {
    const rel = this.mustResolve(target);
    const kind = kindOf(rel)!;
    if (kind === "asset") throw new QuireError(`${rel} is a binary asset, not a note`);
    const content = fs.readFileSync(this.abs(rel), "utf8");
    const meta = this.meta(rel) ?? this.indexFile(rel, content)!;
    return { ...meta, version: versionOf(content), content };
  }

  outline(target: string): Heading[] {
    return outlineOf(this.read(target).content);
  }

  search(query: string, limit = 20, scope: ArchiveScope = "active"): SearchHit[] {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const rows = this.sql(
      `SELECT n.path, n.title, n.kind,
              snippet(notes_fts, 2, char(1), char(2), '…', 16) AS snippet,
              bm25(notes_fts, 4.0, 8.0, 1.0) AS score
       FROM notes_fts JOIN notes n ON n.path = notes_fts.path
       WHERE notes_fts MATCH ? AND (? = 'all' OR (n.path LIKE 'Archive/%') = (? = 'archived'))
       ORDER BY score LIMIT ?`,
    ).all(ftsQuery(terms), scope, scope, limit) as any[];
    return rows.map((r) => ({ ...r, lines: this.matchingLines(r.path, terms) }));
  }

  private matchingLines(rel: string, terms: string[], max = 3): SearchHit["lines"] {
    const needles = terms.map((t) => t.toLowerCase());
    const lines: SearchHit["lines"] = [];
    try {
      const text = fs.readFileSync(this.abs(rel), "utf8").split("\n");
      for (let i = 0; i < text.length && lines.length < max; i++) {
        const l = text[i].toLowerCase();
        if (needles.some((n) => l.includes(n))) lines.push({ line: i + 1, text: text[i].trim().slice(0, 200) });
      }
    } catch {}
    return lines;
  }

  /**
   * A stream of notes, newest first, for the feed view. `q` filters with full-text search;
   * `folder` matches the note's original folder whether or not it's archived.
   */
  feed(opts: { q?: string; scope?: ArchiveScope; folder?: string; tag?: string; sort?: "modified" | "title"; offset?: number; limit?: number } = {}) {
    const scope = opts.scope ?? "active";
    const terms = searchTerms(opts.q ?? "");
    let rows = this.sql("SELECT path, kind, title, mtime FROM notes WHERE kind != 'asset' ORDER BY mtime DESC").all() as any[];
    if (terms.length) {
      const hits = new Set((this.sql("SELECT path FROM notes_fts WHERE notes_fts MATCH ?").all(ftsQuery(terms)) as any[]).map((r) => r.path));
      rows = rows.filter((r) => hits.has(r.path));
    }
    const home = (p: string) => (isArchived(p) ? p.slice(ARCHIVE.length) : p);
    if (opts.folder) rows = rows.filter((r) => home(r.path).startsWith(opts.folder!.replace(/\/?$/, "/")));
    if (opts.tag) {
      const want = opts.tag.replace(/^#/, "").toLowerCase();
      rows = rows.filter((r) => r.kind === "md" && tagsOf(this.abs(r.path)).includes(want));
    }
    if (opts.sort === "title") rows.sort((a, b) => a.title.localeCompare(b.title));
    const counts = { active: rows.filter((r) => !isArchived(r.path)).length, archived: rows.filter((r) => isArchived(r.path)).length };
    rows = rows.filter((r) => inScope(r.path, scope));
    const lastSource = new Map(
      (this.sql("SELECT path, source FROM changes WHERE id IN (SELECT max(id) FROM changes GROUP BY path)").all() as any[]).map((r) => [r.path, r.source]),
    );
    const offset = opts.offset ?? 0;
    const items: FeedItem[] = rows.slice(offset, offset + (opts.limit ?? 30)).map((r) => {
      let content = "";
      try {
        content = fs.readFileSync(this.abs(r.path), "utf8");
      } catch {}
      const { data, body } = r.kind === "md" ? splitFrontmatter(content) : { data: {} as Record<string, string>, body: "" };
      return {
        path: r.path,
        kind: r.kind,
        title: r.title,
        mtime: r.mtime,
        archived: isArchived(r.path),
        excerpt: excerptOf(body, r.title),
        tags: (data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean),
        lines: terms.length ? this.matchingLines(r.path, terms) : [],
        lastSource: lastSource.get(r.path) ?? null,
      };
    });
    return { items, total: rows.length, counts, folders: [...new Set(this.list(undefined, "all").filter((n) => n.kind !== "asset").map((n) => home(n.path)).filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort() };
  }

  backlinks(target: string): Backlink[] {
    const rel = this.mustResolve(target);
    const keys = [stemOf(rel), linkKey(rel), rel.toLowerCase()];
    const rows = this.sql(
      `SELECT DISTINCT l.src AS path, n.title, l.kind, l.line FROM links l JOIN notes n ON n.path = l.src
       WHERE l.key IN (?,?,?) AND l.src != ? ORDER BY n.mtime DESC, l.line`,
    ).all(...keys, rel) as any[];
    const cache = new Map<string, string[]>();
    return rows
      .filter((r) => {
        const t = this.linkTargetAt(r.path, r.line, keys, cache);
        return t !== null && this.resolve(t, r.path) === rel;
      })
      .map((r) => ({ ...r, text: (cache.get(r.path)?.[r.line - 1] ?? "").trim().slice(0, 200) }));
  }

  /** Find the raw link target on a line whose key matches (so ambiguous names resolve correctly). */
  private linkTargetAt(src: string, line: number, keys: string[], cache: Map<string, string[]>): string | null {
    if (!cache.has(src)) cache.set(src, fs.readFileSync(this.abs(src), "utf8").split("\n"));
    const text = cache.get(src)![line - 1] ?? "";
    for (const l of extractLinks(text)) if (keys.includes(l.key)) return l.target;
    return null;
  }

  changes(opts: { since?: string | number; limit?: number; path?: string } = {}): Change[] {
    const limit = opts.limit ?? 50;
    let sinceTs = 0;
    let sinceId = 0;
    if (typeof opts.since === "number" || /^\d+$/.test(String(opts.since ?? ""))) sinceId = Number(opts.since);
    else if (opts.since) {
      sinceTs = Date.parse(opts.since);
      if (Number.isNaN(sinceTs)) throw new QuireError(`Bad "since": ${opts.since} (use an ISO time or a change id)`);
    }
    return this.sql(
      `SELECT ${CHANGE_COLS} FROM changes WHERE id > ? AND ts > ? AND (? IS NULL OR path = ?) ORDER BY id DESC LIMIT ?`,
    ).all(sinceId, sinceTs, opts.path ?? null, opts.path ?? null, limit) as any[];
  }

  /** Who produced this exact version of a file? Used to attribute file-watcher events. */
  attribution(rel: string, version: string, withinMs = 120_000): Change | null {
    return (
      (this.sql(`SELECT ${CHANGE_COLS} FROM changes WHERE path = ? AND version = ? AND ts > ? ORDER BY id DESC LIMIT 1`).get(
        rel,
        version,
        Date.now() - withinMs,
      ) as any) ?? null
    );
  }

  /** `before` is the note's previous text, kept so any change can be undone with restore(). */
  recordChange(c: Omit<Change, "id" | "ts">, before: string | null = null): Change {
    const ts = Date.now();
    const r = this.sql(
      "INSERT INTO changes(ts, path, op, source, version, summary, from_path, before) VALUES (?,?,?,?,?,?,?,?)",
    ).run(ts, c.path, c.op, c.source, c.version, c.summary, c.from_path, before);
    return { ...c, id: Number(r.lastInsertRowid), ts };
  }

  /** Put a note back the way it was before change #id. */
  restore(id: number, source: string) {
    const row = this.sql("SELECT path, op, before FROM changes WHERE id = ?").get(id) as any;
    if (!row) throw new QuireError(`No change #${id}`, "not_found");
    if (row.before === null) throw new QuireError(`Change #${id} (${row.op} ${row.path}) has no earlier text to restore`);
    return this.save(row.path, row.before, { source });
  }

  // ---------------------------------------------------------------- writing

  private writeAtomic(rel: string, content: string): void {
    const abs = this.abs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, abs);
  }

  private commit(rel: string, before: string | null, after: string, source: string, op: Change["op"]) {
    this.writeAtomic(rel, after);
    const meta = this.indexFile(rel, after)!;
    const change = this.recordChange(
      {
        path: rel,
        op,
        source,
        version: meta.version,
        summary: before === null ? `${after.split("\n").length} lines` : diffstat(before, after),
        from_path: null,
      },
      before,
    );
    return { ...meta, change };
  }

  create(target: string, content: string, source: string) {
    let rel = cleanPath(target);
    if (!kindOf(rel)) rel += ".md";
    const kind = kindOf(rel);
    if (kind === "asset") throw new QuireError("Only .md and .html notes can be created");
    if (fs.existsSync(this.abs(rel))) throw new QuireError(`${rel} already exists; use edit_note instead`, "exists", { path: rel });
    return this.commit(rel, null, content, source, "create");
  }

  /** Whole-file save with optimistic concurrency (what the editor uses). */
  save(target: string, content: string, opts: { baseVersion?: string; source: string }) {
    const rel = cleanPath(target);
    const exists = fs.existsSync(this.abs(rel));
    const current = exists ? fs.readFileSync(this.abs(rel), "utf8") : null;
    if (current !== null && opts.baseVersion && versionOf(current) !== opts.baseVersion) {
      const last = this.attribution(rel, versionOf(current), 24 * 3600_000);
      throw new QuireError(`${rel} changed on disk since version ${opts.baseVersion}`, "conflict", {
        version: versionOf(current),
        content: current,
        source: last?.source ?? "external",
      });
    }
    if (current === content) return { ...(this.meta(rel) ?? this.indexFile(rel, content)!), change: null };
    return this.commit(rel, current, content, opts.source, exists ? "edit" : "create");
  }

  /** Exact-string replacement, the edit primitive agents are best at. */
  edit(
    target: string,
    opts: { oldString: string; newString: string; replaceAll?: boolean; baseVersion?: string },
    source: string,
  ) {
    const note = this.read(target);
    if (opts.baseVersion && opts.baseVersion !== note.version) {
      throw new QuireError(
        `${note.path} is at version ${note.version}, not ${opts.baseVersion}. Re-read it and retry.`,
        "conflict",
        { version: note.version },
      );
    }
    if (!opts.oldString) throw new QuireError("old_string must not be empty (use append_to_note to add text)");
    const count = note.content.split(opts.oldString).length - 1;
    if (count === 0) {
      throw new QuireError(`old_string not found in ${note.path}. Re-read the note; it may have changed.`, "not_found");
    }
    if (count > 1 && !opts.replaceAll) {
      throw new QuireError(`old_string occurs ${count} times in ${note.path}; add surrounding context or set replace_all.`);
    }
    const next = opts.replaceAll
      ? note.content.split(opts.oldString).join(opts.newString)
      : note.content.replace(opts.oldString, () => opts.newString);
    return this.commit(note.path, note.content, next, source, "edit");
  }

  append(target: string, text: string, source: string) {
    const note = this.read(target);
    const sep = note.content.endsWith("\n\n") || note.content === "" ? "" : note.content.endsWith("\n") ? "\n" : "\n\n";
    return this.commit(note.path, note.content, note.content + sep + text.replace(/\n*$/, "\n"), source, "edit");
  }

  /** Checkbox tasks across the vault (active notes), in note order, with the heading each sits under. */
  tasks(opts: { folder?: string; note?: string } = {}): Task[] {
    const only = opts.note ? this.resolve(opts.note) : null;
    if (opts.note && !only) return [];
    const prefix = opts.folder ? opts.folder.replace(/^\/+|\/+$/g, "") + "/" : "";
    const out: Task[] = [];
    for (const n of this.list(undefined, "active")) {
      if (n.kind !== "md" || (only && n.path !== only) || (prefix && !n.path.startsWith(prefix))) continue;
      let text: string;
      try {
        text = fs.readFileSync(this.abs(n.path), "utf8");
      } catch {
        continue;
      }
      let heading: string | null = null;
      let fence = false;
      text.split("\n").forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        if (fence) return;
        const h = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
        if (h) heading = h[1];
        const m = line.match(TASK);
        if (m && m[4].trim()) out.push({ path: n.path, title: n.title, line: i + 1, text: m[4], done: m[2] !== " ", heading });
      });
    }
    return out;
  }

  /**
   * Tick or untick one task at its source. `text` guards against the note having changed:
   * if the line moved, the nearest line with the same task text is used.
   */
  setTask(target: string, line: number, text: string, done: boolean, source: string) {
    const note = this.read(target);
    const lines = note.content.split("\n");
    const matches = (i: number) => lines[i]?.match(TASK)?.[4] === text;
    let i = line - 1;
    if (!matches(i)) {
      const near = lines.map((_, j) => j).filter(matches).sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
      if (!near.length) throw new QuireError(`That task isn't in ${note.path} any more`, "conflict");
      i = near[0];
    }
    lines[i] = lines[i].replace(TASK, (_m, a, _x, b, rest) => `${a}${done ? "x" : " "}${b}${rest}`);
    const next = lines.join("\n");
    if (next === note.content) return { ...note, change: null };
    return this.commit(note.path, note.content, next, source, "edit");
  }

  /** Archive a note: move it under Archive/ (links keep working: they resolve by name). */
  archive(target: string, source: string) {
    const rel = this.mustResolve(target);
    if (isArchived(rel)) throw new QuireError(`${rel} is already archived`);
    return this.move(rel, this.freePath(ARCHIVE + rel), source, "archive");
  }

  unarchive(target: string, source: string) {
    const rel = this.mustResolve(target);
    if (!isArchived(rel)) throw new QuireError(`${rel} isn't archived`);
    return this.move(rel, this.freePath(rel.slice(ARCHIVE.length)), source, "unarchive");
  }

  /** `rel`, or "name 2.md", "name 3.md"… if it's taken. */
  private freePath(rel: string): string {
    const ext = path.posix.extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    let out = rel;
    for (let i = 2; fs.existsSync(this.abs(out)); i++) out = `${stem} ${i}${ext}`;
    return out;
  }

  /** Rename a note and rewrite every [[link]] / ![[embed]] / [md](link) that pointed at it. */
  move(target: string, to: string, source: string, op: "move" | "archive" | "unarchive" = "move") {
    const from = this.mustResolve(target);
    let dest = cleanPath(to);
    if (!kindOf(dest)) dest += path.posix.extname(from);
    if (dest === from) return { path: dest, updated: [] as string[] };
    if (fs.existsSync(this.abs(dest))) throw new QuireError(`${dest} already exists`, "exists");
    const referrers = [...new Set(this.backlinks(from).map((b) => b.path))];
    const oldKeys = new Set([stemOf(from), linkKey(from), from.toLowerCase()]);

    fs.mkdirSync(path.dirname(this.abs(dest)), { recursive: true });
    fs.renameSync(this.abs(from), this.abs(dest));
    this.unindex(from);
    const meta = this.indexFile(dest)!;
    this.recordChange({ path: dest, op, source, version: meta.version, summary: `from ${from}`, from_path: from });

    const newStemUnique = (this.sql("SELECT count(*) AS n FROM notes WHERE stem = ?").get(stemOf(dest)) as any).n === 1;
    const wikiTarget = newStemUnique ? path.posix.basename(dest).replace(/\.(md|markdown)$/i, "") : dest.replace(/\.(md|markdown)$/i, "");
    const updated: string[] = [];
    for (const src of referrers) {
      const before = fs.readFileSync(this.abs(src), "utf8");
      const after = before
        .replace(/(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g, (m, bang, t, hash = "", alias = "") =>
          oldKeys.has(linkKey(t)) && this.resolve(t, src) === null ? `${bang}[[${wikiTarget}${hash}${alias}]]` : m,
        )
        .replace(/(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g, (m, pre, t, post) =>
          oldKeys.has(linkKey(decodeURIComponent(t))) ? `${pre}${encodeURI(dest)}${post}` : m,
        );
      if (after !== before) {
        this.commit(src, before, after, source, "edit");
        updated.push(src);
      }
    }
    return { path: dest, updated };
  }
}

function tagsOf(abs: string): string[] {
  try {
    const { data } = splitFrontmatter(fs.readFileSync(abs, "utf8"));
    return (data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function searchTerms(q: string): string[] {
  return [...q.matchAll(/[\p{L}\p{N}_]+/gu)].map((m) => m[0]).slice(0, 12);
}
const ftsQuery = (terms: string[]) => terms.map((t) => `"${t}"*`).join(" ");

/** The start of a note's body for previews: without the title heading, cut at a line boundary. */
function excerptOf(body: string, title: string, max = 700): string {
  let text = body.replace(/^\s*#\s+(.+)\n/, (m, h) => (h.trim() === title ? "" : m)).trim();
  if (text.length > max) text = text.slice(0, text.lastIndexOf("\n", max) > max / 2 ? text.lastIndexOf("\n", max) : max) + "…";
  return text;
}

export function diffstat(before: string, after: string): string {
  let add = 0;
  let del = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) add += part.count ?? 0;
    else if (part.removed) del += part.count ?? 0;
  }
  return `+${add} −${del}`;
}
