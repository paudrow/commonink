// Calendars: sources of outside items (ICS feeds now; Google and others plug in as more kinds) and
// the items they bring in, kept in the workspace's own SQLite next to its notes. Events are linked
// records, not notes: a meeting note is made from one on request and linked to it. A source is the
// whole workspace's (owner null) or one person's, and a person only ever sees their own and the
// workspace's. Syncing is async (it fetches), so it runs outside the note core: on a timer or alarm
// the host sets, and when someone asks. No Node imports: the Worker runs this too.
import { looksLikeIcs, readIcs, type Occurrence, type Person } from "./ics.ts";
import { QuireError } from "./paths.ts";
import type { Quire } from "./quire.ts";
import type { SqlDb } from "./store.ts";
import { fetchGuarded, readCapped, type UrlGuard } from "./unfurl.ts";

export type SourceKind = "ics";
export type SyncStatus = "pending" | "ok" | "error";

/** Colors a source can have; the app maps each to a theme color. */
export const SOURCE_COLORS = ["blue", "green", "orange", "purple", "red", "teal", "pink", "brown"] as const;
export type SourceColor = (typeof SOURCE_COLORS)[number];

/** A source as the app and agents see it. */
export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  color: SourceColor;
  /** Null: everyone in the workspace sees it. A user ID: only that person does. */
  owner: string | null;
  /** The feed's address, for those who may change the source (it can carry a secret); null for everyone else. */
  url: string | null;
  /** Where the feed comes from, for everyone. */
  host: string | null;
  /** Whether the viewer may rename, recolor or remove it. */
  editable: boolean;
  status: SyncStatus;
  error: string | null;
  syncedAt: number | null;
  events: number;
  createdBy: string;
  createdAt: number;
}

export interface CalendarEvent {
  /** Stable across syncs: the same instance of the same event keeps its ID. */
  id: string;
  source: string;
  title: string;
  /** "2026-09-29T16:00:00Z", or "2026-09-29" all day, or "2026-09-29T09:00:00" in whatever zone the reader is in. */
  start: string;
  /** Exclusive, like start. */
  end: string;
  allDay: boolean;
  timeZone: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  organizer: Person | null;
  attendees: Person[];
  status: "confirmed" | "tentative";
  recurring: boolean;
  /** The meeting note made from it, if it still exists. */
  note: { id: string; path: string; title: string } | null;
}

/** What a fetch of a feed found. `unchanged`: the server said it's the same as last time (304). */
export type FeedResult = { status: "ok"; text: string; etag: string | null; modified: string | null } | { status: "unchanged" };
/** How a host fetches a feed, with its own rules for which addresses are allowed. */
export type FeedFetcher = (url: string, last: { etag: string | null; modified: string | null }) => Promise<FeedResult>;

export const MAX_SOURCES = 25;
export const FEED_BYTES = 10 * 1024 * 1024;
const FEED_TIMEOUT = 15_000;
/** How often a feed is read again, and at most how long a failing one waits. */
export const SYNC_EVERY = 30 * 60_000;
const MAX_BACKOFF = 12 * 3600_000;
/** A manual refresh within this long of the last sync reads nothing new. */
const REFRESH_GAP = 60_000;
const DAY = 86_400_000;
/** Occurrences kept: a year back, two ahead. The window moves as the feed is read again. */
const WINDOW = { back: 365 * DAY, ahead: 730 * DAY };
const PER_EVENT = 1000;
const PER_SOURCE = 20_000;
/** The most an all-day or floating time can be from UTC; such events are matched this loosely by time. */
const ZONE_SLOP = 14 * 3600_000;

