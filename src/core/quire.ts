import { actorOf, authorWhere, type Actor, type AuthorFilter } from "./actor.ts";
import path from "node:path";
import crypto from "node:crypto";
import { diffLines } from "diff";
import type { Content, SqlDb } from "./store.ts";
import { cleanPath, isHidden, kindOf, linkKey, QuireError, stemOf, type NoteKind } from "./paths.ts";
import { extractLinks, outlineOf, searchableText, splitFrontmatter, titleOf, type Heading } from "./parse.ts";
import { newNoteId, NOTE_ID, parseNotePath } from "./ids.ts";

export interface NoteMeta {
  /** Stable across renames, moves and archiving; see ids.ts. */
  id: string;
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
  /** The note's stable ID, so its history holds together across renames. Null if the log can't tell. */
  note_id: string | null;
  /** Who it was by or for (see actor.ts); `source` is the same as display text. */
  person: string | null;
  /** The agent that made it, or null for a person's own change. */
  agent: string | null;
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

/** A run of selected changes to one note, as the text before its first and after its last. */
export interface DiffRun {
  from: number;
  to: number;
  count: number;
  sources: string[];
  tsFrom: number;
  tsTo: number;
  op: Change["op"];
  /** The last change's summary ("+3 −1", or a file size for uploads). */
  summary: string | null;
  /** Changes to this note left out of the selection just before this run. */
  skipped: number;
  before: string | null;
  after: string | null;
}
export interface DiffFile {
  path: string;
  runs: DiffRun[];
  moves: Array<{ id: number; op: Change["op"]; from: string | null; to: string; ts: number; source: string }>;
  /** Id of the latest selected change to this note (files are listed newest first). */
  last: number;
}
const inScope = (p: string, scope: ArchiveScope) => scope === "all" || (scope === "archived") === isArchived(p);

export interface FeedItem {
  id: string;
  path: string;
  kind: NoteKind;
  title: string;
  mtime: number;
  archived: boolean;
  excerpt: string;
  tags: string[];
  lines: Array<{ line: number; text: string }>;
  lastSource: string | null;
  /** Who made the last change: a person, or an agent for one. */
  lastBy: Actor | null;
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

export const versionOf = (content: string) =>
  crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);

const CHANGE_COLS = "id, ts, path, op, source, version, summary, from_path, note_id, person, agent";
const META_COLS = "id, path, kind, title, version, mtime, size";
/** How long a deleted file's ID waits for the same file to reappear under a new name. */
const RENAME_WINDOW_MS = 60_000;

export interface QuireOptions {
  /** Milliseconds since the epoch: stamps changes and bounds the attribution and rename windows. Tests pass a fake clock. */
  now?: () => number;
}

/**
 * The one core every surface (web UI, MCP server, CLI, Cloudflare workspace) talks to.
 * `files` is the source of truth (a folder locally, a table in the cloud); the rest of the
 * SQLite database is a rebuildable index plus the change log and each person's favorites.
 */

export class Quire {
  private now: () => number;

