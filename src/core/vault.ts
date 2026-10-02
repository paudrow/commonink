import { ARCHIVE, homeOf, isArchived } from "./archive.ts";
import { actorOf, authorWhere, type Actor, type AuthorFilter } from "./actor.ts";
import path from "node:path";
import crypto from "node:crypto";
import { diffLines } from "diff";
import { chainBefore, dropBefores, readBefore } from "./changeTexts.ts";
import type { Content, SqlDb } from "./store.ts";
import { cleanPath, isHidden, kindOf, linkKey, VaultError, stemOf, type NoteKind } from "./paths.ts";
import { headingName, headingText, mapOutsideCode, proseLines } from "./prose.ts";
import { dateOf, extractLinks, outlineOf, searchableText, splitFrontmatter, titleOf, type Heading } from "./parse.ts";
import { newNoteId, NOTE_ID, parseNotePath } from "./ids.ts";
import { cleanTag, normalizeTag, renameTagIn, scanTags, tagMatches } from "./tags.ts";
import { dueFilter, editTaskLines, isDate, localDate, parseTask, patchProblem, skipPatch, TASK_LINE, todaySection, withTasksAdded, type TaskMeta, type TaskPatch } from "./tasks.ts";
import { parseQuickAdd } from "./quickAdd.ts";
import { formatQuery, parseQuery, queryProblem, tagList, type NoteQuery } from "./query.ts";
import { addCard, boardsIn, checkCard, editCard, moveCard, unclosedBoard, type Board, type Place } from "./kanban.ts";
import { safeDecode } from "./uri.ts";
import { AGENTS_NOTE, START_TAG, type NoteRole } from "./noteRoles.ts";
import {
  checkInDue, checkInEvery, contactFromNote, contactNote, dayOfNote, emptyContact, fillContact, parseContactsCsv, parseVCards, PEOPLE, peopleDirectory, personFor, sameFields, samePerson,
  type Contact, type ContactFields, type ContactInput, type ContactNote, type MemberRef, type TimelineItem,
} from "./contacts.ts";
import { cleanTitle, DAILY_TEMPLATE, fillTemplate, localNow, TEMPLATES, templateInfo, type FillOptions, type TemplateInfo } from "./templates.ts";
import { frontmatterEntries } from "./frontmatter.ts";
import { COMMENT_MAX, CONTEXT_MAX, DECISION_STATUSES, DECISIONS, journalLines, OPEN_MAX, OPTION_MAX, OPTIONS_MAX, QUESTION_MAX, type Decision, type DecisionStatus } from "./decisions.ts";

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
  /** `delete` sends a note or asset to Trash, `restore` brings it back, `purge` deletes it forever. */
  op: "create" | "edit" | "move" | "delete" | "archive" | "unarchive" | "restore" | "purge";
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
/** A tag in someone's favorites: what it's called now, and how many active notes carry it (or a tag under it). */
export interface TagFavorite {
  tag: string;
  display: string;
  notes: number;
}
/** A favorite is a note or a tag, in one order. */
export type Favorite = NoteMeta | TagFavorite;
export const isTagFavorite = (f: Favorite): f is TagFavorite => "tag" in f;
/**
 * A tag favorite's key in the favorites table: "#" + the tag. Note IDs never hold a "#", so the two
 * can't collide, and rows from before tag favorites need nothing done to them.
 */
const tagKey = (tag: string) => `#${tag}`;

/** Refuse a contact's check-in rhythm that doesn't read as one ("" clears it). */
function checkRhythm(text: string | undefined) {
  if (text?.trim() && !checkInEvery(text)) throw new VaultError(`"${text}" isn't a check-in rhythm. Say weekly, every 2 weeks, monthly, every 3 months, 6m or yearly.`);
}

export interface Backlink {
  path: string;
  title: string;
  kind: string;
  line: number;
  text: string;
}

/** A link to a note or file that isn't in the vault, and every place that has it. */
export interface MissingLink {
  /** What the links say, as the first of them spells it. */
  target: string;
  from: Backlink[];
}

export { ARCHIVE, archiveRootOf, homeOf, isArchived, isArchiveFolder } from "./archive.ts";
/** isArchived() in SQL, for the path column `col`. ltrim() drops the number in front, as ARCHIVE_DIR does. */
const archivedSql = (col: string) => `lower(ltrim(substr(${col}, 1, instr(${col}, '/')), '0123456789 ._-')) IN ('archive/', 'archives/')`;
export type ArchiveScope = "active" | "archived" | "all";

/**
 * A deleted note or asset, waiting in Trash. Its file sits at `.trash/<id>/<path>`, where the id is
 * "<ms deleted>-<change id>": hidden, so no listing, search, index or /files route ever sees it.
 */
/** A label of a note: a name on one version, to compare with or go back to. */
export interface Label {
  id: string;
  note_id: string;
  /** Where the note is now; null while it's in Trash. */
  path: string | null;
  /** The change right before this version (its place in History), or null if the log has none. */
  change_id: number | null;
  name: string;
  description: string | null;
  version: string;
  /** When it was labeled, and who labeled it. */
  ts: number;
  source: string;
  person: string | null;
  agent: string | null;
  /** The note is at this version now. */
  current: boolean;
}

/** A label's name: short, one line. */
export const LABEL_NAME_MAX = 80;
const LABEL_DESCRIPTION_MAX = 500;
/** The most labels one note keeps. */
export const LABELS_PER_NOTE = 200;
const LABEL_COLS = "m.id, m.note_id, n.path, m.change_id, m.name, m.description, m.version, m.ts, m.source, m.person, m.agent, n.version AS now";

export interface TrashItem {
  id: string;
  /** Where it was. */
  path: string;
  kind: NoteKind;
  size: number;
  deletedAt: number;
  /** When it's deleted for good. */
  expiresAt: number;
  /** Who deleted it, from the change log (null once the log no longer has it). */
  by: Actor & { source: string } | null;
  /** How many labels it has, which deleting it for good deletes too (none if left out). */
  labels?: number;
  /** The start of a note's text; empty for an asset. */
  excerpt: string;
}

/** What deleting some notes (or a folder) would touch: how many notes and assets, and who links to them. */
export interface DeleteCheck {
  notes: number;
  assets: number;
  /** Notes outside the set that link to or embed something in it. */
  linkedFrom: string[];
}

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
  /** Lines added and removed from before to after (null without both texts). */
  stat: LineStat | null;
}
export interface LineStat {
  add: number;
  del: number;
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
  role: NoteRole | null;
}

export interface Task {
  path: string;
  /** The note's title. */
  title: string;
  line: number;
  /** Everything after the checkbox, tokens included. */
  text: string;
  /** The text without the tokens at its end. */
  summary: string;
  done: boolean;
  heading: string | null;
  meta: TaskMeta;
}

/**
 * A tag, parents included: how it's shown, and how many notes, tasks and assets carry it or a tag
 * under it. All three are 0 for a tag someone added by name that nothing carries yet.
 */
export interface TagCount {
  tag: string;
  display: string;
  notes: number;
  tasks: number;
  assets: number;
}
/** A saved note query in the sidebar, with how many active notes match it now. */
export interface SmartFolder {
  id: string;
  name: string;
  /** As ::query args: `tag=work sort=title`. */
  query: string;
  /** Shared with the whole workspace, rather than just the person who sees it. */
  shared: boolean;
  count: number;
}
/** Somewhere a tag is used: a note's line, a task's line, or an asset (line 0). */
export interface TagUse {
  kind: "note" | "task" | "asset";
  path: string;
  line: number;
}

/**
 * Images and PDFs can't hold text, so their tags live in one vault file: asset path → tags, as
 * written. Hidden, so it isn't an asset itself; the core rewrites it when an asset moves.
 */
export const ASSET_TAGS = "assets/.tags.json";

export const versionOf = (content: string) =>
  crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);

/** What reindexing a path needs to know about its row, if it has one. */
type IndexedRow = { id: string; kind: NoteKind; fts: number | null };

const CHANGE_COLS = "id, ts, path, op, source, version, summary, from_path, note_id, person, agent";
const META_COLS = "id, path, kind, title, version, mtime, size";
const TRASH = ".trash";
/** Notes whose tasks are tasks: not archived, and not templates (a template's `- [ ]` is for the notes made from it). */
const TASK_NOTES = `NOT ${archivedSql("t.path")} AND substr(t.path, 1, ${TEMPLATES.length + 1}) != '${TEMPLATES}/'`;
/** How long Trash keeps what's deleted. */
export const TRASH_DAYS = 30;
const TRASH_ID = /^(\d{1,15})-(\d{1,15})$/;
/** An asset's tags, kept beside it in Trash so they come back with it. */
const TRASH_TAGS = ".tags.json";
/** How long a deleted file's ID waits for the same file to reappear under a new name. */
const RENAME_WINDOW_MS = 60_000;

export interface VaultOptions {
  /** Milliseconds since the epoch: stamps changes and bounds the attribution and rename windows. Tests pass a fake clock. */
  now?: () => number;
  /** The largest note a write may leave behind, in bytes (UTF-8). Online, a SQLite row holds 2 MB. */
  maxNoteBytes?: number;
  /** The IANA time zone whose calendar "today" means (an agent's person's, online). Default: this machine's. */
  timeZone?: string;
}

/** The default largest note: enough for any note a person writes, not enough to exhaust memory. */
export const MAX_NOTE_BYTES = 10 * 1024 * 1024;
/**
 * How long a person can stop typing and still be in the same sitting: their next autosave to the
 * note joins the change the sitting started, so the log keeps one "before" per sitting, not per save.
 */
const SITTING_MS = 5 * 60_000;
/** How much note text one GET /diffs may send back in all; runs past it come without their text. */
const DIFF_TEXT_BUDGET = 16 * 1024 * 1024;

/**
 * The one core every surface (web UI, MCP server, CLI, Cloudflare workspace) talks to.
 * `files` is the source of truth (a folder locally, a table in the cloud); the rest of the
 * SQLite database is a rebuildable index plus the change log and each person's favorites.
 */

/** One section of the Today view: a heading and its tasks. */
/** What a task list asks for: see Vault.tasks. */
export interface TaskQuery {
  folder?: string;
  note?: string;
  tag?: string;
  /** One `@name`, as written. */
  assignee?: string;
  /** Any of these `@name`s: one person's every name. */
  assignees?: string[];
  due?: string;
  today?: string;
}

/** Who's asking, for lists that depend on it (tasksFor): their account and name, and the workspace's members (none locally). */
export interface Viewer {
  /** Their user ID online; the vault's one person locally. */
  user: string;
  /** Their name as the change log records it. */
  person: string;
  members: MemberRef[];
}

export interface TodaySection {
  id: "overdue" | "due" | "starting";
  title: string;
  tasks: Task[];
}
export interface TodayView {
  /** The reader's day, YYYY-MM-DD. */
  date: string;
  sections: TodaySection[];
  /** Today's journal note, and whether it's been written yet. */
  journal: { path: string; exists: boolean };
}

/** Cut the task on line index `i`, with the lines nested under it, out of `lines`; returns them, lifted to the top level. */
function cutTask(lines: string[], i: number): string[] {
  const indent = lines[i].match(/^\s*/)![0].length;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && lines[j].match(/^\s*/)![0].length > indent) j++;
  return lines.splice(i, j - i).map((l) => l.slice(indent));
}

/**
 * The index of the task on `line` (1-based) whose text is `text`, or, if the note moved it, of the
 * nearest line with that text, outside code. Throws if it's gone (the note changed under the caller).
 */
function findTask(lines: string[], line: number, text: string, notePath: string): number {
  // Only prose lines hold tasks: a checkbox inside a code block is an example, not one to tick.
  const prose = proseLines(lines.join("\n")).map(([n]) => n - 1);
  const matches = (i: number) => lines[i]?.match(TASK_LINE)?.[4] === text;
  if (prose.includes(line - 1) && matches(line - 1)) return line - 1;
  const near = prose.filter(matches).sort((a, b) => Math.abs(a - (line - 1)) - Math.abs(b - (line - 1)));
  if (!near.length) throw new VaultError(`That task isn't in ${notePath} any more`, "conflict");
  return near[0];
}

type TaskRow = { path: string; title: string; line: number; done: number; task: string };
const toTask = (r: TaskRow): Task => {
  const t = JSON.parse(r.task) as Pick<Task, "text" | "summary" | "heading" | "meta">;
  return { path: r.path, title: r.title, line: r.line, text: t.text, summary: t.summary, done: r.done === 1, heading: t.heading, meta: t.meta };
};