const SCHEMA = [
  // `config` is the kind's own settings (an ICS feed's URL); `state` its sync cursor (ETag, a hash).
  `CREATE TABLE IF NOT EXISTS sources(
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT, name TEXT NOT NULL, color TEXT NOT NULL,
     config TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, error TEXT,
     synced_at INTEGER, next_sync INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0,
     created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // What sources bring in. `kind` is "event" today (issues, contacts later). Times are kept as
  // written (see CalendarEvent) and as milliseconds to query by; `abs` is 0 for all-day and floating
  // times, which have no one instant. `hash` lets a sync skip rows that didn't change.
  `CREATE TABLE IF NOT EXISTS external_items(
     id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
     start TEXT NOT NULL, end TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
     abs INTEGER NOT NULL, data TEXT NOT NULL, hash TEXT NOT NULL, note_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS external_items_time ON external_items(kind, start_ms)`,
  `CREATE INDEX IF NOT EXISTS external_items_source ON external_items(source)`,
];

interface SourceRow {
  id: string;
  kind: SourceKind;
  owner: string | null;
  name: string;
  color: SourceColor;
  config: string;
  state: string;
  status: SyncStatus;
  error: string | null;
  synced_at: number | null;
  next_sync: number;
  fails: number;
  created_by: string;
  created_at: number;
}

interface ItemRow {
  id: string;
  source: string;
  title: string;
  start: string;
  end: string;
  data: string;
  note_id: string | null;
  note_path: string | null;
  note_title: string | null;
}

/** Who's asking: they see the workspace's sources and their own; `canEdit` also shows feed addresses. */
export interface Viewer {
  user: string;
  canEdit: boolean;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const randomId = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join("");

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** An event instance's ID: the same source, event and instance always give the same one. */
async function itemId(source: string, uid: string, instance: string | null): Promise<string> {
  const h = await sha256(`${source}\n${uid}\n${instance ?? ""}`);
  return [...h.subarray(0, 12)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const EVENT_ID = /^[a-z2-9]{12}$/;

/** Milliseconds for an event time as written: all-day and floating read as if in UTC. */
function msOf(t: string): number {
  if (t.length === 10) return Date.parse(`${t}T00:00:00Z`);
  return Date.parse(t.endsWith("Z") ? t : `${t}Z`);
}

/** A feed address as it's stored: webcal is https; only http(s), no credentials, a sane length. */
export function feedUrl(raw: string): string {
  const s = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new QuireError("That isn't a web address. Paste the calendar's ICS or webcal link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new QuireError("Calendar feeds are http, https or webcal addresses");
  if (u.username || u.password) throw new QuireError("Leave the name and password out of the address");
  if (s.length > 2048) throw new QuireError("That address is too long");
  return u.href;
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`);

/** What went wrong reading a feed, in words for the person who added it. */
function feedProblem(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === "private" || m === "port" || m === "self") return "That address isn't on the public internet";
  if (m === "too many redirects") return "That address redirects too many times";
  if (m.startsWith("feed:")) return m.slice(5);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "The feed took too long to answer";
  return "Couldn't reach that address";
}

/**
 * Fetch an ICS feed under the same rules as link previews: `guard` vets every hop (public hosts
 * only), redirects are capped, and the whole read has a deadline and a size cap.
 */
export async function fetchFeed(url: string, last: { etag: string | null; modified: string | null }, guard: UrlGuard | undefined, opts: { timeout?: number; maxBytes?: number } = {}): Promise<FeedResult> {
  const max = opts.maxBytes ?? FEED_BYTES;
  const headers: Record<string, string> = { "User-Agent": "CommonInk-Calendar/1.0", Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" };
  if (last.etag) headers["If-None-Match"] = last.etag;
  if (last.modified) headers["If-Modified-Since"] = last.modified;
  const { res } = await fetchGuarded(url, guard, { signal: AbortSignal.timeout(opts.timeout ?? FEED_TIMEOUT), headers });
  if (res.status === 304) {
    await res.body?.cancel();
    return { status: "unchanged" };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`feed:The feed answered ${res.status}${res.status === 404 ? " (not found)" : res.status === 401 || res.status === 403 ? " (it isn't public)" : ""}`);
  }
  if (Number(res.headers.get("content-length") ?? 0) > max) {
    await res.body?.cancel();
    throw new Error(`feed:That feed is over ${size(max)}`);
  }
  const text = await readCapped(res, max + 1);
  if (text.length > max) throw new Error(`feed:That feed is over ${size(max)}`);
  if (!looksLikeIcs(text)) throw new Error("feed:That address isn't a calendar feed (no BEGIN:VCALENDAR)");
  return { status: "ok", text, etag: res.headers.get("etag"), modified: res.headers.get("last-modified") };
}