  constructor(
    readonly db: SqlDb,
    readonly files: Content,
    opts: QuireOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** IDs of files that just left the index, by kind and content, so a rename seen as delete + add keeps its ID. */
  private gone = new Map<string, { id: string; at: number }>();

  // ---------------------------------------------------------------- indexing

  /** Incrementally bring the index in line with the files. Cheap: stats only, reads changed files. */
  sync(): { indexed: number; removed: number } {
    const known = new Map<string, { mtime: number; size: number }>();
    for (const r of this.db.all("SELECT path, mtime, size FROM notes")) known.set(r.path, r);
    let indexed = 0;
    let removed = 0;
    for (const { path: rel, ...st } of this.files.list()) {
      if (!kindOf(rel)) continue;
      const k = known.get(rel);
      known.delete(rel);
      if (!k || k.mtime !== st.mtime || k.size !== st.size) {
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

  /**
   * (Re)index one file. Returns null if it no longer exists or isn't a note/asset. A file new to the
   * index takes `id` if given (a move), else the ID of the same file seen under another name (a
   * rename outside the app), else a new one.
   */
  indexFile(rel: string, content?: string, id?: string): NoteMeta | null {
    const kind = kindOf(rel);
    if (!kind || isHidden(rel)) return null;
    const st = this.files.stat(rel);
    if (!st) {
      this.unindex(rel);
      return null;
    }
    let version: string;
    let title: string;
    let body = "";
    if (kind === "asset") {
      version = versionOf(`${st.size}:${st.mtime}`);
      title = path.posix.basename(rel);
    } else {
      content ??= this.files.read(rel) ?? "";
      version = versionOf(content);
      title = titleOf(content, kind, rel);
      body = searchableText(content, kind);
    }
    const noteId: string = this.db.get("SELECT id FROM notes WHERE path = ?", rel)?.id ?? id ?? this.renamedId(rel, kind, version, st.size) ?? newNoteId();
    return this.db.tx(() => {
      this.db.run(
        `INSERT INTO notes(path, kind, title, stem, version, mtime, size, id) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, title=excluded.title, stem=excluded.stem,
           version=excluded.version, mtime=excluded.mtime, size=excluded.size`,
        rel, kind, title, stemOf(rel), version, st.mtime, st.size, noteId,
      );
      this.db.run("DELETE FROM notes_fts WHERE path = ?", rel);
      this.db.run("DELETE FROM links WHERE src = ?", rel);
      if (kind !== "asset") this.db.run("INSERT INTO notes_fts(path, title, body) VALUES (?,?,?)", rel, title, body);
      if (kind === "md" && content) {
        for (const l of extractLinks(content)) this.db.run("INSERT INTO links(src, key, kind, line) VALUES (?,?,?,?)", rel, l.key, l.kind, l.line);
      }
      return { id: noteId, path: rel, kind, title, version, mtime: st.mtime, size: st.size };
    });
  }

  /**
   * The ID a file new to the index should inherit when it's an existing file under a new name: one
   * that just left the index (deleted first), or one still indexed whose file is gone (added first).
   * Empty files all look alike, so they never inherit.
   */
  private renamedId(rel: string, kind: NoteKind, version: string, size: number): string | undefined {
    if (!size) return;
    const key = `${kind}:${version}`;
    const recent = this.gone.get(key);
    this.gone.delete(key);
    if (recent && this.now() - recent.at < RENAME_WINDOW_MS && !this.db.get("SELECT 1 FROM notes WHERE id = ?", recent.id)) return recent.id;
    const stale = this.db
      .all("SELECT path, id FROM notes WHERE kind = ? AND version = ? AND path != ?", kind, version, rel)
      .find((r) => !this.files.stat(r.path));
    if (!stale) return;
    this.unindex(stale.path);
    this.gone.delete(key);
    return stale.id;
  }

  unindex(rel: string): void {
    const row = this.db.get("SELECT id, kind, version FROM notes WHERE path = ?", rel);
    if (row?.id) {
      this.gone.set(`${row.kind}:${row.version}`, { id: row.id, at: this.now() });
      for (const [k, v] of this.gone) if (this.now() - v.at > RENAME_WINDOW_MS) this.gone.delete(k);
    }
    this.db.tx(() => {
      this.db.run("DELETE FROM notes WHERE path = ?", rel);
      this.db.run("DELETE FROM notes_fts WHERE path = ?", rel);
      this.db.run("DELETE FROM links WHERE src = ?", rel);
    });
  }

  meta(rel: string): NoteMeta | null {
    return this.db.get(`SELECT ${META_COLS} FROM notes WHERE path = ?`, rel) ?? null;
  }

  /** Give the note with this ID a new one (its ID turned out to be taken elsewhere). Returns the new ID. */
  reassignId(id: string): string {
    const next = newNoteId();
    this.db.tx(() => {
      this.db.run("UPDATE notes SET id = ? WHERE id = ?", next, id);
      this.db.run("UPDATE favorites SET note_id = ? WHERE note_id = ?", next, id);
      this.db.run("UPDATE changes SET note_id = ? WHERE note_id = ?", next, id);
    });
    return next;
  }

  /** The path of the note with this stable ID, wherever it lives now. */
  pathOf(id: string): string | null {
    return this.db.get("SELECT path FROM notes WHERE id = ?", id)?.path ?? null;
  }

  // ---------------------------------------------------------------- reading

  /** All notes, or one folder's. Archived notes are left out unless asked for (or you list Archive/). */
  list(folder?: string, scope: ArchiveScope = "active"): NoteMeta[] {
    const rows = this.db.all(`SELECT ${META_COLS} FROM notes ORDER BY path COLLATE NOCASE`);
    if (!folder) return rows.filter((r) => inScope(r.path, scope));
    const prefix = cleanPath(folder).replace(/\/?$/, "/");
    return rows.filter((r) => r.path.startsWith(prefix) && (isArchived(prefix) || inScope(r.path, scope)));
  }

  recent(limit = 20): NoteMeta[] {
    return this.db.all(
      `SELECT ${META_COLS} FROM notes WHERE kind != 'asset' AND path NOT LIKE 'Archive/%' ORDER BY mtime DESC LIMIT ?`,
      limit,
    );
  }

  /**
   * Resolve a path, a path without extension, a stable ID, a note URL (/notes/title-id), or an
   * Obsidian-style [[name]] to a vault path. `from` lets links prefer notes in the same folder.
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
          if (kindOf(rel) && this.files.stat(rel)) return rel;
        } catch {}
      }
    }
    const id = NOTE_ID.test(t) ? t : parseNotePath(t)?.id;
    const byId = id && this.pathOf(id);
    if (byId) return byId;
    const key = linkKey(t);
    const base = key.split("/").pop()!;
    const rows = this.db.all("SELECT path FROM notes WHERE stem = ?", base)
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
    const content = this.files.read(rel);
    if (content === null) throw new QuireError(`No note matches "${target}"`, "not_found");
    const meta = this.meta(rel) ?? this.indexFile(rel, content)!;
    return { ...meta, version: versionOf(content), content };
  }

  outline(target: string): Heading[] {
    return outlineOf(this.read(target).content);
  }

  search(query: string, limit = 20, scope: ArchiveScope = "active"): SearchHit[] {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const rows = this.db.all(
      `SELECT n.path, n.title, n.kind,
              snippet(notes_fts, 2, char(1), char(2), '…', 16) AS snippet,
              bm25(notes_fts, 4.0, 8.0, 1.0) AS score
       FROM notes_fts JOIN notes n ON n.path = notes_fts.path
       WHERE notes_fts MATCH ? AND (? = 'all' OR (n.path LIKE 'Archive/%') = (? = 'archived'))
       ORDER BY score LIMIT ?`,
      ftsQuery(terms), scope, scope, limit,
    );
    return rows.map((r) => ({ ...r, lines: this.matchingLines(r.path, terms) }));
  }

  private matchingLines(rel: string, terms: string[], max = 3): SearchHit["lines"] {
    const needles = terms.map((t) => t.toLowerCase());
    const lines: SearchHit["lines"] = [];
    const text = (this.files.read(rel) ?? "").split("\n");
    for (let i = 0; i < text.length && lines.length < max; i++) {
      const l = text[i].toLowerCase();
      if (needles.some((n) => l.includes(n))) lines.push({ line: i + 1, text: text[i].trim().slice(0, 200) });
    }
    return lines;
  }

  /**
   * A stream of notes, newest first, for the Notes view. `q` filters with full-text search;
   * `folder` matches the note's original folder whether or not it's archived.
   */
  feed(opts: { q?: string; scope?: ArchiveScope; folder?: string; tag?: string; sort?: "modified" | "title"; offset?: number; limit?: number } = {}) {
    const scope = opts.scope ?? "active";
    const terms = searchTerms(opts.q ?? "");
    let rows = this.db.all("SELECT id, path, kind, title, mtime FROM notes WHERE kind != 'asset' ORDER BY mtime DESC");
    if (terms.length) {
      const hits = new Set(this.db.all("SELECT path FROM notes_fts WHERE notes_fts MATCH ?", ftsQuery(terms)).map((r) => r.path));
      rows = rows.filter((r) => hits.has(r.path));
    }
    const home = (p: string) => (isArchived(p) ? p.slice(ARCHIVE.length) : p);
    if (opts.folder) rows = rows.filter((r) => home(r.path).startsWith(opts.folder!.replace(/\/?$/, "/")));
    if (opts.tag) {
      const want = opts.tag.replace(/^#/, "").toLowerCase();
      rows = rows.filter((r) => r.kind === "md" && tagsOf(this.files.read(r.path) ?? "").includes(want));
    }
    if (opts.sort === "title") rows.sort((a, b) => a.title.localeCompare(b.title));
    const counts = { active: rows.filter((r) => !isArchived(r.path)).length, archived: rows.filter((r) => isArchived(r.path)).length };
    rows = rows.filter((r) => inScope(r.path, scope));
    const last = new Map(
      this.db
        .all<{ path: string } & Actor & { source: string }>("SELECT path, source, person, agent FROM changes WHERE id IN (SELECT max(id) FROM changes GROUP BY path)")
        .map((r) => [r.path, r]),
    );
    const offset = opts.offset ?? 0;
    const items: FeedItem[] = rows.slice(offset, offset + (opts.limit ?? 30)).map((r) => {
      const content = this.files.read(r.path) ?? "";
      const { data, body } = r.kind === "md" ? splitFrontmatter(content) : { data: {} as Record<string, string>, body: "" };
      return {
        id: r.id,
        path: r.path,
        kind: r.kind,
        title: r.title,
        mtime: r.mtime,
        archived: isArchived(r.path),
        excerpt: excerptOf(body, r.title),
        tags: (data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean),
        lines: terms.length ? this.matchingLines(r.path, terms) : [],
        lastSource: last.get(r.path)?.source ?? null,
        lastBy: last.has(r.path) ? { person: last.get(r.path)!.person, agent: last.get(r.path)!.agent } : null,
      };
    });
    return { items, total: rows.length, counts, folders: [...new Set(this.list(undefined, "all").filter((n) => n.kind !== "asset").map((n) => home(n.path)).filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort() };
  }

  backlinks(target: string): Backlink[] {
    const rel = this.mustResolve(target);
    const keys = [stemOf(rel), linkKey(rel), rel.toLowerCase()];
    const rows = this.db.all(
      `SELECT DISTINCT l.src AS path, n.title, l.kind, l.line FROM links l JOIN notes n ON n.path = l.src
       WHERE l.key IN (?,?,?) AND l.src != ? ORDER BY n.mtime DESC, l.line`,
      ...keys, rel,
    );
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
    if (!cache.has(src)) cache.set(src, (this.files.read(src) ?? "").split("\n"));
    const text = cache.get(src)![line - 1] ?? "";
    for (const l of extractLinks(text)) if (keys.includes(l.key)) return l.target;
    return null;
  }

  /**
   * The change log, newest first. `path` narrows it to one note: a path, stable ID or note URL. A note
   * that still exists brings its whole history, under earlier names too; a gone one, what happened at
   * that exact path.
   */
  changes(opts: { since?: string | number; before?: number; limit?: number; path?: string; by?: AuthorFilter } = {}): Change[] {
    const limit = opts.limit ?? 50;
    const noteId = opts.path ? this.idOf(opts.path) : null;
    const p = opts.path ?? null;
    const [byWhere, byArgs] = authorWhere(opts.by);
    const [where, args] = noteId ? [`note_id = ? AND ${byWhere}`, [noteId, ...byArgs]] : [`(? IS NULL OR path = ?) AND ${byWhere}`, [p, p, ...byArgs]];
    if (opts.before) {
      return this.db.all(`SELECT ${CHANGE_COLS} FROM changes WHERE id < ? AND ${where} ORDER BY id DESC LIMIT ?`, opts.before, ...args, limit);
    }
    let sinceTs = 0;
    let sinceId = 0;
    if (typeof opts.since === "number" || /^\d+$/.test(String(opts.since ?? ""))) sinceId = Number(opts.since);
    else if (opts.since) {
      sinceTs = Date.parse(opts.since);
      if (Number.isNaN(sinceTs)) throw new QuireError(`Bad "since": ${opts.since} (use an ISO time or a change id)`);
    }
    return this.db.all(`SELECT ${CHANGE_COLS} FROM changes WHERE id > ? AND ts > ? AND ${where} ORDER BY id DESC LIMIT ?`, sinceId, sinceTs, ...args, limit);
  }

  /** The stable ID of the note at this path, ID or note URL, if it's in the index. No fuzzy name matching. */
  private idOf(target: string): string | null {
    const t = target.trim();
    const id = NOTE_ID.test(t) ? t : parseNotePath(t)?.id;
    if (id && this.pathOf(id)) return id;
    return this.meta(t)?.id ?? null;
  }

  /** Who produced this exact version of a file? Used to attribute file-watcher events. */
  attribution(rel: string, version: string, withinMs = 120_000): Change | null {
    return (
      this.db.get(`SELECT ${CHANGE_COLS} FROM changes WHERE path = ? AND version = ? AND ts > ? ORDER BY id DESC LIMIT 1`, rel, version, this.now() - withinMs) ??
      null
    );
  }

  /** The agents that appear in the change log, by name, for filtering History by one. */
  agents(): string[] {
    return this.db.all<{ agent: string }>("SELECT DISTINCT agent FROM changes WHERE agent IS NOT NULL ORDER BY agent").map((r) => r.agent);
  }

  /**
   * `before` is the note's previous text, kept so any change can be undone with restore(). The
   * `source` says who (see actorOf): an agent's carries its person too.
   */
  recordChange(c: Omit<Change, "id" | "ts" | "note_id" | "person" | "agent">, before: string | null = null): Change {
    const ts = this.now();
    const noteId = this.meta(c.path)?.id ?? null;
    const { source, person, agent } = actorOf(c.source);
    const r = this.db.run(
      "INSERT INTO changes(ts, path, op, source, version, summary, from_path, before, note_id, person, agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ts, c.path, c.op, source, c.version, c.summary, c.from_path, before, noteId, person, agent,
    );
    return { ...c, source, id: r.lastId, ts, note_id: noteId, person, agent };
  }

  /**
   * The text of a note before change #from and after change #to (the same id for one change; a
   * range for a run of autosaves). Either side is null if it can't be recovered.
   */
  diff(fromId: number, toId: number): { path: string; op: Change["op"]; before: string | null; after: string | null } {
    const first = this.db.get("SELECT op, before FROM changes WHERE id = ?", fromId);
    const last = this.db.get(`SELECT ${CHANGE_COLS} FROM changes WHERE id = ?`, toId) as Change | undefined;
    if (!first || !last) throw new QuireError(`No change #${first ? toId : fromId}`, "not_found");
    const before = first.op === "create" ? "" : (first.before as string | null);
    return { path: last.path, op: last.op, before, after: this.textAfter(last) };
  }

  /**
   * What a hand-picked set of changes did, note by note. Each note's selected changes are merged
   * into runs; a change left out of the selection (on that note) splits a run, so every run is a
   * real before/after rather than a guess at what the note would be without the skipped change.
   * Changes to other notes don't matter: leaving them out just leaves those notes out.
   */
  diffSet(ids: number[]): DiffFile[] {
    const want = new Set(ids.filter((n) => Number.isInteger(n) && n > 0));
    if (!want.size) return [];
    const lo = Math.min(...want);
    const hi = Math.max(...want);
    // The selected changes, plus anything else that happened to those notes in between.
    const picked: Change[] = [];
    const idList = [...want];
    for (let i = 0; i < idList.length; i += 90) {
      const chunk = idList.slice(i, i + 90);
      picked.push(...(this.db.all(`SELECT ${CHANGE_COLS} FROM changes WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk) as Change[]));
    }
    const between = [...new Set(picked.map((c) => c.path))].flatMap(
      (p) => (this.db.all(`SELECT ${CHANGE_COLS} FROM changes WHERE path = ? AND id BETWEEN ? AND ?`, p, lo, hi) as Change[]).filter((c) => !want.has(c.id)),
    );
    const files = new Map<string, DiffFile & { open: DiffRun | null; broken: number }>();
    const fileOf = (p: string) => {
      if (!files.has(p)) files.set(p, { path: p, runs: [], moves: [], last: 0, open: null, broken: 0 });
      return files.get(p)!;
    };
    for (const c of [...picked, ...between].sort((a, b) => a.id - b.id)) {
      const moved = c.op === "move" || c.op === "archive" || c.op === "unarchive";
      if (!want.has(c.id)) {
        // Someone else's step on a note we're showing: the next selected change there starts a new run.
        const f = files.get(c.path);
        if (f && !moved) {
          f.open = null;
          f.broken++;
        }
        continue;
      }
      if (moved && c.from_path && files.has(c.from_path) && !files.has(c.path)) {
        // Same note under its new name: keep its earlier runs together with what comes next.
        const prev = files.get(c.from_path)!;
        files.delete(c.from_path);
        prev.path = c.path;
        files.set(c.path, prev);
      }
      const f = fileOf(c.path);
      f.last = c.id;
      if (moved) {
        f.moves.push({ id: c.id, op: c.op, from: c.from_path, to: c.path, ts: c.ts, source: c.source });
        f.open = null;
        continue;
      }
      if (f.open) {
        f.open.to = c.id;
        f.open.count++;
        f.open.tsTo = c.ts;
        f.open.summary = c.summary;
        if (!f.open.sources.includes(c.source)) f.open.sources.push(c.source);
      } else {
        f.open = { from: c.id, to: c.id, count: 1, sources: [c.source], tsFrom: c.ts, tsTo: c.ts, op: c.op, summary: c.summary, skipped: f.runs.length ? f.broken : 0, before: null, after: null };
        f.broken = 0;
        f.runs.push(f.open);
      }
    }
    return [...files.values()]
      .sort((a, b) => b.last - a.last)
      .map(({ open: _o, broken: _b, ...f }) => ({
        ...f,
        runs: f.runs.map((r) => {
          const d = this.diff(r.from, r.to);
          return { ...r, before: d.before, after: d.after };
        }),
      }));
  }

  /**
   * A note's text right after a change: the next change's `before`, or the file as it is now,
   * following later moves. Candidates are checked against the change's version hash.
   */
  private textAfter(c: Change): string | null {
    if (!c.version) return null;
    let at = c.path;
    let since = c.id;
    for (let hop = 0; hop < 8; hop++) {
      for (const r of this.db.all("SELECT before FROM changes WHERE path = ? AND id > ? AND before IS NOT NULL ORDER BY id LIMIT 20", at, since)) {
        if (versionOf(r.before) === c.version) return r.before;
      }
      const now = this.files.read(at);
      if (now !== null && versionOf(now) === c.version) return now;
      const moved = this.db.get("SELECT id, path FROM changes WHERE from_path = ? AND id > ? ORDER BY id LIMIT 1", at, since);
      if (!moved) return null;
      at = moved.path;
      since = moved.id;
    }
    return null;
  }

  /** Put a note back the way it was before change #id. */
  restore(id: number, source: string) {
    const row = this.db.get("SELECT path, op, before FROM changes WHERE id = ?", id);
    if (!row) throw new QuireError(`No change #${id}`, "not_found");
    if (row.before === null) throw new QuireError(`Change #${id} (${row.op} ${row.path}) has no earlier text to restore`);
    // The note may have been renamed or archived since: restore it where it lives now.
    let at = row.path as string;
    let since = id;
    for (let moved; (moved = this.db.get("SELECT id, path FROM changes WHERE from_path = ? AND id > ? ORDER BY id LIMIT 1", at, since)); ) {
      at = moved.path;
      since = moved.id;
    }
    return { ...this.save(at, row.before, { source }), path: at };
  }

  // ---------------------------------------------------------------- favorites

  /**
   * A person's starred notes, in their order, wherever they live now (archived ones included). A
   * star whose note isn't in the index is skipped until the note comes back.
   */
  favorites(user: string): NoteMeta[] {
    const out: NoteMeta[] = [];
    for (const f of this.db.all<{ note_id: string; path: string }>("SELECT note_id, path FROM favorites WHERE user = ? ORDER BY pos", user)) {
      const here = this.pathOf(f.note_id);
      const meta = here ? this.meta(here) : this.meta(f.path);
      if (!meta) continue;
      if (meta.id !== f.note_id) {
        // The note is back at its old path under a new ID: move the star over (unless it has one already).
        const dup = out.some((m) => m.id === meta.id) || this.db.get("SELECT 1 FROM favorites WHERE user = ? AND note_id = ?", user, meta.id);
        if (dup) {
          this.db.run("DELETE FROM favorites WHERE user = ? AND note_id = ?", user, f.note_id);
          continue;
        }
        this.db.run("UPDATE favorites SET note_id = ? WHERE user = ? AND note_id = ?", meta.id, user, f.note_id);
      } else if (meta.path !== f.path) {
        this.db.run("UPDATE favorites SET path = ? WHERE user = ? AND note_id = ?", meta.path, user, f.note_id);
      }
      out.push(meta);
    }
    return out;
  }

  /** Star a note (a path, ID, note URL or [[name]]) at the end of `user`'s favorites. Starring it again changes nothing. */
  star(user: string, target: string): NoteMeta[] {
    const meta = this.metaOf(target);
    if (meta.kind === "asset") throw new QuireError(`${meta.path} is a binary asset, not a note`);
    this.db.run(
      `INSERT INTO favorites(user, note_id, path, pos)
       VALUES (?, ?, ?, (SELECT coalesce(max(pos), 0) + 1 FROM favorites WHERE user = ?)) ON CONFLICT DO NOTHING`,
      user, meta.id, meta.path, user,
    );
    return this.favorites(user);
  }

  unstar(user: string, target: string): NoteMeta[] {
    this.db.run("DELETE FROM favorites WHERE user = ? AND note_id = ?", user, this.metaOf(target).id);
    return this.favorites(user);
  }

  /** Put these starred notes first, in this order; the rest follow in the order they had, stars whose note is gone included. */
  orderFavorites(user: string, targets: string[]): NoteMeta[] {
    this.favorites(user); // rebinds stars to their notes' current IDs
    const starred = this.db.all<{ note_id: string }>("SELECT note_id FROM favorites WHERE user = ? ORDER BY pos", user).map((f) => f.note_id);
    const first = targets.map((t) => this.metaOf(t).id).filter((id) => starred.includes(id));
    const order = [...new Set([...first, ...starred])];
    this.db.tx(() => order.forEach((id, i) => this.db.run("UPDATE favorites SET pos = ? WHERE user = ? AND note_id = ?", i + 1, user, id)));
    return this.favorites(user);
  }

  private metaOf(target: string): NoteMeta {
    const rel = this.mustResolve(target);
    const meta = this.meta(rel) ?? this.indexFile(rel);
    if (!meta) throw new QuireError(`No note matches "${target}"`, "not_found");
    return meta;
  }

  // ---------------------------------------------------------------- writing

  private commit(rel: string, before: string | null, after: string, source: string, op: Change["op"]) {
    this.files.write(rel, after);
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
    if (this.files.stat(rel)) throw new QuireError(`${rel} already exists; use edit_note instead`, "exists", { path: rel });
    return this.commit(rel, null, content, source, "create");
  }

  /** Whole-file save with optimistic concurrency (what the editor uses). */
  save(target: string, content: string, opts: { baseVersion?: string; source: string }) {
    const rel = cleanPath(target);
    const kind = kindOf(rel);
    if (kind !== "md" && kind !== "html") throw new QuireError(`${rel} isn't a note: only .md and .html files can be saved as text`);
    const current = this.files.read(rel);
    const exists = current !== null;
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
      const text = this.files.read(n.path);
      if (text === null) continue;
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

  /**
   * Where an uploaded file named `name` goes: `folder/name`, or "name 2.png" if that's taken.
   * Throws for names that aren't a file type we store.
   */
  uploadPath(name: string, folder = "assets"): string {
    const base = path.posix.basename(name.replace(/\\/g, "/")).replace(/[:*?"<>|#^[\]]/g, "").trim();
    const rel = cleanPath(folder ? `${folder}/${base}` : base);
    if (kindOf(rel) !== "asset") throw new QuireError(`Can't upload ${base || "that file"}: images, PDFs, audio, video and common documents only`);
    return this.freePath(rel);
  }

  /** The host just wrote a file's bytes to `rel`: index it and log who added it. */
  recordUpload(rel: string, existed: boolean, source: string) {
    const meta = this.indexFile(rel);
    if (!meta) throw new QuireError(`${rel} isn't there`, "not_found");
    const change = this.recordChange({ path: rel, op: existed ? "edit" : "create", source, version: meta.version, summary: fmtBytes(meta.size), from_path: null });
    return { ...meta, change };
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
    for (let i = 2; this.files.stat(out); i++) out = `${stem} ${i}${ext}`;
    return out;
  }

  /** Rename a note and rewrite every [[link]] / ![[embed]] / [md](link) that pointed at it. */
  move(target: string, to: string, source: string, op: "move" | "archive" | "unarchive" = "move") {
    const from = this.mustResolve(target);
    let dest = cleanPath(to);
    if (!kindOf(dest)) dest += path.posix.extname(from);
    const [extFrom, extTo] = [from, dest].map((p) => path.posix.extname(p).toLowerCase());
    if (kindOf(dest) !== kindOf(from) || (kindOf(from) === "asset" && extFrom !== extTo)) {
      throw new QuireError(`Moving ${from} can't change its file type from ${extFrom} to ${extTo}`);
    }
    if (dest === from) return { path: dest, from, version: this.meta(from)?.version ?? "", change: null, updated: [] as string[], edits: [] };
    if (this.files.stat(dest)) throw new QuireError(`${dest} already exists`, "exists");
    const referrers = [...new Set(this.backlinks(from).map((b) => b.path))];
    const oldKeys = new Set([stemOf(from), linkKey(from), from.toLowerCase()]);

    const id = this.meta(from)?.id;
    this.files.rename(from, dest);
    this.unindex(from);
    const meta = this.indexFile(dest, undefined, id)!;
    const change = this.recordChange({ path: dest, op, source, version: meta.version, summary: `from ${from}`, from_path: from });

    const newStemUnique = this.db.get("SELECT count(*) AS n FROM notes WHERE stem = ?", stemOf(dest)).n === 1;
    const wikiTarget = newStemUnique ? path.posix.basename(dest).replace(/\.(md|markdown)$/i, "") : dest.replace(/\.(md|markdown)$/i, "");
    const updated: string[] = [];
    const edits: Array<{ path: string; content: string; version: string; change: Change }> = [];
    for (const src of referrers) {
      const before = this.files.read(src) ?? "";
      const after = before
        .replace(/(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g, (m, bang, t, hash = "", alias = "") =>
          oldKeys.has(linkKey(t)) && this.resolve(t, src) === null ? `${bang}[[${wikiTarget}${hash}${alias}]]` : m,
        )
        .replace(/(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g, (m, pre, t, post) =>
          oldKeys.has(linkKey(decodeURIComponent(t))) ? `${pre}${encodeURI(dest)}${post}` : m,
        );
      if (after !== before) {
        const r = this.commit(src, before, after, source, "edit");
        updated.push(src);
        edits.push({ path: src, content: after, version: r.version, change: r.change });
      }
    }
    return { path: dest, from, version: meta.version, change, updated, edits };
  }
}

function tagsOf(text: string): string[] {
  const { data } = splitFrontmatter(text);
  return (data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
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

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