/** A note's checkbox tasks (with text), each with the heading it sits under: what the index keeps for Vault.tasks. */
function tasksIn(text: string): Array<Pick<Task, "line" | "text" | "summary" | "done" | "heading" | "meta">> {
  const out: ReturnType<typeof tasksIn> = [];
  let heading: string | null = null;
  // A board's cards sit under its columns' headings; after its `:::`, the heading before it again.
  let outside: string | null | undefined;
  for (const [at, line] of proseLines(text)) {
    const words = headingText(line.match(/^#{1,6}[ \t]+(.*)$/)?.[1] ?? "");
    if (words) heading = headingName(words) || words;
    if (/^\s*:::kanban\b/i.test(line)) outside = heading;
    else if (outside !== undefined && /^\s*:::\s*$/.test(line)) [heading, outside] = [outside, undefined];
    const t = parseTask(line);
    if (t && t.text.trim()) out.push({ line: at, text: t.text, summary: t.summary, done: t.done, heading, meta: t.meta });
  }
  return out;
}

export class Vault {
  private now: () => number;
  private maxNoteBytes: number;
  private timeZone: string | undefined;

  constructor(
    readonly db: SqlDb,
    readonly files: Content,
    opts: VaultOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.maxNoteBytes = opts.maxNoteBytes ?? MAX_NOTE_BYTES;
    this.timeZone = opts.timeZone;
  }

  /** Today, as YYYY-MM-DD, in this core's time zone. */
  day(): string {
    return localDate(this.now(), this.timeZone);
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
        // One note the parser chokes on mustn't keep the whole vault from opening.
        try {
          this.indexFile(rel);
          indexed++;
        } catch (e) {
          console.error(`Couldn't index ${rel}:`, e);
        }
      }
    }
    for (const rel of known.keys()) {
      this.unindex(rel);
      removed++;
    }
    const st = this.files.stat(ASSET_TAGS);
    if ((st ? `${st.mtime}:${st.size}` : "") !== this.assetTagsSeen) this.indexAssetTags(this.assetTags());
    return { indexed, removed };
  }

  /** The asset tags file as last indexed ("mtime:size"), so sync reads it again only when it changes. */
  private assetTagsSeen: string | null = null;

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
    let date: string | null = null;
    if (kind === "asset") {
      version = versionOf(`${st.size}:${st.mtime}`);
      title = path.posix.basename(rel);
    } else {
      content ??= this.files.read(rel) ?? "";
      version = versionOf(content);
      title = titleOf(content, kind, rel);
      body = searchableText(content, kind);
      date = dateOf(content, kind, rel);
    }
    const known = this.db.get<IndexedRow>("SELECT id, kind, fts FROM notes WHERE path = ?", rel);
    const noteId: string = known?.id ?? id ?? this.renamedId(rel, kind, version, st.size) ?? newNoteId();
    return this.db.tx(() => {
      this.dropText(rel, known);
      const fts = kind === "asset" ? null : this.db.run("INSERT INTO notes_fts(path, title, body) VALUES (?,?,?)", rel, title, body).lastId;
      this.db.run(
        `INSERT INTO notes(path, kind, title, stem, version, mtime, size, id, fts, date) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, title=excluded.title, stem=excluded.stem,
           version=excluded.version, mtime=excluded.mtime, size=excluded.size, fts=excluded.fts, date=excluded.date`,
        rel, kind, title, stemOf(rel), version, st.mtime, st.size, noteId, fts, date,
      );
      this.db.run("DELETE FROM links WHERE src = ?", rel);
      this.db.run("DELETE FROM tags WHERE path = ? AND kind != 'asset'", rel);
      this.db.run("DELETE FROM tasks WHERE path = ?", rel);
      if (kind === "md" && content) {
        const tasks = tasksIn(content).map(({ line, done, ...task }) => [rel, line, done ? 1 : 0, task.meta.due, task.meta.start, JSON.stringify(task)]);
        insertRows(this.db, "INSERT INTO tasks(path, line, done, due, start, task)", tasks);
        insertRows(this.db, "INSERT INTO links(src, key, kind, line)", extractLinks(content).map((l) => [rel, linkStem(l.key), l.kind, l.line]));
        const lines = content.split("\n");
        const tags = scanTags(content);
        insertRows(this.db, "INSERT INTO tags(tag, kind, path, line)", tags.map((t) => [t.tag, !t.frontmatter && TASK_LINE.test(lines[t.line - 1]) ? "task" : "note", rel, t.line]));
        for (const display of new Set(tags.map((t) => t.display))) this.nameTag(display);
        if (!isArchived(rel)) this.claimAddedTags(tags.map((t) => t.tag));
      }
      return { id: noteId, path: rel, kind, title, version, mtime: st.mtime, size: st.size };
    });
  }

  /** Remember how a tag is written, segment by segment, unless it (or a parent) is already known. */
  private nameTag(display: string) {
    const parts = display.split("/");
    let shown = "";
    for (let i = 0; i < parts.length; i++) {
      const tag = parts.slice(0, i + 1).join("/").toLowerCase();
      const known = this.db.get<{ display: string }>("SELECT display FROM tag_names WHERE tag = ?", tag)?.display;
      shown = known ?? (shown ? `${shown}/${parts[i]}` : parts[i]);
      if (!known) this.db.run("INSERT INTO tag_names(tag, display) VALUES (?,?)", tag, shown);
    }
  }

  private indexAssetTags(map: Record<string, string[]>) {
    const st = this.files.stat(ASSET_TAGS);
    this.assetTagsSeen = st ? `${st.mtime}:${st.size}` : "";
    // Every process (a CLI call, a Durable Object waking up) reads the file once; only write if it changed.
    const want = Object.entries(map).flatMap(([rel, tags]) => tags.map((t) => `${rel}\u0000${t.toLowerCase()}`)).sort();
    const have = this.db.all<{ path: string; tag: string }>("SELECT path, tag FROM tags WHERE kind = 'asset'").map((r) => `${r.path}\u0000${r.tag}`).sort();
    if (want.join("\n") === have.join("\n")) return;
    this.db.tx(() => {
      this.db.run("DELETE FROM tags WHERE kind = 'asset'");
      for (const [rel, tags] of Object.entries(map)) {
        for (const t of tags) {
          this.db.run("INSERT INTO tags(tag, kind, path, line) VALUES (?,'asset',?,0)", t.toLowerCase(), rel);
          this.nameTag(t);
        }
      }
      this.claimAddedTags(Object.entries(map).flatMap(([rel, tags]) => (isArchived(rel) ? [] : tags.map((t) => t.toLowerCase()))));
    });
  }

  /** Tags added by name that a note, task or asset now carries (`tags`, or a tag under one) are ordinary tags from here on. */
  private claimAddedTags(tags: string[]) {
    const keys = [...new Set(tags.flatMap(withParents))];
    if (!keys.length || !this.db.get("SELECT 1 FROM added_tags LIMIT 1")) return;
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      this.db.run(`DELETE FROM added_tags WHERE tag IN (${chunk.map(() => "?").join(",")})`, ...chunk);
    }
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

  /** Take a note's text out of the full-text index: by its row, or (an index from before `fts`) by path. */
  private dropText(rel: string, known: IndexedRow | undefined) {
    if (known?.fts != null) this.db.run("DELETE FROM notes_fts WHERE rowid = ?", known.fts);
    else if (known && known.kind !== "asset") this.db.run("DELETE FROM notes_fts WHERE path = ?", rel);
  }

  unindex(rel: string): void {
    const row = this.db.get<IndexedRow & { version: string }>("SELECT id, kind, version, fts FROM notes WHERE path = ?", rel);
    if (row?.id) {
      this.gone.set(`${row.kind}:${row.version}`, { id: row.id, at: this.now() });
      for (const [k, v] of this.gone) if (this.now() - v.at > RENAME_WINDOW_MS) this.gone.delete(k);
    }
    this.db.tx(() => {
      this.dropText(rel, row);
      this.db.run("DELETE FROM notes WHERE path = ?", rel);
      this.db.run("DELETE FROM links WHERE src = ?", rel);
      this.db.run("DELETE FROM tags WHERE path = ? AND kind != 'asset'", rel);
      this.db.run("DELETE FROM tasks WHERE path = ?", rel);
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

  /**
   * All notes, or one folder's, or the ones carrying `tag` (or a tag under it) themselves, not just
   * on a task. Archived notes are left out unless asked for (or you list Archive/).
   */
  list(folder?: string, scope: ArchiveScope = "active", tag?: string): NoteMeta[] {
    let rows = this.db.all<NoteMeta>(`SELECT ${META_COLS} FROM notes ORDER BY path COLLATE NOCASE`);
    // Several tags (`work,plan`): the notes with every one.
    for (const t of tag === undefined ? [] : tagList(tag).length ? tagList(tag) : [tag]) {
      const on = new Set(this.tagged(t).filter((r) => r.kind !== "task").map((r) => r.path));
      rows = rows.filter((r) => on.has(r.path));
    }
    if (!folder) return rows.filter((r) => inScope(r.path, scope));
    const prefix = cleanPath(folder).replace(/\/?$/, "/");
    return rows.filter((r) => r.path.startsWith(prefix) && (isArchived(prefix) || inScope(r.path, scope)));
  }

  recent(limit = 20): NoteMeta[] {
    return this.db.all(
      `SELECT ${META_COLS} FROM notes WHERE kind != 'asset' AND NOT ${archivedSql("path")} ORDER BY mtime DESC LIMIT ?`,
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
          if (kindOf(rel) && this.files.stat(rel)) return this.indexedPath(rel);
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
      .filter((p) => linkKey(p) === key || linkKey(p).endsWith(`/${key}`));
    if (!rows.length) return null;
    const dir = from ? path.posix.dirname(from) : null;
    rows.sort((a, b) => Number(path.posix.dirname(b) === dir) - Number(path.posix.dirname(a) === dir) || a.length - b.length);
    return rows[0];
  }

  /**
   * `rel` as the index spells it. A Mac's disk ignores case and Unicode form, so it finds
   * "projects/café.md" for Projects/Café.md in either form; taken as typed, it would be indexed as a
   * second note.
   */
  private indexedPath(rel: string): string {
    if (this.meta(rel)) return rel;
    const fold = (p: string) => p.normalize("NFC").toLowerCase();
    return this.db.all<{ path: string }>("SELECT path FROM notes").find((r) => fold(r.path) === fold(rel))?.path ?? rel;
  }

  private mustResolve(target: string): string {
    const rel = this.resolve(target);
    if (!rel) throw new VaultError(`No note matches "${target}". Try search_notes to find it.`, "not_found");
    return rel;
  }

  read(target: string): Note {
    const rel = this.mustResolve(target);
    const kind = kindOf(rel)!;
    if (kind === "asset") throw new VaultError(`${rel} is a binary asset, not a note`);
    const content = this.files.read(rel);
    if (content === null) throw new VaultError(`No note matches "${target}"`, "not_found");
    const meta = this.meta(rel) ?? this.indexFile(rel, content)!;
    return { ...meta, version: versionOf(content), content };
  }

  outline(target: string): Heading[] {
    return outlineOf(this.read(target).content);
  }

  /** Full-text search, optionally only among notes carrying `tag` (or a tag under it). */
  search(query: string, limit = 20, scope: ArchiveScope = "active", tag?: string): SearchHit[] {
    const terms = searchTerms(query);
    const key = tag === undefined ? null : normalizeTag(tag);
    if (!terms.length || (tag !== undefined && !key)) return [];
    // Ordered by rank, the full-text index hands hits over best first, so the query stops at `limit`
    // and makes snippets only for the hits it returns (a 1 MB note's snippet can take 200 ms).
    const rows = this.db.all(
      `SELECT n.path, n.title, n.kind,
              snippet(notes_fts, 2, char(1), char(2), '…', 16) AS snippet,
              rank AS score
       FROM notes_fts JOIN notes n ON n.path = notes_fts.path
       WHERE notes_fts MATCH ? AND rank MATCH 'bm25(4.0, 8.0, 1.0)'
         AND (? = 'all' OR (${archivedSql("n.path")}) = (? = 'archived'))
         AND (? IS NULL OR n.path IN (SELECT path FROM tags WHERE kind != 'task' AND ${UNDER}))
       ORDER BY rank LIMIT ?`,
      ftsQuery(terms), scope, scope, key, ...under(key ?? ""), limit,
    );
    return rows.map((r) => ({ ...r, lines: this.matchingLines(r.path, terms) }));
  }

  private matchingLines(rel: string, terms: string[], max = 3, content = this.files.read(rel) ?? ""): SearchHit["lines"] {
    const needles = terms.map((t) => t.toLowerCase());
    const lines: SearchHit["lines"] = [];
    const text = content.split("\n");
    for (let i = 0; i < text.length && lines.length < max; i++) {
      const l = text[i].toLowerCase();
      if (needles.some((n) => l.includes(n))) lines.push({ line: i + 1, text: text[i].trim().slice(0, 200) });
    }
    return lines;
  }

  /**
   * A stream of notes, newest first, for the Notes view. `q` filters with full-text search;
   * `folder` matches the note's original folder whether or not it's archived. Newest first puts
   * `start` notes ahead and the agents' instructions after the rest (see noteRoles.ts).
   */
  feed(opts: Omit<NoteQuery, "limit"> & { scope?: ArchiveScope; offset?: number; limit?: number } = {}) {
    const scope = opts.scope ?? "active";
    const terms = searchTerms(opts.q ?? "");
    const all = this.feedRows();
    let rows = this.matching(opts, all);
    const counts = { active: rows.filter((r) => !isArchived(r.path)).length, archived: rows.filter((r) => isArchived(r.path)).length };
    rows = rows.filter((r) => inScope(r.path, scope));
    const starts = new Set(this.db.all<{ path: string }>("SELECT DISTINCT path FROM tags WHERE tag = ?", START_TAG).map((r) => r.path));
    const roleOf = (p: string): NoteRole | null => (p === AGENTS_NOTE ? "agents" : starts.has(p) && !isArchived(p) ? "start" : null);
    if (!opts.sort || opts.sort === "modified") {
      const rank = (p: string) => ({ start: 0, agents: 2, none: 1 })[roleOf(p) ?? "none"];
      rows = [...rows].sort((a, b) => rank(a.path) - rank(b.path));
    }
    const offset = opts.offset ?? 0;
    const page = rows.slice(offset, offset + (opts.limit ?? 30));
    // The page's tags and who changed each note last, a few queries for the whole page.
    const tags = new Map<string, string[]>();
    const last = new Map<string, Actor & { source: string }>();
    for (let i = 0; i < page.length; i += 90) {
      const paths = page.slice(i, i + 90).map((r) => r.path);
      const marks = paths.map(() => "?").join(",");
      for (const t of this.db.all<{ path: string; display: string }>(
        `SELECT t.path, coalesce(n.display, t.tag) AS display FROM tags t LEFT JOIN tag_names n ON n.tag = t.tag
         WHERE t.path IN (${marks}) AND t.kind != 'task' GROUP BY t.path, t.tag ORDER BY t.path, min(t.line), min(t.rowid)`,
        ...paths,
      )) {
        if (!tags.has(t.path)) tags.set(t.path, []);
        tags.get(t.path)!.push(t.display);
      }
      for (const c of this.db.all<{ path: string } & Actor & { source: string }>(
        `SELECT path, source, person, agent FROM changes WHERE id IN (SELECT max(id) FROM changes WHERE path IN (${marks}) GROUP BY path)`,
        ...paths,
      )) {
        last.set(c.path, c);
      }
    }
    const items: FeedItem[] = page.map((r) => {
      const content = this.files.read(r.path) ?? "";
      const body = r.kind === "md" ? splitFrontmatter(content).body : "";
      return {
        id: r.id,
        path: r.path,
        kind: r.kind,
        title: r.title,
        mtime: r.mtime,
        archived: isArchived(r.path),
        excerpt: excerptOf(body, r.title),
        tags: tags.get(r.path) ?? [],
        lines: terms.length ? this.matchingLines(r.path, terms, 3, content) : [],
        lastSource: last.get(r.path)?.source ?? null,
        lastBy: last.has(r.path) ? { person: last.get(r.path)!.person, agent: last.get(r.path)!.agent } : null,
        role: roleOf(r.path),
      };
    });
    return { items, total: rows.length, counts, folders: [...new Set(all.map((n) => homeOf(n.path)).filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort() };
  }

  /** Every note (not assets), archived ones included, newest first: what matching() narrows. */
  private feedRows(): Array<{ id: string; path: string; kind: NoteKind; title: string; mtime: number; date: string | null }> {
    return this.db.all("SELECT id, path, kind, title, mtime, date FROM notes WHERE kind != 'asset' ORDER BY mtime DESC");
  }

  /** The notes a query matches, archived ones included, in its order. The part of the feed smart folder counts need. */
  private matching(query: NoteQuery, all = this.feedRows()): ReturnType<Vault["feedRows"]> {
    const terms = searchTerms(query.q ?? "");
    let rows = all;
    if (terms.length) {
      const hits = new Set(this.db.all("SELECT path FROM notes_fts WHERE notes_fts MATCH ?", ftsQuery(terms)).map((r) => r.path));
      rows = rows.filter((r) => hits.has(r.path));
    }
    if (query.folder) rows = rows.filter((r) => homeOf(r.path).startsWith(query.folder!.replace(/\/?$/, "/")));
    // Every tag, each with the tags under it: `work,plan` is the notes with both.
    for (const tag of tagList(query.tag)) {
      const key = normalizeTag(tag);
      const on = new Set(key ? this.db.all<{ path: string }>(`SELECT DISTINCT path FROM tags WHERE kind != 'task' AND ${UNDER}`, ...under(key)).map((r) => r.path) : []);
      rows = rows.filter((r) => on.has(r.path));
    }
    if (query.sort === "title") rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));
    if (query.sort === "date" || query.sort === "oldest") {
      // A note's own date, else the day it last changed; the same day goes by when it changed.
      const day = (r: (typeof rows)[number]) => r.date ?? new Date(r.mtime).toISOString().slice(0, 10);
      const dir = query.sort === "date" ? -1 : 1;
      rows = [...rows].sort((a, b) => dir * (day(a).localeCompare(day(b)) || a.mtime - b.mtime));
    }
    return rows;
  }

  /**
   * The notes linking to `target`. `scope` "active" leaves out links from archived notes (old copies
   * shouldn't sit beside the live ones), unless `target` is archived itself. Renames and deletes need
   * them all, which is the default.
   */
  backlinks(target: string, scope: ArchiveScope = "all"): Backlink[] {
    const rel = this.mustResolve(target);
    if (scope === "active" && isArchived(rel)) scope = "all";
    const stem = stemOf(rel);
    const rows = this.db.all(
      `SELECT DISTINCT l.src AS path, n.title, l.kind, l.line FROM links l JOIN notes n ON n.path = l.src
       WHERE l.key = ? AND l.src != ? ORDER BY n.mtime DESC, l.line`,
      stem, rel,
    );
    const cache = new Map<string, string[]>();
    const resolve = this.resolver();
    return rows
      .filter((r) => inScope(r.path, scope))
      .filter((r) => this.linksAt(r.path, r.line, cache).some((l) => linkStem(l.key) === stem && resolve(l.target, r.path) === rel))
      .map((r) => ({ ...r, text: (cache.get(r.path)?.[r.line - 1] ?? "").trim().slice(0, 200) }));
  }

  /**
   * Links to notes and files that aren't here: not yet written, deleted, or not brought over in an
   * import. Grouped by target, the most-linked first. Links in archived notes count only with
   * `scope` "all"; `folder` narrows it to the notes linking from there. A target is spelled as the
   * first note by path writes it, so the answer doesn't change with which note was saved last.
   */
  missingLinks(opts: { folder?: string; scope?: ArchiveScope } = {}): MissingLink[] {
    const folder = opts.folder ? cleanPath(opts.folder).replace(/\/?$/, "/") : "";
    const rows = this.db.all<{ path: string; title: string; line: number }>(
      "SELECT DISTINCT l.src AS path, n.title, l.line FROM links l JOIN notes n ON n.path = l.src ORDER BY l.src, l.line",
    ).filter((r) => r.path.startsWith(folder) && inScope(r.path, opts.scope ?? "active"));
    const cache = new Map<string, string[]>();
    const resolve = this.resolver();
    const groups = new Map<string, MissingLink>();
    for (const r of rows) {
      for (const l of this.linksAt(r.path, r.line, cache)) {
        const name = l.target.replace(/[#|].*$/, "").trim();
        // [[#Heading]] is this note; /calendar links open the calendar.
        if (!name || /^\/?calendar(\/|$)/.test(name) || resolve(l.target, r.path)) continue;
        const key = linkKey(name);
        const group = groups.get(key) ?? { target: name, from: [] };
        groups.set(key, group);
        if (!group.from.some((f) => f.path === r.path && f.line === r.line)) {
          group.from.push({ path: r.path, title: r.title, kind: l.kind, line: r.line, text: (cache.get(r.path)?.[r.line - 1] ?? "").trim().slice(0, 200) });
        }
      }
    }
    return [...groups.values()].sort((a, b) => b.from.length - a.from.length || a.target.localeCompare(b.target));
  }

  /**
   * resolve(), remembering each answer, for reading many links while no note comes or goes. What a
   * link resolves to depends only on its text and the folder it's in.
   */
  private resolver() {
    const seen = new Map<string, string | null>();
    return (target: string, from: string) => {
      const key = `${path.posix.dirname(from)}\n${target}`;
      if (!seen.has(key)) seen.set(key, this.resolve(target, from));
      return seen.get(key)!;
    };
  }

  /** The links on one line of a note. */
  private linksAt(src: string, line: number, cache: Map<string, string[]>) {
    if (!cache.has(src)) cache.set(src, (this.files.read(src) ?? "").split("\n"));
    return extractLinks(cache.get(src)![line - 1] ?? "");
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
      if (Number.isNaN(sinceTs)) throw new VaultError(`Bad "since": ${opts.since} (use an ISO time or a change id)`);
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
  recordChange(c: Omit<Change, "id" | "ts" | "note_id" | "person" | "agent">, before: string | null = null, opts: { autosave?: boolean; replaces?: number } = {}): Change {
    const ts = this.now();
    const noteId = this.meta(c.path)?.id ?? null;
    const { source, person, agent } = actorOf(c.source);
    const insert = () =>
      this.db.run(
        "INSERT INTO changes(ts, path, op, source, version, summary, from_path, before, note_id, person, agent, autosave) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ts, c.path, c.op, source, c.version, c.summary, c.from_path, before, noteId, person, agent, opts.autosave && !agent ? 1 : null,
      ).lastId;
    const id = this.db.tx(() => {
      const next = insert();
      if (opts.replaces) {
        // A sitting's change moves to a new id as it grows, so catching up by id (recent_changes) sees it again.
        this.db.run("UPDATE changes SET base_id = ? WHERE base_id = ?", next, opts.replaces);
        this.db.run("DELETE FROM changes WHERE id = ?", opts.replaces);
      }
      chainBefore(this.db, next, noteId, before);
      return next;
    });
    return { ...c, source, id, ts, note_id: noteId, person, agent };
  }

  /**
   * The change a person's autosave continues: the note's latest change is their autosave from less
   * than SITTING_MS ago, it left the note as this save found it, and they've changed nothing since.
   */
  private sittingOf(rel: string, source: string, current: string): { id: number; before: string | null } | null {
    const noteId = this.meta(rel)?.id;
    const last = noteId ? this.db.get("SELECT id, ts, source, autosave, version FROM changes WHERE note_id = ? ORDER BY id DESC LIMIT 1", noteId) : undefined;
    if (!last?.autosave || last.source !== source || this.now() - last.ts > SITTING_MS || last.version !== versionOf(current)) return null;
    if (this.db.get("SELECT 1 FROM changes WHERE id > ? AND source = ? LIMIT 1", last.id, source)) return null;
    return { id: last.id, before: readBefore(this.db, last.id) };
  }

  /**
   * The text of a note before change #from and after change #to (the same id for one change; a
   * range for a run of autosaves). Either side is null if it can't be recovered.
   */
  diff(fromId: number, toId: number): { path: string; op: Change["op"]; before: string | null; after: string | null } {
    const first = this.db.get("SELECT op FROM changes WHERE id = ?", fromId);
    const last = this.db.get(`SELECT ${CHANGE_COLS} FROM changes WHERE id = ?`, toId) as Change | undefined;
    if (!first || !last) throw new VaultError(`No change #${first ? toId : fromId}`, "not_found");
    const seen = new Map<number, string>();
    const before = first.op === "create" || first.op === "restore" ? "" : readBefore(this.db, fromId, seen);
    return { path: last.path, op: last.op, before, after: last.op === "delete" ? "" : this.textAfter(last, seen) };
  }

  /**
   * What a hand-picked set of changes did, note by note. Each note's selected changes are merged
   * into runs; a change left out of the selection (on that note) splits a run, so every run is a
   * real before/after rather than a guess at what the note would be without the skipped change.
   * Changes to other notes don't matter: leaving them out just leaves those notes out.
   * `budget` caps the text read (shared by the sets of one diffStats call).
   */
  diffSet(ids: number[], budget = { left: DIFF_TEXT_BUDGET }): DiffFile[] {
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
        f.open = { from: c.id, to: c.id, count: 1, sources: [c.source], tsFrom: c.ts, tsTo: c.ts, op: c.op, summary: c.summary, skipped: f.runs.length ? f.broken : 0, before: null, after: null, stat: null };
        f.broken = 0;
        f.runs.push(f.open);
      }
    }
    return [...files.values()]
      .sort((a, b) => b.last - a.last)
      .map(({ open: _o, broken: _b, ...f }) => ({
        ...f,
        runs: f.runs.map((r) => {
          if (budget.left <= 0) return r; // past the budget: the run without its text
          const d = this.diff(r.from, r.to);
          budget.left -= (d.before?.length ?? 0) + (d.after?.length ?? 0);
          return { ...r, before: d.before, after: d.after, stat: d.before === null || d.after === null ? null : lineStat(d.before, d.after) };
        }),
      }));
  }

  /**
   * The lines each set of changes added and removed, as diffSet counts them (its runs summed): the
   * net change, not the sum of each save's own count, so a line typed and then deleted counts for
   * nothing. Null for a set with a run whose text isn't available.
   */
  diffStats(sets: number[][]): Array<LineStat | null> {
    const budget = { left: DIFF_TEXT_BUDGET };
    return sets.map((ids) => {
      const runs = this.diffSet(ids, budget).flatMap((f) => f.runs);
      if (!runs.length || runs.some((r) => !r.stat)) return null;
      return runs.reduce((t, r) => ({ add: t.add + r.stat!.add, del: t.del + r.stat!.del }), { add: 0, del: 0 });
    });
  }

  /**
   * A note's text right after a change: the next change's `before`, or the file as it is now,
   * following later moves. Candidates are checked against the change's version hash.
   */
  private textAfter(c: Change, seen = new Map<number, string>()): string | null {
    if (!c.version) return null;
    let at = c.path;
    let since = c.id;
    for (let hop = 0; hop < 8; hop++) {
      for (const r of this.db.all<{ id: number }>("SELECT id FROM changes WHERE path = ? AND id > ? AND before IS NOT NULL ORDER BY id LIMIT 20", at, since)) {
        const text = readBefore(this.db, r.id, seen);
        if (text !== null && versionOf(text) === c.version) return text;
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

  /** Put a note back the way it was before change #id; with `baseVersion`, only if the note is still at it. */
  restore(id: number, source: string, baseVersion?: string) {
    const row = this.db.get("SELECT path, op, note_id FROM changes WHERE id = ?", id);
    if (!row) throw new VaultError(`No change #${id}`, "not_found");
    // A note deleted by this change is still in Trash: bring it back from there, ID and all.
    const trashed = row.op === "delete" ? this.trashIds().find((t) => t.endsWith(`-${id}`)) : undefined;
    if (trashed) return this.untrash([trashed], source)[0];
    const before = readBefore(this.db, id);
    if (before === null) throw new VaultError(`Change #${id} (${row.op} ${row.path}) has no earlier text to restore`);
    // Find the note by its ID, wherever it lives now (renamed, archived), never a different note
    // that took its path since.
    const noteId = row.note_id as string | null;
    let at = noteId ? this.pathOf(noteId) : (row.path as string);
    if (!at) {
      // Deleted since, and still in Trash? Bring that note back first, so the old text lands on it
      // (its ID, favorite and labels) rather than on a new note beside it. Gone for good: a new
      // note at a free name.
      const inTrash = this.trashIds().find((t) => this.db.get("SELECT 1 FROM changes WHERE id = ? AND note_id = ?", Number(t.split("-")[1]), noteId));
      at = inTrash ? this.untrash([inTrash], source)[0].path : this.freePath(row.path);
      baseVersion = undefined; // the note wasn't there to have changed
    }
    return { ...this.save(at, before, { source, baseVersion }), path: at };
  }

  // ---------------------------------------------------------------- labels

  /**
   * Label a version of a note with a name ("Sent to Alex", "v1"): the note as it is now, or, with
   * `at`, as it was right after that change. The label keeps the version's text.
   */
  label(target: string, name: string, source: string, opts: { description?: string; at?: number } = {}): Label {
    const rel = this.mustResolve(target);
    if (kindOf(rel) === "asset") throw new VaultError(`${rel} is a file, not a note: only notes have labels`);
    const noteId = this.meta(rel)!.id;
    const named = labelName(name);
    const description = opts.description?.trim().slice(0, LABEL_DESCRIPTION_MAX) || null;
    let text: string;
    let changeId: number | null;
    if (opts.at !== undefined) {
      const c = this.db.get(`SELECT ${CHANGE_COLS} FROM changes WHERE id = ?`, opts.at) as Change | undefined;
      if (!c || c.note_id !== noteId) throw new VaultError(`Change #${opts.at} isn't a change to ${rel}`, "not_found");
      if (c.op === "delete" || c.op === "purge") throw new VaultError(`Change #${opts.at} deleted ${c.path}: there's no version after it to label`);
      const after = this.textAfter(c);
      if (after === null) throw new VaultError(`The text right after change #${opts.at} isn't in the change log any more`);
      [text, changeId] = [after, c.id];
    } else {
      text = this.files.read(rel) ?? "";
      const at = this.db.get("SELECT id FROM changes WHERE note_id = ? AND version = ? ORDER BY id DESC LIMIT 1", noteId, versionOf(text));
      changeId = at?.id ?? null;
    }
    const id = newNoteId();
    this.db.tx(() => {
      if (this.db.get("SELECT 1 FROM labels WHERE note_id = ? AND lower(name) = lower(?)", noteId, named)) {
        throw new VaultError(`${rel} already has a version labeled "${named}"`, "exists");
      }
      if ((this.db.get("SELECT count(*) AS n FROM labels WHERE note_id = ?", noteId)?.n ?? 0) >= LABELS_PER_NOTE) {
        throw new VaultError(`${rel} has ${LABELS_PER_NOTE} labels already: delete one first`, "invalid");
      }
      const who = actorOf(source);
      this.db.run(
        "INSERT INTO labels(id, note_id, change_id, name, description, version, text, ts, source, person, agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        id, noteId, changeId, named, description, versionOf(text), text, this.now(), who.source, who.person, who.agent,
      );
    });
    return this.findLabel(id);
  }

  /** A note's labels, or every note's (for History), newest first. */
  labels(target?: string, limit = 500): Label[] {
    const noteId = target ? this.meta(this.mustResolve(target))?.id : null;
    return this.db
      .all<Label & { now: string | null }>(`SELECT ${LABEL_COLS} FROM labels m LEFT JOIN notes n ON n.id = m.note_id WHERE (? IS NULL OR m.note_id = ?) ORDER BY m.ts DESC, m.rowid DESC LIMIT ?`, noteId, noteId, limit)
      .map(toLabel);
  }

  /** A label by its ID, or by its name on the note `target`. */
  findLabel(ref: string, target?: string): Label {
    const r = ref.trim();
    let row = this.db.get<Label & { now: string | null }>(`SELECT ${LABEL_COLS} FROM labels m LEFT JOIN notes n ON n.id = m.note_id WHERE m.id = ?`, r);
    if (!row && target) {
      const noteId = this.meta(this.mustResolve(target))?.id;
      row = this.db.get(`SELECT ${LABEL_COLS} FROM labels m LEFT JOIN notes n ON n.id = m.note_id WHERE m.note_id = ? AND lower(m.name) = lower(?)`, noteId, r);
    }
    if (!row) throw new VaultError(`No label "${ref}"${target ? ` on ${target}` : ""}. List them with list_labels.`, "not_found");
    return toLabel(row);
  }

  /** A label's text. */
  labelText(ref: string, target?: string): { label: Label; text: string } {
    const label = this.findLabel(ref, target);
    return { label, text: this.db.get("SELECT text FROM labels WHERE id = ?", label.id).text as string };
  }

  renameLabel(ref: string, name: string, opts: { description?: string | null; target?: string } = {}): Label {
    const label = this.findLabel(ref, opts.target);
    const named = labelName(name);
    if (this.db.get("SELECT 1 FROM labels WHERE note_id = ? AND lower(name) = lower(?) AND id != ?", label.note_id, named, label.id)) {
      throw new VaultError(`This note already has a version labeled "${named}"`, "exists");
    }
    const description = opts.description === undefined ? label.description : opts.description?.trim().slice(0, LABEL_DESCRIPTION_MAX) || null;
    this.db.run("UPDATE labels SET name = ?, description = ? WHERE id = ?", named, description, label.id);
    return this.findLabel(label.id);
  }

  /** Take the name off a version. Only the label goes: the note and its history stay as they are. */
  deleteLabel(ref: string, target?: string): Label {
    const label = this.findLabel(ref, target);
    this.db.run("DELETE FROM labels WHERE id = ?", label.id);
    return label;
  }

  /** Two versions of a note to compare: a label against another label, or against the note now (`to` = "now"). */
  compareLabels(from: string, to = "now", target?: string): { path: string; from: { label: Label; text: string }; to: { label: Label | null; text: string } } {
    const a = this.labelText(from, target);
    const b = to === "now" ? null : this.labelText(to, target ?? a.label.path ?? undefined);
    if (b && b.label.note_id !== a.label.note_id) throw new VaultError(`"${a.label.name}" and "${b.label.name}" are labels on different notes`);
    const path = a.label.path;
    if (!path) throw new VaultError(`The note labeled "${a.label.name}" is in Trash: restore it to compare its versions`, "not_found");
    return { path, from: a, to: b ?? { label: null, text: this.files.read(path) ?? "" } };
  }

  /** Put a note back to a label: one change like any other, so it's in History and can be undone. */
  restoreLabel(ref: string, source: string, opts: { baseVersion?: string; target?: string } = {}) {
    const { label, text } = this.labelText(ref, opts.target);
    if (!label.path) throw new VaultError(`The note labeled "${label.name}" is in Trash: restore it from Trash first`, "not_found");
    return { ...this.save(label.path, text, { source, baseVersion: opts.baseVersion }), path: label.path, label };
  }

  // ---------------------------------------------------------------- favorites

  /**
   * A person's favorites, in their order: starred notes wherever they live now (archived ones
   * included) and starred tags. A star whose note isn't in the index, or whose tag no note uses any
   * more, is skipped until it comes back.
   */
  favorites(user: string): Favorite[] {
    const out: Favorite[] = [];
    for (const f of this.db.all<{ note_id: string; path: string }>("SELECT note_id, path FROM favorites WHERE user = ? ORDER BY pos", user)) {
      if (f.note_id.startsWith("#")) {
        const t = this.tagInUse(f.note_id.slice(1));
        if (t) out.push(t);
        continue;
      }
      const here = this.pathOf(f.note_id);
      const meta = here ? this.meta(here) : this.meta(f.path);
      if (!meta) continue;
      if (meta.id !== f.note_id) {
        // The note is back at its old path under a new ID: move the star over (unless it has one already).
        const dup = out.some((m) => !isTagFavorite(m) && m.id === meta.id) || this.db.get("SELECT 1 FROM favorites WHERE user = ? AND note_id = ?", user, meta.id);
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
  star(user: string, target: string): Favorite[] {
    const meta = this.metaOf(target);
    if (meta.kind === "asset") throw new VaultError(`${meta.path} is a binary asset, not a note`);
    this.addFavorite(user, meta.id, meta.path);
    return this.favorites(user);
  }

  unstar(user: string, target: string): Favorite[] {
    this.db.run("DELETE FROM favorites WHERE user = ? AND note_id = ?", user, this.metaOf(target).id);
    return this.favorites(user);
  }

  /** Star a tag (and so everything under it) at the end of `user`'s favorites. It must be on a note. */
  starTag(user: string, raw: string): Favorite[] {
    const tag = normalizeTag(raw);
    if (!tag) throw new VaultError(`"${raw}" isn't a tag: use letters, numbers, - and _, nested with /`);
    const t = this.tagInUse(tag);
    if (!t) throw new VaultError(`No note has #${tag} yet`, "not_found");
    this.addFavorite(user, tagKey(tag), t.display);
    return this.favorites(user);
  }

  unstarTag(user: string, raw: string): Favorite[] {
    this.db.run("DELETE FROM favorites WHERE user = ? AND note_id = ?", user, tagKey(normalizeTag(raw) ?? ""));
    return this.favorites(user);
  }

  private addFavorite(user: string, key: string, path: string) {
    this.db.run(
      `INSERT INTO favorites(user, note_id, path, pos)
       VALUES (?, ?, ?, (SELECT coalesce(max(pos), 0) + 1 FROM favorites WHERE user = ?)) ON CONFLICT DO NOTHING`,
      user, key, path, user,
    );
  }

  /**
   * Put these favorites first, in this order; the rest follow in the order they had, stars whose
   * note is gone included. A `#tag` target is a starred tag.
   */
  orderFavorites(user: string, targets: string[]): Favorite[] {
    this.favorites(user); // rebinds stars to their notes' current IDs
    const starred = this.db.all<{ note_id: string }>("SELECT note_id FROM favorites WHERE user = ? ORDER BY pos", user).map((f) => f.note_id);
    const first = targets.map((t) => (t.startsWith("#") ? tagKey(normalizeTag(t) ?? "") : this.metaOf(t).id)).filter((id) => starred.includes(id));
    const order = [...new Set([...first, ...starred])];
    this.db.tx(() => order.forEach((id, i) => this.db.run("UPDATE favorites SET pos = ? WHERE user = ? AND note_id = ?", i + 1, user, id)));
    return this.favorites(user);
  }

  private metaOf(target: string): NoteMeta {
    const rel = this.mustResolve(target);
    const meta = this.meta(rel) ?? this.indexFile(rel);
    if (!meta) throw new VaultError(`No note matches "${target}"`, "not_found");
    return meta;
  }

  // ---------------------------------------------------------------- smart folders

  /** The smart folders `user` sees (the workspace's shared ones and their own), in order, each with how many active notes match. */
  smartFolders(user: string): SmartFolder[] {
    const folders = this.smartFolderRows(user);
    const all = folders.length ? this.feedRows() : [];
    return folders.map((r) => this.counted(r, all));
  }

  private smartFolderRows(user: string) {
    return this.db
      .all<{ id: string; name: string; query: string; owner: string | null }>("SELECT id, name, query, owner FROM smart_folders WHERE owner IS NULL OR owner = ? ORDER BY pos", user)
      .map((r) => ({ id: r.id, name: r.name, query: r.query, shared: r.owner === null }));
  }

  private counted(f: Omit<SmartFolder, "count">, all = this.feedRows()): SmartFolder {
    return { ...f, count: this.matching(parseQuery(f.query), all).filter((r) => !isArchived(r.path)).length };
  }

  /**
   * One of `user`'s smart folders by ID, or (unless `idOnly`) by name in any case. A name means
   * their own folder before a shared one, so it never reaches past theirs to the workspace's.
   */
  findSmartFolder(user: string, target: string, idOnly = false): SmartFolder {
    const t = target.trim().toLowerCase();
    const rows = this.smartFolderRows(user);
    const named = idOnly ? [] : rows.filter((f) => f.name.toLowerCase() === t).sort((a, b) => Number(a.shared) - Number(b.shared));
    const found = rows.find((f) => f.id === t) ?? named[0];
    if (!found) throw new VaultError(`No smart folder "${target}". Try list_smart_folders.`, "not_found");
    return this.counted(found);
  }

  /**
   * Create a smart folder, or change one by `id`. A shared one belongs to the whole workspace, and
   * only someone who `canEditShared` (not a viewer, online) may create, change or unshare one. A
   * personal one is its owner's alone. The query is stored tidied.
   */
  saveSmartFolder(user: string, f: { id?: string; name: string; query: string; shared: boolean }, canEditShared: boolean, idOnly = false): SmartFolder {
    const name = f.name.trim();
    if (!name) throw new VaultError("Give the smart folder a name");
    if (name.length > 80) throw new VaultError("A smart folder's name can be up to 80 characters");
    if (f.query.length > 500) throw new VaultError("A smart folder's query can be up to 500 characters");
    const problem = queryProblem(f.query);
    if (problem) throw new VaultError(problem);
    // A limit sizes a widget; a smart folder shows (and counts) every match.
    const query = formatQuery({ ...parseQuery(f.query), limit: undefined });
    const existing = f.id ? this.findSmartFolder(user, f.id, idOnly) : null;
    if (!existing && this.db.get<{ n: number }>("SELECT count(*) AS n FROM smart_folders WHERE owner = ? OR (owner IS NULL AND ?)", user, f.shared ? 1 : 0)!.n >= 50) {
      throw new VaultError("That's 50 smart folders already. Delete one to make another.");
    }
    if ((f.shared || existing?.shared) && !canEditShared) {
      throw new VaultError("Only editors can create or change shared smart folders. Make it just yours instead.", "forbidden");
    }
    const owner = f.shared ? null : user;
    const id = existing?.id ?? newNoteId();
    if (existing) this.db.run("UPDATE smart_folders SET name = ?, query = ?, owner = ? WHERE id = ?", name, query, owner, id);
    else this.db.run("INSERT INTO smart_folders(id, name, query, owner, pos) VALUES (?,?,?,?,(SELECT coalesce(max(pos), 0) + 1 FROM smart_folders))", id, name, query, owner);
    return this.findSmartFolder(user, id);
  }

  /** Delete one of `user`'s smart folders (a shared one only if they `canEditShared`). Returns what they see now. */
  deleteSmartFolder(user: string, target: string, canEditShared: boolean, idOnly = false): SmartFolder[] {
    const f = this.findSmartFolder(user, target, idOnly);
    if (f.shared && !canEditShared) throw new VaultError("Only editors can delete shared smart folders.", "forbidden");
    this.db.run("DELETE FROM smart_folders WHERE id = ?", f.id);
    return this.smartFolders(user);
  }

  // ---------------------------------------------------------------- tags

  /**
   * Every tag in active notes, tasks and assets, and every tag added by name, parents included, by tag.
   * A tag on a task line counts for the task, not its note: `notes` is the notes that carry it themselves.
   */
  tags(): TagCount[] {
    const shown = new Map(this.db.all<{ tag: string; display: string }>("SELECT tag, display FROM tag_names").map((r) => [r.tag, r.display]));
    const uses = new Map<string, { notes: Set<string>; tasks: Set<string>; assets: Set<string> }>();
    const use = (tag: string) => {
      let u = uses.get(tag);
      if (!u) uses.set(tag, (u = { notes: new Set(), tasks: new Set(), assets: new Set() }));
      return u;
    };
    const rows = this.db.all<TagUse & { tag: string }>(
      `SELECT t.tag, t.kind, t.path, t.line FROM tags t JOIN notes n ON n.path = t.path WHERE NOT ${archivedSql("t.path")}`,
    );
    for (const r of rows) {
      for (const tag of withParents(r.tag)) {
        const u = use(tag);
        if (r.kind === "asset") u.assets.add(r.path);
        else if (r.kind === "task") u.tasks.add(`${r.path}:${r.line}`);
        else u.notes.add(r.path);
      }
    }
    for (const { tag } of this.db.all<{ tag: string }>("SELECT tag FROM added_tags")) withParents(tag).forEach(use);
    return [...uses]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([tag, u]) => ({ tag, display: shown.get(tag) ?? tag, notes: u.notes.size, tasks: u.tasks.size, assets: u.assets.size }));
  }

  /**
   * Add a tag by name ("#work/clients" or "work/clients"), so it's there to pick before any note
   * carries it. Adding one again, or one already in use, changes nothing. Returns every tag.
   */
  addTag(raw: string): TagCount[] {
    const display = cleanTag(raw);
    if (!display) throw new VaultError(`"${raw}" isn't a tag: use letters, numbers, - and _, nested with /`);
    if (this.db.get<{ n: number }>("SELECT count(*) AS n FROM added_tags")!.n >= 500) {
      throw new VaultError("That's 500 tags waiting for a note already. Use some, or delete one.");
    }
    this.addUnused(display.toLowerCase());
    this.nameTag(display);
    return this.tags();
  }

  private addUnused(tag: string) {
    const used = this.db.get(`SELECT 1 FROM tags t JOIN notes n ON n.path = t.path WHERE ${UNDER} AND NOT ${archivedSql("t.path")} LIMIT 1`, ...under(tag));
    if (!used) this.db.run("INSERT OR IGNORE INTO added_tags(tag) VALUES (?)", tag);
  }

  /**
   * Take away a tag that was added by name, with the added tags under it. Nothing in the notes
   * changes, so a tag something carries can't go this way: rename it, or take it out of its notes.
   */
  removeTag(raw: string): TagCount[] {
    const tag = normalizeTag(raw);
    if (!tag) throw new VaultError(`"${raw}" isn't a tag`);
    const t = this.tags().find((x) => x.tag === tag);
    if (t && t.notes + t.tasks + t.assets) throw new VaultError(`#${t.display} is in use. Rename it, or take it out of what carries it.`, "conflict");
    this.db.run(`DELETE FROM added_tags WHERE ${UNDER}`, ...under(tag));
    return this.tags();
  }

  /** One tag's entry in tags(), counting only notes; null if no active note has it (or a tag under it). */
  private tagInUse(tag: string): TagFavorite | null {
    const notes = this.db.get<{ n: number }>(
      `SELECT count(DISTINCT t.path) AS n FROM tags t JOIN notes n ON n.path = t.path
       WHERE ${UNDER} AND t.kind = 'note' AND NOT ${archivedSql("t.path")}`,
      ...under(tag),
    )!.n;
    if (!notes) return null;
    return { tag, display: this.db.get<{ display: string }>("SELECT display FROM tag_names WHERE tag = ?", tag)?.display ?? tag, notes };
  }

  /** Everywhere `tag` or a tag under it is used, archived notes included, by path and line. */
  tagged(tag: string): TagUse[] {
    const key = normalizeTag(tag);
    if (!key) return [];
    return this.db.all(
      `SELECT DISTINCT t.kind, t.path, t.line FROM tags t JOIN notes n ON n.path = t.path WHERE ${UNDER} ORDER BY t.path, t.line`,
      ...under(key),
    );
  }

  /**
   * Each tagged asset's tags, as written, from the asset tags file. A file that isn't a JSON object
   * reads as none, unless it's read `forWrite`: writing back would drop every other asset's tags,
   * so that refuses until the file is fixed.
   */
  assetTags(forWrite = false): Record<string, string[]> {
    let data: unknown;
    try {
      data = JSON.parse(this.files.read(ASSET_TAGS) ?? "{}");
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      if (forWrite) throw new VaultError(`${ASSET_TAGS} isn't a valid tags file (a JSON object): fix it before changing asset tags`, "conflict");
      return {};
    }
    // fromEntries, not assignment, so a "__proto__" key stays a plain entry.
    return Object.fromEntries(
      Object.entries(data)
        .map(([rel, list]) => [rel, Array.isArray(list) ? uniqueTags(list.filter((t): t is string => typeof t === "string"), false) : []] as const)
        .filter(([, tags]) => tags.length),
    );
  }

  /** Set an asset's tags (an empty list clears them). Returns them as stored: tidied, each once. */
  setAssetTags(target: string, tags: string[]): string[] {
    const meta = this.metaOf(target);
    if (meta.kind !== "asset") throw new VaultError(`${meta.path} is a note: tag it with #tags in its text`);
    const clean = uniqueTags(tags, true);
    const map = this.assetTags(true);
    if (clean.length) map[meta.path] = clean;
    else delete map[meta.path];
    this.writeAssetTags(map);
    return clean;
  }

  private writeAssetTags(map: Record<string, string[]>) {
    const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
    this.files.write(ASSET_TAGS, `${JSON.stringify(sorted, null, 2)}\n`);
    this.indexAssetTags(sorted);
  }

  /**
   * Rename a tag (and every tag under it) in every note, task and asset, archived ones included.
   * Renaming onto a tag that exists merges the two. Each rewritten note is its own change, so any
   * of them can be restored; `assets` holds the tagged assets' lists from before, to put them back.
   */
  renameTag(from: string, to: string, source: string) {
    const old = normalizeTag(from);
    const next = cleanTag(to);
    if (!old) throw new VaultError(`"${from}" isn't a tag`);
    if (!next) throw new VaultError(`"${to}" isn't a tag: use letters, numbers, - and _, nested with /`);
    const map = this.assetTags(true);
    const edits: Array<{ path: string; content: string; version: string; change: Change }> = [];
    for (const rel of new Set(this.tagged(old).filter((r) => r.kind !== "asset").map((r) => r.path))) {
      const before = this.files.read(rel);
      const after = before === null ? null : renameTagIn(before, old, next);
      if (before === null || after === null || after === before) continue;
      const r = this.commit(rel, before, after, source, "edit");
      edits.push({ path: rel, content: after, version: r.version, change: r.change });
    }
    const assets: Record<string, string[]> = {};
    for (const [rel, tags] of Object.entries(map)) {
      if (!tags.some((t) => tagMatches(t.toLowerCase(), old))) continue;
      assets[rel] = tags;
      map[rel] = uniqueTags(tags.map((t) => (tagMatches(t.toLowerCase(), old) ? next + t.slice(old.length) : t)), false);
    }
    if (Object.keys(assets).length) this.writeAssetTags(map);
    const key = next.toLowerCase();
    // Tags added by name that nothing carries yet move with it, keeping how they were written.
    for (const { tag } of this.db.all<{ tag: string }>(`SELECT tag FROM added_tags WHERE ${UNDER}`, ...under(old))) {
      const written = this.db.get<{ display: string }>("SELECT display FROM tag_names WHERE tag = ?", tag)?.display ?? tag;
      this.db.run("DELETE FROM added_tags WHERE tag = ?", tag);
      this.addUnused(key + tag.slice(old.length));
      this.nameTag(next + (written.length === tag.length ? written : tag).slice(old.length));
    }
    // A starred tag (or one under it) follows the rename; a merge onto one someone had starred keeps theirs.
    if (key !== old) {
      for (const r of this.db.all<{ user: string; note_id: string }>(
        "SELECT user, note_id FROM favorites WHERE note_id = ? OR (note_id >= ? AND note_id < ?)", tagKey(old), tagKey(`${old}/`), tagKey(`${old}0`),
      )) {
        this.db.run("UPDATE OR IGNORE favorites SET note_id = ? WHERE user = ? AND note_id = ?", tagKey(key + r.note_id.slice(old.length + 1)), r.user, r.note_id);
        this.db.run("DELETE FROM favorites WHERE user = ? AND note_id = ?", r.user, r.note_id);
      }
    }
    // A rename is how a tag's written form changes: show it, and the tags under it, as typed.
    for (const r of this.db.all<{ tag: string; display: string }>(`SELECT tag, display FROM tag_names WHERE ${UNDER}`, ...under(next.toLowerCase()))) {
      this.db.run("UPDATE tag_names SET display = ? WHERE tag = ?", next + r.display.slice(r.display.split("/").slice(0, next.split("/").length).join("/").length), r.tag);
    }
    return { edits, assets };
  }

  // ---------------------------------------------------------------- writing

  private commit(rel: string, before: string | null, after: string, source: string, op: Change["op"], autosave = false) {
    // Every write through the core lands here, so one limit covers the API, MCP, the CLI and online.
    if (after.length > this.maxNoteBytes / 4 && new TextEncoder().encode(after).length > this.maxNoteBytes) {
      throw new VaultError(`${rel} would be over ${Math.round(this.maxNoteBytes / 1024 / 1024)} MB, the most a note can hold`, "invalid");
    }
    this.files.write(rel, after);
    const sitting = autosave && op === "edit" && before !== null ? this.sittingOf(rel, actorOf(source).source, before) : null;
    const meta = this.indexFile(rel, after)!;
    const from = sitting ? sitting.before : before;
    const change = this.recordChange(
      {
        path: rel,
        op,
        source,
        version: meta.version,
        summary: from === null ? `${after.split("\n").length} lines` : diffstat(from, after),
        from_path: null,
      },
      from,
      { autosave, replaces: sitting?.id },
    );
    return { ...meta, change };
  }

  create(target: string, content: string, source: string) {
    let rel = cleanPath(target);
    if (!kindOf(rel)) rel += ".md";
    const kind = kindOf(rel);
    if (kind === "asset") throw new VaultError("Only .md and .html notes can be created");
    if (this.files.stat(rel)) throw new VaultError(`${rel} already exists. To replace it, create it again with overwrite (--overwrite); to change part of it, use edit_note`, "exists", { path: rel });
    return this.commit(rel, null, content, source, "create");
  }

  /** Whole-file save with optimistic concurrency (what the editor uses). The editor's `autosave`s in one sitting are one change. */
  save(target: string, content: string, opts: { baseVersion?: string; source: string; autosave?: boolean }) {
    const rel = cleanPath(target);
    const kind = kindOf(rel);
    if (kind !== "md" && kind !== "html") throw new VaultError(`${rel} isn't a note: only .md and .html files can be saved as text`);
    const current = this.files.read(rel);
    const exists = current !== null;
    if (current !== null && opts.baseVersion && versionOf(current) !== opts.baseVersion) {
      const last = this.attribution(rel, versionOf(current), 24 * 3600_000);
      throw new VaultError(`${rel} changed on disk since version ${opts.baseVersion}`, "conflict", {
        version: versionOf(current),
        content: current,
        source: last?.source ?? "external",
      });
    }
    if (current === content) return { ...(this.meta(rel) ?? this.indexFile(rel, content)!), change: null };
    return this.commit(rel, current, content, opts.source, exists ? "edit" : "create", opts.autosave);
  }

  /** Exact-string replacement, the edit primitive agents are best at. */
  edit(
    target: string,
    opts: { oldString: string; newString: string; replaceAll?: boolean; baseVersion?: string },
    source: string,
  ) {
    const note = this.read(target);
    if (opts.baseVersion && opts.baseVersion !== note.version) {
      throw new VaultError(
        `${note.path} is at version ${note.version}, not ${opts.baseVersion}. Re-read it and retry.`,
        "conflict",
        { version: note.version },
      );
    }
    if (!opts.oldString) throw new VaultError("old_string must not be empty (use append_to_note to add text)");
    const count = note.content.split(opts.oldString).length - 1;
    if (count === 0) {
      throw new VaultError(`old_string not found in ${note.path}. Re-read the note; it may have changed.`, "not_found");
    }
    if (count > 1 && !opts.replaceAll) {
      throw new VaultError(`old_string occurs ${count} times in ${note.path}; add surrounding context or set replace_all.`);
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

  /**
   * Checkbox tasks across the vault (active notes), in note order, with the heading each sits under.
   * `tag` keeps the tasks whose line carries it (or a tag under it), `assignee` the ones with that
   * @person, and `due` the ones whose due date passes a filter like `<=today` (see dueFilter).
   * `today` (YYYY-MM-DD) is the day that filter means by today; the default is the core's clock.
   */
  tasks(opts: TaskQuery = {}): Task[] {
    const only = opts.note ? this.resolve(opts.note) : null;
    if (opts.note && !only) return [];
    const prefix = opts.folder ? opts.folder.replace(/^\/+|\/+$/g, "") + "/" : "";
    const tagged = opts.tag === undefined ? null : new Set(this.tagged(opts.tag).filter((r) => r.kind === "task").map((r) => `${r.path}:${r.line}`));
    if (opts.today && !isDate(opts.today)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${opts.today}"`);
    const due = opts.due ? dueFilter(opts.due, opts.today ?? this.day()) : null;
    if (opts.due && !due) throw new VaultError(`Bad due filter "${opts.due}": use a date or today/tomorrow/yesterday, optionally after <, <=, > or >=`);
    // `assignees` (any of them) is a person's every name; `assignee` one name, as written.
    const names = new Set([...(opts.assignees ?? []), ...(opts.assignee ? [opts.assignee] : [])].map((a) => a.replace(/^@/, "").toLowerCase()));
    // The query narrows to the note, or to notes with the tag on a task (the lines are checked below).
    // Each is its own query so the planner uses the index.
    const rows = only
      ? this.taskRows("t.path = ?", only)
      : opts.tag !== undefined
        ? this.taskRows(`t.path IN (SELECT path FROM tags WHERE kind = 'task' AND ${UNDER})`, ...under(normalizeTag(opts.tag) ?? ""))
        : this.taskRows("1");
    return rows
      .filter((r) => (!prefix || r.path.startsWith(prefix)) && (!tagged || tagged.has(`${r.path}:${r.line}`)))
      .map(toTask)
      .filter((t) => (!due || due(t.meta.due)) && (!names.size || t.meta.assignees.some((a) => names.has(a.toLowerCase()))));
  }

  /**
   * Whether `user` may read the note at `path`. Everyone in a workspace reads every note for now;
   * this is the one place per-note sharing (#12) decides otherwise. Lists that reach into other
   * people's notes for someone (tasksFor) ask it.
   */
  canRead(_user: string, _path: string): boolean {
    return true;
  }

  /**
   * Tasks as `viewer` asks for them, with people resolved: `assignee` is "me" (the viewer), or
   * someone's name, which finds every `@name` that's theirs (see peopleDirectory); `by: "me"` keeps
   * the tasks in notes the viewer made that are assigned to someone else. Only notes they may read.
   */
  tasksFor(viewer: Viewer, opts: TaskQuery & { assignee?: string; by?: "me" } = {}): Task[] {
    const { assignee, by, ...rest } = opts;
    const people = peopleDirectory(this.contactNotes(), viewer.members);
    // Online, "me" is the viewer's account (and the contact with their email). Locally there are
    // no accounts, so it's `@me`; online `@me` names no one, as every reader would be "me".
    const mine = viewer.members.length ? (people.find((p) => p.member === viewer.user)?.handles ?? []) : ["me"];
    const names = assignee === undefined ? undefined : assignee === "me" ? mine : (personFor(assignee, people)?.handles ?? [assignee]);
    if (names && !names.length) return [];
    let list = this.tasks({ ...rest, assignees: names });
    if (by === "me") {
      const authors = this.noteAuthors();
      const me = new Set(mine.map((h) => h.toLowerCase()));
      const author = viewer.person.toLowerCase();
      list = list.filter((t) => t.meta.assignees.length && authors.get(t.path)?.toLowerCase() === author && !t.meta.assignees.some((a) => me.has(a.toLowerCase())));
    }
    return list.filter((t) => this.canRead(viewer.user, t.path));
  }

  /** Who made each note: the person on its first change (an agent's note is its person's). */
  private noteAuthors(): Map<string, string> {
    const rows = this.db.all<{ path: string; person: string | null }>(
      "SELECT n.path, c.person FROM changes c JOIN notes n ON n.id = c.note_id WHERE c.id IN (SELECT MIN(id) FROM changes WHERE note_id IS NOT NULL GROUP BY note_id)",
    );
    return new Map(rows.filter((r) => r.person).map((r) => [r.path, r.person!]));
  }

  /** Each contact's note, read (without the mentions contacts() counts). */
  private contactNotes(): ContactNote[] {
    return this.list(PEOPLE)
      .filter((n) => n.kind === "md")
      .map((n) => contactFromNote(n.path, this.files.read(n.path) ?? ""));
  }

  /** How many tasks are still open in active notes: what tasks() would list with `done` false. */
  openTaskCount(): number {
    return this.db.get<{ n: number }>(`SELECT count(*) AS n FROM tasks t JOIN notes n ON n.path = t.path WHERE ${TASK_NOTES} AND t.done = 0`)!.n;
  }

  /** Tasks in active notes, from the index (see tasksIn), in note order: the ones `where` keeps. */
  private taskRows(where: string, ...args: unknown[]): TaskRow[] {
    return this.db.all<TaskRow>(
      `SELECT t.path, n.title, t.line, t.done, t.task FROM tasks t JOIN notes n ON n.path = t.path
       WHERE ${TASK_NOTES} AND ${where} ORDER BY t.path COLLATE NOCASE, t.path, t.line`,
      ...args,
    );
  }

  /** Tick or untick one task at its source. */
  setTask(target: string, line: number, text: string, done: boolean, source: string, today?: string) {
    return this.updateTask(target, line, text, { checked: done }, source, today);
  }

  /**
   * Change a task's tokens (see TaskPatch) at its source; the rest of the line stays as written.
   * Ticking stamps `done:` with `today` (the person's day; the core's clock by default) and
   * unticking takes it off, unless the patch sets it; a repeating task gets its next occurrence
   * below (see editTaskLines). `text` guards against the note having
   * changed: if the line moved, the nearest line with the same task text is used.
   */
  updateTask(target: string, line: number, text: string, patch: TaskPatch, source: string, today = this.day()) {
    const problem = patchProblem(patch) ?? (isDate(today) ? null : `"today" must be a date like 2026-10-01, not "${today}"`);
    if (problem) throw new VaultError(problem);
    const note = this.read(target);
    const lines = note.content.split("\n");
    const i = findTask(lines, line, text, note.path);
    const edited = editTaskLines(lines, i, patch, today);
    // Where the task is now and its new text, so a caller can make its next change without re-reading.
    const task = { line: i + 1, text: edited[i].match(TASK_LINE)![4] };
    const next = edited.join("\n");
    if (next === note.content) return { ...note, ...task, change: null };
    return { ...this.commit(note.path, note.content, next, source, "edit"), ...task };
  }

  // ---------------------------------------------------------------- boards

  /** A note and the `:::kanban` boards in it (see kanban.ts). */
  /** `unclosed`: the line of a `:::kanban` with no closing `:::`, which shows as text. */
  boards(target: string): { note: Note; boards: Board[]; unclosed: number | null } {
    const note = this.read(target);
    return { note, boards: boardsIn(note.content), unclosed: unclosedBoard(note.content) };
  }

  /**
   * Add a card to a column, by its name (any case) or number from 1, on whichever of the note's
   * boards has it; `board` (from 1) picks one when several do. `position` (from 1) is where it
   * goes in the column; the default is last.
   */
  addCard(target: string, column: string, text: string, source: string, opts: { board?: number; position?: number } = {}, today = this.day()) {
    if (!text.trim()) throw new VaultError("A card needs some text");
    const { note, boards } = this.boards(target);
    const at = findColumn(boards, column, note.path, opts.board);
    return this.commitBoard(note, addCard(note.content, at, text, today, (opts.position ?? Infinity) - 1), source);
  }

  /** Move a card (see findCard) to a column on its board, last or at `position` (from 1). Into the done column ticks it. */
  moveCard(target: string, card: string, column: string, source: string, opts: { position?: number } = {}, today = this.day()) {
    const { note, boards } = this.boards(target);
    const hit = findCard(boards, card, note.path);
    const to = findColumn(boards, column, note.path, hit.board + 1);
    return this.commitBoard(note, moveCard(note.content, hit.card.from, to, (opts.position ?? Infinity) - 1, today), source);
  }

  /** Change a card's text (its first line, then any lines to nest under it) or tick it. */
  editCard(target: string, card: string, patch: { text?: string; done?: boolean }, source: string, today = this.day()) {
    if (patch.text !== undefined && !patch.text.trim()) throw new VaultError("A card needs some text");
    const { note, boards } = this.boards(target);
    const { card: c } = findCard(boards, card, note.path);
    let next = patch.text === undefined ? note.content : editCard(note.content, c.from, patch.text);
    if (patch.done !== undefined) next = checkCard(next, c.from, patch.done, today);
    return this.commitBoard(note, next, source);
  }

  private commitBoard(note: Note, next: string, source: string) {
    return next === note.content ? { ...note, change: null } : this.commit(note.path, note.content, next, source, "edit");
  }

  /**
   * Add a task typed the way you'd say it ("Pay rent every month on the 1st #home"; see
   * quickAdd.ts). It goes under `## Tasks` in today's daily note (`Journal/YYYY-MM-DD.md`, made if
   * needed), or in the note named with `→ [[Note]]`: at the end of its Tasks section, or of the note.
   * `today` is the person's day; `ignore` holds phrases they chose to keep as words; `to` is a note
   * to use instead of the daily note (the one the bar was opened from), which `→ [[Note]]` overrides.
   */
  addTask(input: string, source: string, opts: { today?: string; ignore?: string[]; to?: string } = {}) {
    const today = opts.today ?? this.day();
    if (!isDate(today)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${today}"`);
    const q = parseQuickAdd(input, today, opts.ignore);
    if (!q.words) throw new VaultError("Say what the task is: once its dates and repeats are taken out, there are no words left");
    const named = q.target ?? opts.to;
    const rel = named ? this.mustResolve(named) : `Journal/${today}.md`;
    if (kindOf(rel) !== "md") throw new VaultError(`Tasks go in markdown notes, and ${rel} isn't one`);
    const before = this.files.read(rel);
    // A day with no note yet gets one from the daily template, with the task in its Tasks section.
    const added = withTasksAdded(before ?? this.dailyTemplate(today), [q.line], !named);
    const r = this.commit(rel, before, added.content, source, before === null ? "create" : "edit");
    return { ...r, line: added.line, text: q.line.match(TASK_LINE)![4] };
  }

  /**
   * The day at a glance: open tasks overdue, due today, and starting today (each task once, in that
   * order of urgency), and today's journal note. `date` is the reader's day. Sections are a list so
   * more (calendar, reviews, mail) can slot in beside these.
   */
  today(date = this.day()): TodayView {
    if (!isDate(date)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${date}"`);
    // Open tasks that could be in a section: due by today, or starting today.
    const open = this.taskRows("t.done = 0 AND (substr(t.due, 1, 10) <= ? OR substr(t.start, 1, 10) = ?)", date, date).map(toTask);
    const into = (id: string) => open.filter((t) => todaySection(t.meta, date) === id);
    const overdue = into("overdue").sort((a, b) => a.meta.due!.localeCompare(b.meta.due!));
    const [due, starting] = [into("due"), into("starting")];
    const journal = `Journal/${date}.md`;
    return {
      date,
      sections: [
        { id: "overdue", title: "Overdue", tasks: overdue },
        { id: "due", title: "Due today", tasks: due },
        { id: "starting", title: "Starting today", tasks: starting },
      ],
      journal: { path: journal, exists: this.files.stat(journal) !== null },
    };
  }

  /** Today's journal note (`Journal/YYYY-MM-DD.md`), made from the daily template if it's missing. */
  dailyNote(date: string, source: string) {
    if (!isDate(date)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${date}"`);
    const rel = `Journal/${date}.md`;
    if (this.files.stat(rel)) return { path: rel, created: false, change: null };
    const r = this.commit(rel, null, this.dailyTemplate(date), source, "create");
    return { path: rel, created: true, version: r.version, change: r.change };
  }

  /** A new daily note: `Templates/Daily note.md`, filled in as of `date` (see templates.ts), or a plain one with Tasks and Log. */
  private dailyTemplate(date: string): string {
    const template = this.files.read(DAILY_TEMPLATE);
    return template !== null ? fillTemplate(template, { at: `${date}T${localNow(this.now(), this.timeZone).split("T")[1]}`, title: date }).text : `# ${date}\n\n## Tasks\n\n## Log\n`;
  }

  // ---------------------------------------------------------------- templates

  /** The templates (notes in Templates/), by name, with how notes are made from each. */
  templates(): TemplateInfo[] {
    return this.list(TEMPLATES)
      .filter((n) => n.kind === "md")
      .map((n) => templateInfo(n.path, this.files.read(n.path) ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  /** The template a new note in `folder` starts from: the one whose applies_to names it (or a folder above it). */
  defaultTemplate(folder: string): TemplateInfo | null {
    const f = folder.replace(/^\/+|\/+$/g, "");
    return this.templates().find((t) => t.appliesTo.some((a) => f === a || f.startsWith(`${a}/`))) ?? null;
  }

  /** The template `target` names: a note in Templates/ (its name, or its path). */
  private templatePath(target: string): string {
    const rel = this.resolve(target) ?? this.resolve(`${TEMPLATES}/${target}`);
    if (!rel) throw new VaultError(`No template "${target}". Templates are notes in ${TEMPLATES}/.`, "not_found");
    if (kindOf(rel) !== "md" || !rel.startsWith(`${TEMPLATES}/`)) throw new VaultError(`${rel} isn't a template: templates are notes in ${TEMPLATES}/`);
    return rel;
  }

  /** A template's body filled in, to insert into a note: no frontmatter, and where its {{cursor}} is. */
  renderTemplate(target: string, opts: FillOptions = {}) {
    const rel = this.templatePath(target);
    const { body } = frontmatterEntries(this.files.read(rel) ?? "");
    return { path: rel, ...fillTemplate(body, { at: localNow(this.now(), this.timeZone), ...opts }) };
  }

  /**
   * A new note from a template: titled by `title`, else the template's title pattern, else its name;
   * in `folder`, else the template's folder, else the top level (a taken name gets " 2"…). Returns
   * where its {{cursor}} is and what's left unfilled, for whoever made it to fill in.
   */
  createFromTemplate(target: string, opts: FillOptions & { folder?: string } = {}, source: string) {
    const rel = this.templatePath(target);
    const md = this.files.read(rel) ?? "";
    const info = templateInfo(rel, md);
    const fill = { at: localNow(this.now(), this.timeZone), ...opts };
    const title = cleanTitle(opts.title ?? (info.title ? fillTemplate(info.title, fill).text : "")) || info.name;
    const folderText = opts.folder ?? (info.folder ? fillTemplate(info.folder, fill).text : "");
    const folder = folderText.split("/").map(cleanTitle).filter(Boolean).join("/");
    const dir = folder ? `${folder}/` : "";
    let path = cleanPath(`${dir}${title}.md`);
    for (let i = 2; this.files.stat(path) || this.list(folder || undefined, "all").some((n) => n.path.toLowerCase() === path.toLowerCase()); i++) path = cleanPath(`${dir}${title} ${i}.md`);
    const filled = fillTemplate(md, { ...fill, title });
    const r = this.commit(path, null, filled.text, source, "create");
    return { path, version: r.version, change: r.change, cursor: filled.cursor, unfilled: filled.unfilled };
  }

  /**
   * Move a task (and the lines nested under it) to another note: to the end of its Tasks section,
   * or of the note. The task keeps its text and tokens; it's cut from where it was.
   */
  moveTask(target: string, line: number, text: string, to: string, source: string) {
    const note = this.read(target);
    const dest = this.mustResolve(to);
    if (dest === note.path) throw new VaultError(`That task is already in ${dest}`);
    if (kindOf(dest) !== "md") throw new VaultError(`Tasks go in markdown notes, and ${dest} isn't one`);
    const lines = note.content.split("\n");
    const block = cutTask(lines, findTask(lines, line, text, note.path));
    const there = this.read(dest);
    const added = withTasksAdded(there.content, block, false);
    // Into the other note first: if that write fails, the task is still where it was.
    const r = this.commit(dest, there.content, added.content, source, "edit");
    let cut;
    try {
      cut = this.commit(note.path, note.content, lines.join("\n"), source, "edit");
    } catch (e) {
      this.commit(dest, added.content, there.content, source, "edit");
      throw e;
    }
    // The note it left, too, so a caller can tell whoever shows that note.
    return { ...r, cut, line: added.line, text: block[0].match(TASK_LINE)![4] };
  }

  /** Take a task (and the lines nested under it) out of its note: quick-add's Undo. */
  removeTask(target: string, line: number, text: string, source: string) {
    const note = this.read(target);
    const lines = note.content.split("\n");
    const i = findTask(lines, line, text, note.path);
    cutTask(lines, i);
    if (i > 0 && !lines[i - 1] && !lines[i]) lines.splice(i - 1, 1); // and the blank line adding it put before it
    return this.commit(note.path, note.content, lines.join("\n"), source, "edit");
  }

  /** Move a repeating task to its next date without ticking it ("Skip this one"). */
  skipTask(target: string, line: number, text: string, source: string, today = this.day()) {
    const task = parseTask(`- [ ] ${text}`);
    const patch = task && skipPatch(task.meta, today);
    if (!patch) throw new VaultError("That task doesn't repeat, so there's nothing to skip");
    return this.updateTask(target, line, text, patch, source, today);
  }

  /**
   * Where an uploaded file named `name` goes: `folder/name`, or "name 2.png" if that's taken.
   * Throws for names that aren't a file type we store.
   */
  uploadPath(name: string, folder = "assets"): string {
    const base = path.posix.basename(name.replace(/\\/g, "/")).replace(/[:*?"<>|#^[\]]/g, "").trim();
    const rel = cleanPath(folder ? `${folder}/${base}` : base);
    if (kindOf(rel) !== "asset") throw new VaultError(`Can't upload ${base || "that file"}: images, PDFs, audio, video and common documents only`);
    return this.freePath(rel);
  }

  /** The host just wrote a file's bytes to `rel`: index it and log who added it. */
  recordUpload(rel: string, existed: boolean, source: string) {
    const meta = this.indexFile(rel);
    if (!meta) throw new VaultError(`${rel} isn't there`, "not_found");
    const change = this.recordChange({ path: rel, op: existed ? "edit" : "create", source, version: meta.version, summary: fmtBytes(meta.size), from_path: null });
    return { ...meta, change };
  }

  /** Archive a note: move it into the archive folder (links keep working: they resolve by name). */
  archive(target: string, source: string) {
    const rel = this.mustResolve(target);
    if (isArchived(rel)) throw new VaultError(`${rel} is already archived`);
    return this.move(rel, this.freePath(this.archiveFolder() + rel), source, "archive");
  }

  unarchive(target: string, source: string) {
    const rel = this.mustResolve(target);
    if (!isArchived(rel)) throw new VaultError(`${rel} isn't archived`);
    return this.move(rel, this.freePath(homeOf(rel)), source, "unarchive");
  }

  /**
   * Where archiving puts notes: the workspace's own archive folder ("4. Archive/") when it has one,
   * so there's one archive rather than two, else Archive/. With several, the one holding most notes.
   */
  archiveFolder(): string {
    const roots = this.db.all<{ dir: string; n: number }>(
      `SELECT substr(path, 1, instr(path, '/')) AS dir, count(*) AS n FROM notes WHERE ${archivedSql("path")} GROUP BY dir`,
    );
    const own = roots.filter((r) => r.dir !== ARCHIVE).sort((a, b) => b.n - a.n || a.dir.localeCompare(b.dir));
    return own[0]?.dir ?? ARCHIVE;
  }

  // ---------------------------------------------------------------- trash

  /** The notes and assets under `folder` (active and archived alike, since a folder holds both). */
  private under(folder: string): string[] {
    const dir = cleanPath(folder);
    return this.db.all<{ path: string }>("SELECT path FROM notes WHERE substr(path, 1, ?) = ? ORDER BY path", dir.length + 1, `${dir}/`).map((r) => r.path);
  }

  /** What deleting these notes (or everything in `folder`) would touch. */
  deleteCheck(targets: string[], folder?: string): DeleteCheck {
    const rels = folder ? this.under(folder) : targets.map((t) => this.mustResolve(t));
    const set = new Set(rels);
    const from = new Set(rels.flatMap((r) => this.backlinks(r).map((b) => b.path)).filter((p) => !set.has(p)));
    const assets = rels.filter((r) => kindOf(r) === "asset").length;
    return { notes: rels.length - assets, assets, linkedFrom: [...from].sort() };
  }

  /** Send notes and assets to Trash. Their links show as missing until they come back. */
  delete(targets: string[], source: string) {
    const rels = [...new Set(targets.map((t) => this.mustResolve(t)))];
    this.purgeExpired();
    return rels.map((rel) => {
      const meta = this.meta(rel) ?? this.indexFile(rel);
      if (!meta) throw new VaultError(`No note matches "${rel}"`, "not_found");
      const tags = meta.kind === "asset" ? this.assetTags(true) : {};
      const text = meta.kind === "asset" ? null : (this.files.read(rel) ?? "");
      const summary = meta.kind === "asset" ? fmtBytes(meta.size) : diffstat(text!, "");
      const change = this.recordChange({ path: rel, op: "delete", source, version: null, summary, from_path: null }, text);
      const id = `${change.ts}-${change.id}`;
      this.files.rename(rel, `${TRASH}/${id}/${rel}`);
      if (tags[rel]) {
        this.files.write(`${TRASH}/${id}/${TRASH_TAGS}`, JSON.stringify(tags[rel]));
        delete tags[rel];
        this.writeAssetTags(tags);
      }
      this.unindex(rel);
      this.gone.delete(`${meta.kind}:${meta.version}`); // a new note with the same text mustn't take its ID
      return { id, path: rel, change };
    });
  }

  /**
   * Delete everything in a folder. `notes: "trash"` sends it all to Trash; "lift" moves it up to the
   * folder's parent instead (keeping any subfolders), under free names.
   */
  deleteFolder(folder: string, notes: "trash" | "lift", source: string) {
    const dir = cleanPath(folder);
    const rels = this.under(dir);
    if (notes === "trash") return { deleted: this.delete(rels, source), moved: [] };
    const parent = path.posix.dirname(dir);
    const moved = rels.map((rel) => {
      const rest = rel.slice(dir.length + 1);
      return this.move(rel, this.freePath(parent === "." ? rest : `${parent}/${rest}`), source);
    });
    return { deleted: [], moved };
  }

  /** The ids of what's in Trash, newest first. */
  private trashIds(): string[] {
    const ids = new Set(this.files.listUnder(TRASH).map((f) => f.path.split("/")[1]).filter((id) => TRASH_ID.test(id)));
    return [...ids].sort((a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0]));
  }

  /** The deleted file in Trash item `id`, and what's kept beside it. */
  private trashFile(id: string): { at: string; path: string; size: number } | null {
    if (!TRASH_ID.test(id)) return null;
    const prefix = `${TRASH}/${id}/`;
    const f = this.files.listUnder(`${TRASH}/${id}`).find((x) => !x.path.slice(prefix.length).startsWith("."));
    return f ? { at: f.path, path: f.path.slice(prefix.length), size: f.size } : null;
  }

  /** What's in Trash, newest first. Anything past its time is deleted for good first. */
  trash(): TrashItem[] {
    this.purgeExpired();
    return this.trashIds().flatMap((id) => {
      const f = this.trashFile(id);
      if (!f) return [];
      const [ms, changeId] = id.split("-").map(Number);
      const c = this.db.get("SELECT source, person, agent FROM changes WHERE id = ? AND op = 'delete'", changeId);
      const kind = kindOf(f.path) ?? "asset";
      const text = kind === "asset" ? "" : (this.files.read(f.at) ?? "");
      const noteId = this.db.get("SELECT note_id FROM changes WHERE id = ?", changeId)?.note_id;
      const labels = noteId ? (this.db.get("SELECT count(*) AS n FROM labels WHERE note_id = ?", noteId)?.n ?? 0) : 0;
      return [{ id, path: f.path, kind, size: f.size, deletedAt: ms, expiresAt: ms + TRASH_DAYS * 86_400_000, by: c ?? null, labels, excerpt: kind === "md" ? excerptOf(splitFrontmatter(text).body, titleOf(text, kind, f.path), 240) : "" }];
    });
  }

  /** Put Trash items back where they were, or under a free name if that's taken. */
  untrash(ids: string[], source: string) {
    return ids.map((id) => {
      const f = this.trashFile(id);
      if (!f) throw new VaultError("That's no longer in Trash", "not_found");
      const noteId = this.db.get("SELECT note_id FROM changes WHERE id = ?", Number(id.split("-")[1]))?.note_id;
      const dest = this.freePath(f.path);
      const tagsAt = `${TRASH}/${id}/${TRASH_TAGS}`;
      const kept = this.files.read(tagsAt);
      const tags = kept ? this.assetTags(true) : {};
      this.files.rename(f.at, dest);
      if (kept) {
        this.writeAssetTags({ ...tags, [dest]: JSON.parse(kept) });
        this.files.remove(tagsAt);
      }
      const free = noteId && !this.db.get("SELECT 1 FROM notes WHERE id = ?", noteId);
      const meta = this.indexFile(dest, undefined, free ? noteId : undefined)!;
      const change = this.recordChange({ path: dest, op: "restore", source, version: meta.version, summary: dest === f.path ? "from Trash" : `from Trash, was ${f.path}`, from_path: null });
      return { path: dest, version: meta.version, change };
    });
  }

  /**
   * Delete Trash items for good, their text in the change log with them. `source` logs who did it;
   * items that just ran out of time go without an entry.
   */
  purge(ids: string[], source: string | null) {
    return ids.flatMap((id) => {
      const f = this.trashFile(id);
      if (!f) return [];
      for (const x of this.files.listUnder(`${TRASH}/${id}`)) this.files.remove(x.path);
      const changeId = Number(id.split("-")[1]);
      const noteId = this.db.get("SELECT note_id FROM changes WHERE id = ?", changeId)?.note_id;
      if (noteId) {
        dropBefores(this.db, "note_id = ?", noteId);
        this.db.run("DELETE FROM labels WHERE note_id = ?", noteId); // its labels keep its text: they go too
      } else dropBefores(this.db, "id = ?", changeId);
      if (source) this.recordChange({ path: f.path, op: "purge", source, version: null, summary: "deleted forever", from_path: null });
      return [f.path];
    });
  }

  emptyTrash(source: string) {
    return this.purge(this.trashIds(), source);
  }

  private purgeExpired() {
    const cutoff = this.now() - TRASH_DAYS * 86_400_000;
    this.purge(this.trashIds().filter((id) => Number(id.split("-")[0]) < cutoff), null);
  }

  /** `rel`, or "name 2.md", "name 3.md"… if it's taken. */
  /** `rel`, or "name 2.md" (3, 4…) if that's taken. */
  freePath(rel: string): string {
    const ext = path.posix.extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    let out = rel;
    for (let i = 2; this.files.stat(out); i++) out = `${stem} ${i}${ext}`;
    return out;
  }

  /**
   * Where a move to `to` puts `from`: a folder, written with a trailing slash ("Projects/"), gets
   * the note under its own name, as `mv` does; anything else is the new path. ("Projects" stays a
   * note named Projects, which can sit beside a folder of that name.)
   */
  private intoFolder(to: string, from: string): string {
    return /\/\s*$/.test(to) ? `${cleanPath(to).replace(/\/+$/, "")}/${path.posix.basename(from)}` : to;
  }

  /** Rename a note and rewrite every [[link]] / ![[embed]] / [md](link) that pointed at it. */
  move(target: string, to: string, source: string, op: "move" | "archive" | "unarchive" = "move") {
    const from = this.mustResolve(target);
    let dest = cleanPath(this.intoFolder(to, from));
    if (!kindOf(dest)) dest += path.posix.extname(from);
    const [extFrom, extTo] = [from, dest].map((p) => path.posix.extname(p).toLowerCase());
    if (kindOf(dest) !== kindOf(from) || (kindOf(from) === "asset" && extFrom !== extTo)) {
      throw new VaultError(`Moving ${from} can't change its file type from ${extFrom} to ${extTo}`);
    }
    if (dest === from) return { path: dest, from, version: this.meta(from)?.version ?? "", change: null, updated: [] as string[], edits: [] };
    // On a case-insensitive disk, "notes.md" is there when renaming "Notes.md" to it: the same file.
    // On a case-sensitive one it can be another file, not yet indexed, that the rename would replace.
    const caseOnly = dest.toLowerCase() === from.toLowerCase() && this.files.same(from, dest);
    if (!caseOnly && this.files.stat(dest)) throw new VaultError(`${dest} already exists`, "exists");
    // Read before it moves: after, a name can lead to another note. Its own links to itself
    // ([[Guide#Setup]] in Guide) move with it.
    const pointing = this.linksTo(from, [from, ...this.backlinks(from).map((b) => b.path)]);

    const id = this.meta(from)?.id;
    const assetTags = kindOf(from) === "asset" ? this.assetTags(true) : {};
    this.files.rename(from, dest);
    this.unindex(from);
    const meta = this.indexFile(dest, undefined, id)!;
    const change = this.recordChange({ path: dest, op, source, version: meta.version, summary: `from ${from}`, from_path: from });
    if (assetTags[from]) {
      assetTags[dest] = assetTags[from];
      delete assetTags[from];
      this.writeAssetTags(assetTags);
    }

    const newStemUnique = this.db.get("SELECT count(*) AS n FROM notes WHERE stem = ?", stemOf(dest)).n === 1;
    const wikiTarget = newStemUnique ? path.posix.basename(dest).replace(/\.(md|markdown)$/i, "") : dest.replace(/\.(md|markdown)$/i, "");
    const { updated, edits } = this.relink(pointing, from, dest, wikiTarget, source);
    // Its own links to itself rewritten make a newer version of it.
    return { path: dest, from, version: edits.find((e) => e.path === dest)?.version ?? meta.version, change, updated, edits };
  }

  /** The link targets in each of `notes` that lead to `rel`, by note (those with none left out). */
  private linksTo(rel: string, notes: Iterable<string>): Map<string, Set<string>> {
    const resolve = this.resolver();
    const pointing = new Map<string, Set<string>>();
    for (const src of new Set(notes)) {
      const targets = extractLinks(this.files.read(src) ?? "").map((l) => l.target).filter((t) => resolve(t, src) === rel);
      if (targets.length) pointing.set(src, new Set(targets));
    }
    return pointing;
  }

  /**
   * Point the links in `pointing` (see linksTo) that went to `from`, now moved or gone, at `dest`:
   * `[[wikiTarget]]`, or its path in a markdown link. A note that was `from` is now `dest`.
   */
  private relink(pointing: Map<string, Set<string>>, from: string, dest: string, wikiTarget: string, source: string) {
    const updated: string[] = [];
    const edits: Array<{ path: string; content: string; version: string; change: Change }> = [];
    const resolve = this.resolver(); // rewriting links changes no note's path
    // Spaces and parentheses escaped too: a bare ")" would end the link.
    const href = encodeURI(dest).replace(/\(/g, "%28").replace(/\)/g, "%29");
    for (const [was, targets] of pointing) {
      const src = was === from ? dest : was;
      const before = this.files.read(src) ?? "";
      // A [[name]] that still finds the note stays as written; a markdown link gets the new path.
      const after = mapOutsideCode(before, (text) =>
        text
          .replace(/(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g, (m, bang, t, hash = "", alias = "") =>
            targets.has(t.trim()) && resolve(t, src) !== dest ? `${bang}[[${wikiTarget}${hash}${alias}]]` : m,
          )
          .replace(/(!?\[[^[\]\n]*\]\()([^()\s]+)((?:\s+"[^"\n]*")?\))/g, (m, pre, t, post) =>
            targets.has(safeDecode(t)) ? `${pre}${href}${t.includes("#") ? t.slice(t.indexOf("#")) : ""}${post}` : m,
          ),
      );
      if (after !== before) {
        const r = this.commit(src, before, after, source, "edit");
        if (src !== dest) updated.push(src);
        edits.push({ path: src, content: after, version: r.version, change: r.change });
      }
    }
    return { updated, edits };
  }

  // ---------------------------------------------------------------- decisions

  /**
   * Put a question to the person (decisions.ts): it waits on their Today page until they answer.
   * `recommended` is an option's index (0-based); `note` a note it's about.
   */
  askDecision(q: { question: string; options?: string[]; context?: string; recommended?: number; note?: string }, source: string): Decision {
    const question = q.question.trim();
    if (!question) throw new VaultError("Say what the question is");
    if (question.length > QUESTION_MAX) throw new VaultError(`Keep the question to ${QUESTION_MAX} characters; put the rest in context`);
    const options = (q.options ?? []).map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (options.length > OPTIONS_MAX) throw new VaultError(`Offer at most ${OPTIONS_MAX} options`);
    if (options.some((o) => o.length > OPTION_MAX)) throw new VaultError(`Keep each option to ${OPTION_MAX} characters; put the reasoning in context`);
    if (new Set(options.map((o) => o.toLowerCase())).size < options.length) throw new VaultError("Two options say the same thing");
    if (options.length === 1) throw new VaultError("Offer two or more options, or none for an answer in the person's own words");
    if (q.recommended !== undefined && !(Number.isInteger(q.recommended) && q.recommended >= 0 && q.recommended < options.length)) {
      throw new VaultError(options.length ? `recommended must be an option's number, from 1 to ${options.length}` : "There are no options to recommend");
    }
    const context = q.context?.trim() || null;
    if (context && context.length > CONTEXT_MAX) throw new VaultError(`Keep the context to ${CONTEXT_MAX} characters, or link a note`);
    const rel = q.note ? this.mustResolve(q.note) : null;
    if ((this.db.get("SELECT count(*) AS n FROM decisions WHERE status = 'open'")?.n ?? 0) >= OPEN_MAX) {
      throw new VaultError(`${OPEN_MAX} decisions are already waiting: wait for answers before asking more`);
    }
    const who = actorOf(source);
    const id = newNoteId();
    this.db.run(
      "INSERT INTO decisions(id, question, context, options, recommended, note_id, note, status, asked_at, asked_by, person, agent) VALUES (?,?,?,?,?,?,?,'open',?,?,?,?)",
      id, question, context, JSON.stringify(options), q.recommended ?? null, rel ? this.meta(rel)!.id : null, rel, this.now(), who.source, who.person, who.agent,
    );
    return this.decision(id);
  }

  /** Decisions, newest first: open ones (the default), settled ones, or all; or the ones named by ID. */
  decisions(opts: { status?: DecisionStatus | "settled" | "all"; ids?: string[]; limit?: number } = {}): Decision[] {
    const status = opts.status ?? "open";
    if (![...DECISION_STATUSES, "settled", "all"].includes(status)) throw new VaultError(`"status" must be open, answered, dismissed, withdrawn, settled or all, not "${status}"`);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.ids?.length) where.push(`id IN (${opts.ids.map(() => "?").join(",")})`), params.push(...opts.ids);
    else if (status === "settled") where.push("status != 'open'");
    else if (status !== "all") where.push("status = ?"), params.push(status);
    // Open ones in the order they were asked, the picker's order; settled ones newest first.
    const order = status === "open" && !opts.ids?.length ? "asked_at, rowid" : "coalesce(answered_at, asked_at) DESC, rowid DESC";
    const rows = this.db.all(`SELECT * FROM decisions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`, ...params, Math.min(opts.limit ?? 100, 500));
    return rows.map((r) => this.toDecision(r));
  }

  decision(id: string): Decision {
    const r = this.db.get("SELECT * FROM decisions WHERE id = ?", id.trim());
    if (!r) throw new VaultError(`No decision ${id}: list_decisions shows their IDs`, "not_found");
    return this.toDecision(r);
  }

  private toDecision(r: Record<string, unknown>): Decision {
    const noteId = r.note_id as string | null;
    return {
      id: r.id as string,
      question: r.question as string,
      context: (r.context as string | null) ?? null,
      options: JSON.parse(r.options as string) as string[],
      recommended: (r.recommended as number | null) ?? null,
      note: noteId ? (this.pathOf(noteId) ?? (r.note as string | null)) : null,
      status: r.status as DecisionStatus,
      asked_at: r.asked_at as number,
      asked_by: r.asked_by as string,
      agent: (r.agent as string | null) ?? null,
      answer: (r.answer as string | null) ?? null,
      choice: (r.choice as number | null) ?? null,
      comment: (r.comment as string | null) ?? null,
      answered_at: (r.answered_at as number | null) ?? null,
      answered_by: (r.answered_by as string | null) ?? null,
      journal: (r.journal as string | null) ?? null,
    };
  }

  /**
   * Answer an open decision: an option (`choice`, 0-based) or an answer in the person's own words
   * (`text`), or dismiss it (they won't decide). It's written into the daily note for `today` (made
   * if needed) under `## Decisions`, so the day's notes say what was decided.
   */
  answerDecision(id: string, a: { choice?: number; text?: string; comment?: string; dismiss?: boolean }, source: string, today = this.day()) {
    if (!isDate(today)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${today}"`);
    const d = this.decision(id);
    if (d.status !== "open") {
      throw new VaultError(d.status === "withdrawn" ? "That decision was withdrawn: no answer is needed" : `That decision was already ${d.status === "dismissed" ? "dismissed" : `answered: ${d.answer}`}`, "conflict");
    }
    let answer: string | null = null;
    let choice: number | null = null;
    if (!a.dismiss) {
      if (a.choice !== undefined) {
        if (!(Number.isInteger(a.choice) && a.choice >= 0 && a.choice < d.options.length)) throw new VaultError(`Pick an option from 1 to ${d.options.length}`);
        [choice, answer] = [a.choice, d.options[a.choice]];
      } else {
        answer = a.text?.trim() || null;
        if (!answer) throw new VaultError("Pick an option, or say the answer in your own words");
        if (answer.length > COMMENT_MAX) throw new VaultError(`Keep the answer to ${COMMENT_MAX} characters`);
      }
    }
    const comment = a.comment?.trim() || null;
    if (comment && comment.length > COMMENT_MAX) throw new VaultError(`Keep the comment to ${COMMENT_MAX} characters`);
    const rel = `Journal/${today}.md`;
    const who = actorOf(source);
    const settled: Decision = { ...d, status: a.dismiss ? "dismissed" : "answered", answer, choice, comment, answered_at: this.now(), answered_by: who.source, journal: rel };
    const before = this.files.read(rel);
    const linkTo = (p: string) => `[[${this.linkName(p)}]]`;
    const added = withTasksAdded(before ?? this.dailyTemplate(today), journalLines(settled, linkTo), true, DECISIONS);
    const r = this.commit(rel, before, added.content, source, before === null ? "create" : "edit");
    this.db.run(
      "UPDATE decisions SET status = ?, answer = ?, choice = ?, comment = ?, answered_at = ?, answered_by = ?, journal = ? WHERE id = ? AND status = 'open'",
      settled.status, answer, choice, comment, settled.answered_at, settled.answered_by, rel, d.id,
    );
    return { decision: this.decision(d.id), ...r, line: added.line };
  }

  /** Take back an open question (it no longer matters). Nothing is written to the daily note. */
  withdrawDecision(id: string): Decision {
    const d = this.decision(id);
    if (d.status !== "open") throw new VaultError(`That decision is already ${d.status}${d.answer ? `: ${d.answer}` : ""}`, "conflict");
    this.db.run("UPDATE decisions SET status = 'withdrawn' WHERE id = ? AND status = 'open'", d.id);
    return this.decision(d.id);
  }

  /** How [[…]] names a note: its name alone when no other note shares it, its path otherwise. */
  private linkName(rel: string): string {
    const same = this.db.get("SELECT count(*) AS n FROM notes WHERE stem = ?", stemOf(rel))?.n ?? 0;
    return (same > 1 ? rel : path.posix.basename(rel)).replace(/\.md$/, "");
  }

  // ---------------------------------------------------------------- contacts

  /** Every contact (a note in People/, not archived), by name, with how often and when last other notes mention them. */
  contacts(today = this.day()): Contact[] {
    return this.list(PEOPLE)
      .filter((n) => n.kind === "md")
      .map((n) => this.contactOf(n.path, n.id, this.mentionsOf(n.path), today))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  /** One contact and its timeline: the notes that mention them, newest first. */
  contact(target: string, today = this.day()): { contact: Contact; timeline: TimelineItem[] } {
    const rel = this.contactPath(target);
    const timeline = this.mentionsOf(rel);
    return { contact: this.contactOf(rel, this.meta(rel)!.id, timeline, today), timeline };
  }

  private contactOf(rel: string, id: string, mentions: TimelineItem[], today: string): Contact {
    if (!isDate(today)) throw new VaultError(`"today" must be a date like 2026-10-01, not "${today}"`);
    const c = contactFromNote(rel, this.files.read(rel) ?? "");
    const lastContacted = mentions[0]?.date ?? null;
    return { ...c, id, mentions: mentions.length, lastContacted, checkInDue: checkInDue(c, lastContacted, today) };
  }

  /** The note `target` names, if it's a contact (a note in People/). */
  private contactPath(target: string): string {
    const rel = this.mustResolve(target);
    if (kindOf(rel) !== "md" || !rel.startsWith(`${PEOPLE}/`)) throw new VaultError(`${rel} isn't a contact: contacts are notes in ${PEOPLE}/`);
    return rel;
  }

  /** The notes that link to `rel`, one entry each (the first line that does), newest first. */
  private mentionsOf(rel: string): TimelineItem[] {
    const seen = new Set<string>();
    const out: TimelineItem[] = [];
    for (const b of this.backlinks(rel)) {
      if (seen.has(b.path)) continue;
      seen.add(b.path);
      const date = dayOfNote(b.path, this.files.read(b.path) ?? "") ?? localDate(this.meta(b.path)?.mtime ?? this.now(), this.timeZone);
      out.push({ kind: "note", path: b.path, title: b.title, date, line: b.line, text: b.text });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
  }

  /** A new contact: `People/<name>.md`, its fields in the frontmatter and `notes` under its title. */
  createContact(input: Partial<ContactFields> & { name: string; notes?: string }, source: string) {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) throw new VaultError("A contact needs a name");
    if (/[/\\\x00-\x1f]/.test(name) || name.startsWith(".")) throw new VaultError(`A contact's name can't have / or \\ in it, or start with a dot: "${name}"`);
    const rel = cleanPath(`${PEOPLE}/${name}.md`);
    const taken = this.list(PEOPLE, "all").find((n) => n.path.toLowerCase() === rel.toLowerCase()) ?? (this.files.stat(rel) ? { path: rel } : null);
    if (taken) throw new VaultError(`${taken.path} already exists`, "exists", { path: taken.path });
    checkRhythm(input.checkIn);
    const fields = { ...emptyContact(name), ...input, name };
    const notes = input.notes?.trim();
    return this.commit(rel, null, contactNote(fields) + (notes ? `\n${notes}\n` : ""), source, "create");
  }

  /** Change a contact's fields (any of them but its name, which is its note's). Its words and other frontmatter stay. */
  updateContact(target: string, patch: Partial<Omit<ContactFields, "name">>, source: string) {
    const rel = this.contactPath(target);
    checkRhythm(patch.checkIn);
    const before = this.files.read(rel) ?? "";
    const after = contactNote({ ...contactFromNote(rel, before), ...patch }, before);
    return after === before ? { ...this.meta(rel)!, change: null } : this.commit(rel, before, after, source, "edit");
  }

  /**
   * Make two contacts one: `keep` gains what `drop` knows that it doesn't (see fillContact) and
   * `drop`'s notes under "## From <name>"; links to `drop` then point at `keep`, and `drop` goes to Trash.
   */
  mergeContacts(keepTarget: string, dropTarget: string, source: string) {
    const keep = this.contactPath(keepTarget);
    const drop = this.contactPath(dropTarget);
    if (keep === drop) throw new VaultError("Can't merge a contact with itself");
    const [keepText, dropText] = [keep, drop].map((p) => this.files.read(p) ?? "");
    const fields = fillContact(contactFromNote(keep, keepText), contactFromNote(drop, dropText));
    const dropName = contactFromNote(drop, dropText).name;
    const words = splitFrontmatter(dropText).body.replace(/^\s*#[ \t]+.*\n?/, "").trim();
    let merged = contactNote(fields, keepText);
    if (words) merged = `${merged.replace(/\n*$/, "\n")}\n## From ${dropName}\n\n${words}\n`;
    const pointing = this.linksTo(drop, this.backlinks(drop).map((b) => b.path).filter((p) => p !== keep));
    const r = this.commit(keep, keepText, merged, source, "edit");
    const trashed = this.delete([drop], source);
    const relinked = this.relink(pointing, drop, keep, keep.replace(/\.(md|markdown)$/i, ""), source);
    return { path: keep, version: r.version, change: r.change, content: merged, trashed, ...relinked };
  }

  /**
   * Contacts from a vCard or CSV export. Each person already here (an email or a name in common)
   * gains what the import knows that they didn't; everyone else becomes a new contact. Several rows
   * for one person count once.
   */
  importContacts(text: string, format: "vcard" | "csv", source: string) {
    let inputs: ContactInput[];
    try {
      inputs = format === "vcard" ? parseVCards(text) : parseContactsCsv(text);
    } catch (e) {
      throw new VaultError(e instanceof Error ? e.message : String(e));
    }
    const known: ContactNote[] = this.contacts();
    const created: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
    for (const input of inputs) {
      const match = known.find((c) => samePerson(c, input));
      if (!match) {
        const r = this.createContact(input, source);
        known.push(contactFromNote(r.path, this.files.read(r.path) ?? ""));
        created.push(r.path);
        continue;
      }
      const filled = fillContact(match, input);
      if (sameFields(filled, match)) {
        if (![...created, ...updated, ...unchanged].includes(match.path)) unchanged.push(match.path);
        continue;
      }
      this.updateContact(match.path, filled, source);
      Object.assign(match, filled);
      if (!created.includes(match.path) && !updated.includes(match.path)) updated.push(match.path);
      const at = unchanged.indexOf(match.path);
      if (at >= 0) unchanged.splice(at, 1);
    }
    return { created, updated, unchanged };
  }
}

/**
 * Insert `rows` (all the same width) in as few statements as a Durable Object allows: at most 100
 * bound parameters each. A 1 MB note has thousands of links, tags and tasks, and online every
 * statement is a call out of JavaScript.
 */
function insertRows(db: SqlDb, insert: string, rows: unknown[][]) {
  if (!rows.length) return;
  const per = Math.floor(100 / rows[0].length);
  const tuple = `(${Array(rows[0].length).fill("?").join(",")})`;
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    db.run(`${insert} VALUES ${Array(chunk.length).fill(tuple).join(",")}`, ...chunk.flat());
  }
}

/**
 * The name a link's key ends in, which is what the links table keeps: "../plan" and "projects/plan"
 * both reach a note named Plan, and which one they reach is resolve()'s to say.
 */
const linkStem = (key: string) => key.slice(key.lastIndexOf("/") + 1);

/** `tags.tag` is the tag or under it: a range, so it uses the index and needs no character counting. */
const UNDER = "(tag = ? OR (tag >= ? AND tag < ?))";
const under = (key: string) => [key, `${key}/`, `${key}0`]; // "0" sorts right after "/"

/** "a/b/c" → ["a", "a/b", "a/b/c"]. */
const withParents = (tag: string) => tag.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** Tags tidied and each kept once (the first way it's written). `strict` throws on one that isn't a tag; otherwise it's dropped. */
function uniqueTags(tags: string[], strict: boolean): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = cleanTag(raw);
    if (!t && strict) throw new VaultError(`"${raw}" isn't a tag: use letters, numbers, - and _, nested with /`);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * The card `ref` names on a note's boards: its line number (as read_board shows it), else its
 * whole text, else words from its text that only one card has (any case).
 */
function findCard(boards: Board[], ref: string, path: string) {
  const all = boards.flatMap((b, board) => b.columns.flatMap((c, column) => c.cards.map((card) => ({ card, board, column }))));
  const want = ref.trim().toLowerCase();
  const line = want.match(/^l?(\d+)$/)?.[1];
  const exact = all.filter((x) => (line ? x.card.from + 1 === Number(line) : x.card.text.toLowerCase() === want));
  const hits = exact.length ? exact : line ? [] : all.filter((x) => x.card.text.toLowerCase().includes(want));
  if (hits.length === 1) return hits[0];
  if (hits.length) throw new VaultError(`"${ref}" matches ${hits.length} cards in ${path}; name the card by its line number from read_board`);
  throw new VaultError(`No card in ${path} matches "${ref}"`, "not_found");
}

/** The column `ref` names (its title, any case, or its number from 1) on `board` (from 1), or on whichever board has it. */
function findColumn(boards: Board[], ref: string, path: string, board?: number): Place {
  if (!boards.length) throw new VaultError(`${path} has no board. Add one as a :::kanban block.`, "not_found");
  if (board !== undefined && !boards[board - 1]) throw new VaultError(`${path} has ${boards.length} board${boards.length === 1 ? "" : "s"}, not ${board}`, "not_found");
  const want = ref.trim().toLowerCase();
  const hits = boards.flatMap((b, i) =>
    board !== undefined && i !== board - 1 ? [] : b.columns.flatMap((c, column) => (c.title.toLowerCase() === want || String(column + 1) === want ? [{ board: i, column }] : [])),
  );
  if (hits.length === 1) return hits[0];
  if (hits.length) throw new VaultError(`${hits.length} boards in ${path} have a column "${ref}"; say which board (from 1)`);
  const names = boards.flatMap((b) => b.columns.map((c) => c.title)).join(", ");
  throw new VaultError(`No column "${ref}" on the board${boards.length === 1 ? "" : "s"} in ${path}. Columns: ${names}`, "not_found");
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
  const { add, del } = lineStat(before, after);
  return `+${add} −${del}`;
}

/** The lines added and removed from `before` to `after`. */
export function lineStat(before: string, after: string): LineStat {
  let add = 0;
  let del = 0;
  // A full line diff is quadratic when everything changed (10k lines took 9 s), so it gives up
  // past this many edits and the count comes from which lines appear how often instead.
  const parts = diffLines(before, after, { maxEditLength: 2000 });
  if (!parts) return lineCountStat(before, after);
  for (const part of parts) {
    if (part.added) add += part.count ?? 0;
    else if (part.removed) del += part.count ?? 0;
  }
  return { add, del };
}

/** Lines added and removed as multisets: exact for rewrites, an estimate for moves. Linear. */
function lineCountStat(before: string, after: string): LineStat {
  const count = new Map<string, number>();
  for (const l of before.split("\n")) count.set(l, (count.get(l) ?? 0) + 1);
  let add = 0;
  for (const l of after.split("\n")) {
    const n = count.get(l) ?? 0;
    if (n) count.set(l, n - 1);
    else add++;
  }
  let del = 0;
  for (const n of count.values()) del += n;
  return { add, del };
}

/** A label's name, checked: one line, 1 to LABEL_NAME_MAX characters. */
function labelName(name: string): string {
  const named = name.replace(/\s+/g, " ").trim();
  if (!named) throw new VaultError("A label needs a name, like \"v1\" or \"Sent to Alex\"");
  if (named.length > LABEL_NAME_MAX) throw new VaultError(`A label's name is at most ${LABEL_NAME_MAX} characters`);
  return named;
}

function toLabel({ now, ...m }: Label & { now: string | null }): Label {
  return { ...m, current: now === m.version };
}