export class Calendar {
  private now: () => number;
  private running = new Map<string, Promise<void>>();

  constructor(
    private db: SqlDb,
    private fetcher: FeedFetcher,
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    for (const stmt of SCHEMA) db.exec(stmt);
  }

  // ---------------------------------------------------------------- sources

  private visible(viewer: { user: string }): SourceRow[] {
    return this.db.all<SourceRow>("SELECT * FROM sources WHERE owner IS NULL OR owner = ? ORDER BY created_at, id", viewer.user);
  }

  private row(id: string, viewer: { user: string }): SourceRow {
    const r = this.db.get<SourceRow>("SELECT * FROM sources WHERE id = ? AND (owner IS NULL OR owner = ?)", id, viewer.user);
    if (!r) throw new QuireError("That calendar doesn't exist, or it isn't yours", "not_found");
    return r;
  }

  private present(r: SourceRow, viewer: Viewer): Source {
    const config = JSON.parse(r.config) as { url?: string };
    const mayEdit = r.owner === null ? viewer.canEdit : r.owner === viewer.user;
    let host: string | null = null;
    try {
      host = config.url ? new URL(config.url).hostname : null;
    } catch {}
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      color: r.color,
      owner: r.owner,
      url: mayEdit ? (config.url ?? null) : null,
      host,
      editable: mayEdit,
      status: r.status,
      error: r.error,
      syncedAt: r.synced_at,
      events: this.db.get<{ n: number }>("SELECT count(*) AS n FROM external_items WHERE source = ?", r.id)!.n,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }

  sources(viewer: Viewer): Source[] {
    return this.visible(viewer).map((r) => this.present(r, viewer));
  }

  source(id: string, viewer: Viewer): Source {
    return this.present(this.row(id, viewer), viewer);
  }

  /** Subscribe the workspace to an ICS feed, and read it once. */
  async addIcs(input: { url: string; name?: string; color?: string }, viewer: Viewer, by: string): Promise<Source> {
    const url = feedUrl(input.url);
    const all = this.db.all<SourceRow>("SELECT * FROM sources");
    if (all.length >= MAX_SOURCES) throw new QuireError(`A workspace can have ${MAX_SOURCES} calendars; remove one first`);
    const same = all.find((s) => s.kind === "ics" && (JSON.parse(s.config) as { url?: string }).url === url);
    if (same) throw new QuireError(`That feed is already here, as "${same.name}"`, "exists", { id: same.id });
    const color = this.pickColor(input.color, all);
    const id = randomId(10);
    const name = cleanName(input.name) ?? new URL(url).hostname;
    this.db.run(
      "INSERT INTO sources(id, kind, owner, name, color, config, status, next_sync, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id, "ics", null, name, color, JSON.stringify({ url }), "pending", this.now(), by, this.now(),
    );
    await this.sync(id, { named: !cleanName(input.name) });
    // A feed that can't be read on the first try isn't kept: the person sees why, and can fix the address.
    const first = this.db.get<SourceRow>("SELECT * FROM sources WHERE id = ?", id);
    if (first?.status === "error") {
      this.db.tx(() => {
        this.db.run("DELETE FROM external_items WHERE source = ?", id);
        this.db.run("DELETE FROM sources WHERE id = ?", id);
      });
      throw new QuireError(first.error ?? "Couldn't read that feed");
    }
    return this.source(id, viewer);
  }

  private pickColor(asked: string | undefined, all: SourceRow[]): SourceColor {
    if (asked !== undefined) {
      if (!(SOURCE_COLORS as readonly string[]).includes(asked)) throw new QuireError(`"color" must be one of ${SOURCE_COLORS.join(", ")}`);
      return asked as SourceColor;
    }
    const used = new Set(all.map((s) => s.color));
    return SOURCE_COLORS.find((c) => !used.has(c)) ?? SOURCE_COLORS[all.length % SOURCE_COLORS.length];
  }

  /** Rename or recolor a source. */
  update(id: string, patch: { name?: string; color?: string }, viewer: Viewer): Source {
    const r = this.row(id, viewer);
    this.mayChange(r, viewer);
    const name = patch.name === undefined ? r.name : cleanName(patch.name);
    if (!name) throw new QuireError("Give the calendar a name");
    const color = patch.color === undefined ? r.color : this.pickColor(patch.color, []);
    this.db.run("UPDATE sources SET name = ?, color = ? WHERE id = ?", name, color, id);
    return this.source(id, viewer);
  }

  /** Unsubscribe: the source and everything it brought in go. Meeting notes stay. */
  remove(id: string, viewer: Viewer) {
    const r = this.row(id, viewer);
    this.mayChange(r, viewer);
    this.db.tx(() => {
      this.db.run("DELETE FROM external_items WHERE source = ?", id);
      this.db.run("DELETE FROM sources WHERE id = ?", id);
    });
  }

  private mayChange(r: SourceRow, viewer: Viewer) {
    if (r.owner === null ? !viewer.canEdit : r.owner !== viewer.user) throw new QuireError("You can't change that calendar", "forbidden");
  }

  // ---------------------------------------------------------------- syncing

  /** Read sources again now: one, or every one the viewer sees. A source read in the last minute is left as it is. */
  async refresh(viewer: Viewer, id?: string): Promise<Source[]> {
    const rows = id ? [this.row(id, viewer)] : this.visible(viewer);
    const now = this.now();
    await Promise.all(rows.filter((r) => r.status !== "ok" || !r.synced_at || now - r.synced_at >= REFRESH_GAP).map((r) => this.sync(r.id)));
    return rows.map((r) => this.source(r.id, viewer));
  }

  /** Read every source that's due. Returns how many were read. */
  async syncDue(): Promise<number> {
    const due = this.db.all<{ id: string }>("SELECT id FROM sources WHERE next_sync <= ?", this.now());
    await Promise.all(due.map((r) => this.sync(r.id)));
    return due.length;
  }

  /** When the next source is due, or null with none to read. */
  nextSync(): number | null {
    return this.db.get<{ t: number | null }>("SELECT min(next_sync) AS t FROM sources")?.t ?? null;
  }

  /** Read one source. At most one read of a source runs at once; a second caller waits for the first. */
  private sync(id: string, opts: { named?: boolean } = {}): Promise<void> {
    let run = this.running.get(id);
    if (!run) {
      run = this.read(id, opts).finally(() => this.running.delete(id));
      this.running.set(id, run);
    }
    return run;
  }

  private async read(id: string, opts: { named?: boolean }) {
    const r = this.db.get<SourceRow>("SELECT * FROM sources WHERE id = ?", id);
    if (!r) return;
    const { url } = JSON.parse(r.config) as { url: string };
    const state = JSON.parse(r.state) as { etag?: string | null; modified?: string | null; hash?: string };
    const now = this.now();
    try {
      // The window moves every day, so on a new day the feed is read and expanded again even if unchanged.
      const day = new Date(now).toISOString().slice(0, 10);
      const today = state.hash?.startsWith(`${day}:`);
      const got = await this.fetcher(url, today ? { etag: state.etag ?? null, modified: state.modified ?? null } : { etag: null, modified: null });
      const hash = got.status === "ok" ? `${day}:${hex(await sha256(got.text))}` : state.hash;
      if (got.status === "ok" && hash !== state.hash) {
        const { feed, events } = readIcs(got.text, { from: new Date(now - WINDOW.back), to: new Date(now + WINDOW.ahead) }, { perEvent: PER_EVENT, total: PER_SOURCE });
        await this.store(id, events);
        if (opts.named && feed.name) this.db.run("UPDATE sources SET name = ? WHERE id = ?", cleanName(feed.name) ?? r.name, id);
      }
      const next = got.status === "ok" ? { etag: got.etag, modified: got.modified, hash } : state;
      if (!this.db.get("SELECT 1 FROM sources WHERE id = ?", id)) return; // removed while it was being read
      this.db.run("UPDATE sources SET status = 'ok', error = NULL, synced_at = ?, next_sync = ?, fails = 0, state = ? WHERE id = ?", now, now + SYNC_EVERY, JSON.stringify(next), id);
    } catch (e) {
      const fails = r.fails + 1;
      this.db.run(
        "UPDATE sources SET status = 'error', error = ?, next_sync = ?, fails = ? WHERE id = ?",
        feedProblem(e), now + Math.min(SYNC_EVERY * 2 ** (fails - 1), MAX_BACKOFF), fails, id,
      );
    }
  }

  /** Put a source's items in place of what it had: changed rows are written, gone ones deleted, links to notes kept. */
  private async store(source: string, events: Occurrence[]) {
    const rows = await Promise.all(
      events.map(async (o) => {
        const data = JSON.stringify({
          allDay: o.allDay, timeZone: o.timeZone, location: o.location, description: o.description, url: o.url,
          organizer: o.organizer, attendees: o.attendees, status: o.status, recurring: o.recurring,
        });
        return { id: await itemId(source, o.uid, o.recurrenceId), o, data, hash: hex(await sha256(`${o.title}\n${o.start}\n${o.end}\n${data}`)) };
      }),
    );
    const seen = new Map(rows.map((r) => [r.id, r])); // an instance listed twice counts once
    this.db.tx(() => {
      if (!this.db.get("SELECT 1 FROM sources WHERE id = ?", source)) return;
      const had = new Set(this.db.all<{ id: string }>("SELECT id FROM external_items WHERE source = ?", source).map((r) => r.id));
      for (const { id, o, data, hash } of seen.values()) {
        had.delete(id);
        this.db.run(
          `INSERT INTO external_items(id, source, kind, title, start, end, start_ms, end_ms, abs, data, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, start = excluded.start, end = excluded.end, start_ms = excluded.start_ms,
             end_ms = excluded.end_ms, abs = excluded.abs, data = excluded.data, hash = excluded.hash
           WHERE external_items.hash != excluded.hash`,
          id, source, "event", o.title, o.start, o.end, msOf(o.start), msOf(o.end), o.start.endsWith("Z") ? 1 : 0, data, hash,
        );
      }
      for (const id of had) this.db.run("DELETE FROM external_items WHERE id = ?", id);
    });
  }

  // ---------------------------------------------------------------- events

  private static SELECT = `SELECT i.id, i.source, i.title, i.start, i.end, i.data, i.note_id, n.path AS note_path, n.title AS note_title
    FROM external_items i JOIN sources s ON s.id = i.source LEFT JOIN notes n ON n.id = i.note_id`;

  private event_(r: ItemRow): CalendarEvent {
    const d = JSON.parse(r.data) as Omit<CalendarEvent, "id" | "source" | "title" | "start" | "end" | "note">;
    return {
      id: r.id,
      source: r.source,
      title: r.title,
      start: r.start,
      end: r.end,
      allDay: d.allDay,
      timeZone: d.timeZone,
      location: d.location,
      description: d.description,
      url: d.url,
      organizer: d.organizer,
      attendees: d.attendees,
      status: d.status,
      recurring: d.recurring,
      note: r.note_id && r.note_path ? { id: r.note_id, path: r.note_path, title: r.note_title ?? r.note_path } : null,
    };
  }

  /**
   * Events that overlap [from, to) (milliseconds), soonest first. All-day and floating events are
   * placed in the reader's `zone`; without one, they're matched within a day's slack either side.
   * `q` narrows to titles containing it.
   */
  events(viewer: { user: string }, range: { from: number; to: number; zone?: string; q?: string; limit?: number; source?: string }): CalendarEvent[] {
    const { from, to } = range;
    const q = range.q?.trim().toLowerCase();
    const rows = this.db.all<ItemRow>(
      `${Calendar.SELECT}
       WHERE (s.owner IS NULL OR s.owner = ?) AND i.kind = 'event'
         AND i.start_ms < ? + (1 - i.abs) * ? AND i.end_ms > ? - (1 - i.abs) * ?
         AND (? IS NULL OR i.source = ?) AND (? IS NULL OR instr(lower(i.title), ?) > 0)
       ORDER BY i.start_ms, i.title LIMIT ?`,
      viewer.user, to, ZONE_SLOP, from, ZONE_SLOP, range.source ?? null, range.source ?? null, q || null, q || null, Math.min(range.limit ?? 2000, 5000),
    );
    const zone = range.zone && validZone(range.zone);
    const inZone = (t: string) => msOf(t) - (zone ? offsetAt(msOf(t), zone) : 0);
    return rows
      .filter((r) => !zone || r.start.endsWith("Z") || (inZone(r.start) < to && inZone(r.end) > from))
      .map((r) => this.event_(r));
  }

  event(id: string, viewer: { user: string }): CalendarEvent | null {
    const r = this.db.get<ItemRow>(`${Calendar.SELECT} WHERE i.id = ? AND (s.owner IS NULL OR s.owner = ?)`, id, viewer.user);
    return r ? this.event_(r) : null;
  }

  /**
   * The event's meeting note: the one it's linked to if that still exists, or a new one in Meetings/
   * from `Templates/Meeting note.md` (or a plain one), linked to the event. `timeZone` is the
   * reader's, for the times written in the note.
   */
  meetingNote(quire: Quire, id: string, viewer: { user: string }, opts: { timeZone?: string; source: string }) {
    const ev = this.event(id, viewer);
    if (!ev) throw new QuireError("That event doesn't exist, or you can't see it", "not_found");
    if (ev.note) return { path: ev.note.path, created: false as const };
    const zone = validZone(opts.timeZone);
    const when = describeWhen(ev, zone);
    const title = ev.title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Meeting";
    const rel = quire.freePath(`Meetings/${when.date} ${title}.md`);
    const content = meetingTemplate(quire.files.read("Templates/Meeting note.md"), ev, when);
    const r = quire.create(rel, content, opts.source);
    const noteId = this.db.get<{ id: string }>("SELECT id FROM notes WHERE path = ?", r.path)?.id ?? null;
    this.db.run("UPDATE external_items SET note_id = ? WHERE id = ?", noteId, id);
    return { path: r.path, created: true as const, version: r.version, change: r.change };
  }
}

// ------------------------------------------------------------------ for agents and the CLI

/** How far `zone` is ahead of UTC at instant `t`, in milliseconds. */
function offsetAt(t: number, zone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(t)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/** `days` days from the start of `from` (default today) in `zone`, as milliseconds. */
export function dayRange(from: string | undefined, days: number, zone: string): { from: number; to: number } {
  const day = from ?? new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new QuireError(`"from" must be a day like 2026-10-01, not "${day}"`);
  const midnight = (d: number) => {
    const guess = d - offsetAt(d, zone);
    return d - offsetAt(guess, zone);
  };
  const start = Date.parse(`${day}T00:00:00Z`);
  return { from: midnight(start), to: midnight(start + days * DAY) };
}

const person = (p: Person) => (p.name && p.email ? `${p.name} <${p.email}>` : (p.name ?? p.email ?? "")) + (p.status ? ` (${p.status})` : "");

/** Events as text for agents: one line each, with its id, source and meeting note. */
export function fmtEvents(events: CalendarEvent[], sources: Source[], zone: string, range: { from: number; to: number }): string {
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const days = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const head = `${events.length} event${events.length === 1 ? "" : "s"}, ${days.format(range.from)} to ${days.format(range.to - 1)} (${zone})`;
  if (!sources.length) return `${head}. This workspace has no calendars yet: subscribe to an ICS feed from the Calendar page.`;
  return [
    `${head}:`,
    ...events.map((e) => `- ${e.title} · ${describeWhen(e, zone).text} · ${names.get(e.source) ?? "calendar"} · id ${e.id}${e.note ? ` · note: ${e.note.path}` : ""}`),
  ].join("\n");
}

/** Calendars as text: name, where from, and how their last read went. */
export function fmtSources(list: Source[]): string {
  if (!list.length) return "No calendars. Subscribe to an ICS or webcal feed: quire calendars add <url>";
  const ago = (t: number | null) => (t === null ? "never read" : `read ${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  return list.map((s) => `${s.name} (${s.id}) · ${s.host ?? s.kind} · ${s.events} events · ${s.status === "error" ? `error: ${s.error}` : ago(s.syncedAt)}`).join("\n");
}

/** One event in full, for agents. */
export function fmtEvent(e: CalendarEvent, sources: Source[], zone: string): string {
  return [
    `# ${e.title}`,
    `id: ${e.id}`,
    `when: ${describeWhen(e, zone).text}${e.recurring ? " (recurring)" : ""}${e.status === "tentative" ? " (tentative)" : ""}`,
    `start: ${e.start}`,
    `end: ${e.end}`,
    `calendar: ${sources.find((s) => s.id === e.source)?.name ?? e.source}`,
    e.location && `where: ${e.location}`,
    e.organizer && `organizer: ${person(e.organizer)}`,
    e.attendees.length && `attendees: ${e.attendees.map(person).join(", ")}`,
    e.url && `url: ${e.url}`,
    `meeting note: ${e.note ? e.note.path : "none (create_meeting_note makes one)"}`,
    e.description && `\n${e.description}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function cleanName(s: string | undefined | null): string | null {
  const t = (s ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return t || null;
}

function validZone(z: string | undefined): string {
  if (!z) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return "UTC";
  }
}

/** An event's day and time in words, in `zone` ("UTC" for all-day and floating, which are the same everywhere). */
export function describeWhen(ev: Pick<CalendarEvent, "start" | "end" | "allDay">, zone: string) {
  const abs = ev.start.endsWith("Z");
  const tz = abs ? zone : "UTC";
  const start = new Date(msOf(ev.start));
  const end = new Date(msOf(ev.end));
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = (d: Date, zoneName = false) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(zoneName && abs ? { timeZoneName: "short" as const } : {}) }).format(d);
  if (ev.allDay) {
    const last = new Date(end.getTime() - DAY);
    return { date, text: last.getTime() > start.getTime() ? `${day(start)} to ${day(last)}, all day` : `${day(start)}, all day` };
  }
  const sameDay = day(start) === day(end) || end.getTime() === start.getTime();
  const text = sameDay ? `${day(start)}, ${time(start)} to ${time(end, true)}` : `${day(start)}, ${time(start, true)} to ${day(end)}, ${time(end, true)}`;
  return { date, text: text.replace(/ /g, " ") }; // newer ICU puts a narrow space before AM/PM
}

/** Markdown for text a feed wrote: its own markup can't make links, widgets or headings in the note. */
function plain(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^<>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/([\\`*_[\]<>#|!~])/g, "\\$1").replace(/^(\s*)(:::|::|[-+]\s|\d+\.\s|>)/gm, "$1\\$2").replace(/\n{3,}/g, "\n\n").trim();
}

const who = (p: Person) => plain(p.name ?? p.email ?? "");

/** A new meeting note: the template's {{placeholders}} filled in, or the default layout. */
function meetingTemplate(template: string | null, ev: CalendarEvent, when: { date: string; text: string }): string {
  const people = ev.attendees.map(who).filter(Boolean).join(", ");
  const link = `[${plain(ev.title)}](/calendar/${ev.id})`;
  const fields: Record<string, string> = {
    title: plain(ev.title),
    date: when.date,
    when: when.text,
    where: ev.location ? plain(ev.location) : "",
    attendees: people,
    event: link,
    agenda: ev.description ? plain(ev.description) : "",
  };
  if (template !== null) return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => fields[k] ?? m);
  return [
    "---",
    `event: ${ev.id}`,
    "---",
    `# ${fields.title}`,
    "",
    `**When:** ${fields.when}  `,
    ...(fields.where ? [`**Where:** ${fields.where}  `] : []),
    ...(people ? [`**Who:** ${people}  `] : []),
    `**Event:** ${link}`,
    "",
    "## Agenda",
    "",
    ...(fields.agenda ? [fields.agenda, ""] : []),
    "## Notes",
    "",
    "## Action items",
    "",
  ].join("\n");
}
