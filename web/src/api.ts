import { localDate, type TaskMeta, type TaskPatch } from "../../src/core/tasks.ts";
import type { GuideAction, GuideState } from "../../src/core/guide.ts";
import { did } from "./events.ts";
import type { NoteRole } from "../../src/core/noteRoles.ts";
import type { CalendarEvent, Source as CalendarSource, SourceColor } from "../../src/core/calendar.ts";

/** The reader's day, which task writes and due filters go by (the server may be in another time zone). */
const today = () => localDate(Date.now());

export type { GuideState, TaskMeta, TaskPatch };
export type Kind = "md" | "html" | "asset";
export interface NoteMeta {
  id: string;
  path: string;
  kind: Kind;
  title: string;
  version: string;
  mtime: number;
  size: number;
}
export interface Note extends NoteMeta {
  content: string;
}
export interface Change {
  id: number;
  ts: number;
  path: string;
  op: "create" | "edit" | "move" | "delete" | "archive" | "unarchive" | "restore" | "purge";
  source: string;
  version: string | null;
  summary: string | null;
  from_path: string | null;
  note_id: string | null;
  /** Who it was by or for; `agent` is set when an agent made it (see authorLabel). */
  person: string | null;
  agent: string | null;
}
export interface DiffRun {
  from: number;
  to: number;
  count: number;
  sources: string[];
  tsFrom: number;
  tsTo: number;
  op: Change["op"];
  summary: string | null;
  skipped: number;
  before: string | null;
  after: string | null;
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
  last: number;
}
export interface SearchHit {
  path: string;
  title: string;
  kind: Kind;
  snippet: string;
  lines: Array<{ line: number; text: string }>;
}
export interface Backlink {
  path: string;
  title: string;
  kind: string;
  line: number;
  text: string;
}
export type Scope = "active" | "archived" | "all";
export interface FeedItem {
  id: string;
  path: string;
  kind: Kind;
  title: string;
  mtime: number;
  archived: boolean;
  excerpt: string;
  tags: string[];
  lines: Array<{ line: number; text: string }>;
  lastSource: string | null;
  /** Who made the last change (see authorName). */
  lastBy: { person: string | null; agent: string | null } | null;
  role: NoteRole | null;
}
export interface FeedPage {
  items: FeedItem[];
  total: number;
  counts: { active: number; archived: number };
  folders: string[];
}
export const isArchived = (p: string) => p.startsWith("Archive/");
/** A saved note query in the sidebar, with how many active notes match it now. */
export interface SmartFolder {
  id: string;
  name: string;
  /** As ::query args: `tag=work sort=title`. */
  query: string;
  shared: boolean;
  count: number;
}
/** A tag in someone's favorites, and how many active notes carry it (or a tag under it). */
export interface TagFavorite {
  tag: string;
  display: string;
  notes: number;
}
/** A favorite is a note or a tag, in one order. */
export type Favorite = NoteMeta | TagFavorite;
export const isTagFavorite = (f: Favorite): f is TagFavorite => "tag" in f;
/** How a favorite is named in an order: a note's path, or "#" and the tag. */
export const favoriteKey = (f: Favorite) => (isTagFavorite(f) ? `#${f.tag}` : f.path);
/** A tag in use (parents included), and how many notes, tasks and assets carry it or a tag under it. */
export interface TagCount {
  tag: string;
  display: string;
  notes: number;
  tasks: number;
  assets: number;
}
/** The day at a glance (Quire.today): sections of tasks, and today's journal note. */
export interface TodayView {
  date: string;
  sections: Array<{ id: "overdue" | "due" | "starting"; title: string; tasks: Task[] }>;
  journal: { path: string; exists: boolean };
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

export type ServerMsg =
  | { type: "note"; path: string; kind: Kind; version: string; content: string | null; source: string; change: Change | null; origin?: string }
  | { type: "change"; change: Change }
  | { type: "removed"; path: string }
  | { type: "tree" }
  /** Calendars or their events changed (a sync, a new subscription, a meeting note). */
  | { type: "calendar" };

export type { CalendarEvent, CalendarSource, SourceColor };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: any,
  ) {
    super(message);
  }
}

export const clientId = crypto.randomUUID();

/**
 * Where the note API lives: "/api" for the local app, "/api/w/<workspace>" online. `live` is the
 * WebSocket path for the same workspace.
 */
let BASE = "/api";
let LIVE = "/ws";
export function useWorkspace(base: string, live: string) {
  BASE = base;
  LIVE = live;
  resolveCache.clear();
}
export const fileUrl = (path: string) => `${BASE}/files/${path.split("/").map(encodeURIComponent).join("/")}`;

export interface Me {
  user: { id: string; name: string; email: string; picture: string | null };
  workspaces: Array<{ id: string; name: string; kind: "personal" | "team"; role: "owner" | "editor" | "viewer" }>;
}
export interface ConnectedAgent {
  id: string;
  client: string;
  /** How its changes are attributed in the change log, e.g. "Claude (via Audrow)". */
  actor: string;
  /** The person it works for, and its name in the change log (`person`, `agent` there). */
  person: string;
  workspace: { id: string; name: string; role: "owner" | "editor" | "viewer" } | null;
  connectedAt: number;
  usedAt: number | null;
}
/** Online: who's signed in (null if nobody). Locally, where the server answers `{ local: true }`: undefined. */
export async function whoAmI(): Promise<{ me: Me | null; devLogin: boolean } | undefined> {
  const r = await fetch("/api/me").catch(() => null);
  if (!r) return undefined;
  const data = await r.json().catch(() => ({}));
  if (data.local) return undefined;
  return r.ok ? { me: data as Me, devLogin: false } : { me: null, devLogin: !!data.devLogin };
}
const enc = encodeURIComponent;

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  joinedAt: number;
}
export interface WorkspaceInvite {
  id: string;
  role: "editor" | "viewer";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
}
export interface WorkspaceLogEntry {
  at: number;
  actor: string | null;
  action: "rename" | "role" | "remove" | "leave" | "invite" | "revoke-invite";
  target: string | null;
  detail: string | null;
}

/** A note or asset just sent to Trash, and the id that brings it back. */
export interface Trashed {
  id: string;
  path: string;
}
export interface TrashItem extends Trashed {
  kind: "md" | "html" | "asset";
  size: number;
  deletedAt: number;
  expiresAt: number;
  by: { source: string; person: string | null; agent: string | null } | null;
  excerpt: string;
}
export interface DeleteCheck {
  notes: number;
  assets: number;
  /** Notes (outside what's being deleted) that link to or embed it. */
  linkedFrom: string[];
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error ?? r.statusText, r.status, data);
  return data as T;
}
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const resolveCache = new Map<string, Promise<string | null>>();

export const api = {
  /** Locally, `vault` and `projectRoot` (where bin/quire is) are absolute paths. */
  info: () => j<{ mode: "local" | "cloud"; name: string; vault?: string; projectRoot?: string }>(`${BASE}/info`),
  /** Online: which of your workspaces a note ID is in (404 if none you can open). */
  locate: (id: string) => j<{ workspace: { id: string; name: string } }>(`/api/note-ids/${id}`),
  createWorkspace: (name: string) => j<{ id: string }>("/api/workspaces", send("POST", { name })),
  signOutEverywhere: () => j<{ ok: true }>("/api/sign-out-everywhere", send("POST", {})),
  /** Online: the agents you've connected over MCP, most recently used first. */
  agents: () => j<ConnectedAgent[]>("/api/agents"),
  revokeAgent: (id: string) => j<{ ok: true }>("/api/agents/revoke", send("POST", { id })),
  /** A page of a workspace's change log, whichever workspace is open. */
  changesIn: (workspace: string) => j<Change[]>(`/api/w/${workspace}/changes?limit=200`),
  invite: (role: "editor" | "viewer") => j<{ url: string }>(`${BASE}/invites`, send("POST", { role })),
  // Online: the workspace's settings (cloud/src/admin.ts).
  members: () => j<WorkspaceMember[]>(`${BASE}/members`),
  setRole: (user: string, role: WorkspaceMember["role"]) => j<{ ok: true }>(`${BASE}/members/role`, send("POST", { user, role })),
  removeMember: (user: string) => j<{ ok: true }>(`${BASE}/members/remove`, send("POST", { user })),
  leave: () => j<{ ok: true }>(`${BASE}/leave`, send("POST", {})),
  invites: () => j<WorkspaceInvite[]>(`${BASE}/invites`),
  revokeInvite: (id: string) => j<{ ok: true }>(`${BASE}/invites/revoke`, send("POST", { id })),
  workspaceLog: () => j<WorkspaceLogEntry[]>(`${BASE}/workspace/log`),
  renameWorkspace: (name: string) => j<{ ok: true; name: string }>(`${BASE}/workspace/rename`, send("POST", { name })),
  deleteWorkspace: (confirm: string) => j<{ ok: true }>(`${BASE}/workspace/delete`, send("POST", { confirm })),
  notes: () => j<NoteMeta[]>(`${BASE}/notes`),
  note: (path: string) => j<Note>(`${BASE}/note?path=${enc(path)}`),
  search: (q: string, scope: Scope = "active") => j<SearchHit[]>(`${BASE}/search?q=${enc(q)}&limit=20&scope=${scope}`),
  feed: (p: { q?: string; scope?: Scope; folder?: string; tag?: string; sort?: "modified" | "title"; offset?: number; limit?: number }) =>
    j<FeedPage>(`${BASE}/feed?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  tasks: (p: { folder?: string; note?: string; tag?: string; assignee?: string; due?: string; today?: string }) =>
    j<Task[]>(`${BASE}/tasks?${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
  /** How many tasks are still open across the workspace (the Tasks badge). */
  openTasks: () => j<{ open: number }>(`${BASE}/tasks/count`).then((r) => r.open),
  tags: () => j<TagCount[]>(`${BASE}/tags`),
  smartFolders: () => j<SmartFolder[]>(`${BASE}/smart-folders`),
  /** Create a smart folder, or change one by `id`. */
  saveSmartFolder: (f: { id?: string; name: string; query: string; shared: boolean }) => j<SmartFolder>(`${BASE}/smart-folders`, send("POST", f)),
  deleteSmartFolder: (id: string) => j<SmartFolder[]>(`${BASE}/smart-folders/delete`, send("POST", { id })),
  /** Each tagged asset's tags. */
  assetTags: () => j<Record<string, string[]>>(`${BASE}/asset-tags`),
  setAssetTags: (path: string, tags: string[]) => j<{ tags: string[] }>(`${BASE}/asset-tags`, send("PUT", { path, tags })),
  /** Rename (or merge) a tag everywhere. Restoring `changes` and setting `assets` back undoes it. */
  renameTag: (from: string, to: string) => j<{ changes: number[]; assets: Record<string, string[]> }>(`${BASE}/tags/rename`, send("POST", { from, to })),
  setTask: (t: Task, done: boolean) => (done && did("tick"), j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/set`, send("POST", { path: t.path, line: t.line, text: t.text, done, today: today() }))),
  /** Change a task's tokens in its note; the rest of its line stays as written. */
  updateTask: (t: Task, patch: TaskPatch) => j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/update`, send("POST", { path: t.path, line: t.line, text: t.text, patch, today: today() })),
  /** The day at a glance for `day` (the viewer's today). */
  today: (day: string) => j<TodayView>(`${BASE}/today?today=${encodeURIComponent(day)}`),
  /** Today's journal note, made from the daily template if it's missing. */
  dailyNote: (day: string) => j<{ path: string; created: boolean }>(`${BASE}/today/journal`, send("POST", { today: day })),
  /** Add a task written in words (see src/core/quickAdd.ts); `ignore` holds phrases kept as words. */
  addTask: (text: string, ignore: string[] = [], to?: string) => j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/add`, send("POST", { text, ignore, to, today: today() })),
  /** Take a task (and what's nested under it) out of its note: quick-add's Undo. */
  /** Move a task (and what's nested under it) to another note. */
  moveTask: (t: Task, to: string) => j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/move`, send("POST", { path: t.path, line: t.line, text: t.text, to })),
  /** Your starred notes, in your order. Each change returns the new list. */
  favorites: () => j<Favorite[]>(`${BASE}/favorites`),
  star: (path: string) => (did("star"), j<Favorite[]>(`${BASE}/favorites/star`, send("POST", { path }))),
  unstar: (path: string) => j<Favorite[]>(`${BASE}/favorites/unstar`, send("POST", { path })),
  starTag: (tag: string) => j<Favorite[]>(`${BASE}/favorites/star`, send("POST", { tag })),
  unstarTag: (tag: string) => j<Favorite[]>(`${BASE}/favorites/unstar`, send("POST", { tag })),
  /** `keys` are note paths and "#tag"s (see favoriteKey). */
  orderFavorites: (keys: string[]) => j<Favorite[]>(`${BASE}/favorites`, send("PUT", { paths: keys })),
  /** The Getting started checklist's state, or null if there isn't one (see src/core/guide.ts). */
  guide: () => j<GuideState | null>(`${BASE}/guide`),
  /** Have the guide tick a step, show its demo edit, or close the checklist. */
  guideDo: (action: GuideAction) => j<GuideState | null>(`${BASE}/guide`, send("POST", { action })),
  archive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>(`${BASE}/archive`, send("POST", { paths })),
  /** What deleting these notes, or everything in a folder, would touch. */
  deleteCheck: (o: { paths?: string[]; folder?: string }) =>
    j<DeleteCheck>(`${BASE}/delete-check?${o.folder ? `folder=${enc(o.folder)}` : (o.paths ?? []).map((p) => `path=${enc(p)}`).join("&")}`),
  /** Send notes and assets to Trash; `trashed` is what Undo restores. */
  delete: (paths: string[]) => j<{ trashed: Trashed[] }>(`${BASE}/delete`, send("POST", { paths })),
  deleteFolder: (folder: string, notes: "trash" | "lift") =>
    j<{ trashed: Trashed[]; moved: Array<{ from: string; to: string }> }>(`${BASE}/delete-folder`, send("POST", { folder, notes })),
  trash: () => j<TrashItem[]>(`${BASE}/trash`),
  restoreTrash: (ids: string[]) => j<{ restored: string[] }>(`${BASE}/trash/restore`, send("POST", { ids })),
  purgeTrash: (ids: string[]) => j<{ deleted: string[] }>(`${BASE}/trash/delete`, send("POST", { ids })),
  emptyTrash: () => j<{ deleted: string[] }>(`${BASE}/trash/empty`, send("POST", {})),
  unarchive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>(`${BASE}/unarchive`, send("POST", { paths })),
  backlinks: (path: string) => j<Backlink[]>(`${BASE}/backlinks?path=${enc(path)}`),
  /** A page of the change log, newest first; `before` pages further back. */
  history: (p: { limit?: number; before?: number; path?: string; by?: string }) =>
    j<Change[]>(`${BASE}/changes?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  /** The agents in the change log, for filtering History by one. */
  changeAgents: () => j<string[]>(`${BASE}/changes/agents`),
  /** What a set of changes did, note by note. `ids` is ranges like "12-18,20". */
  diffs: (ids: string) => j<DiffFile[]>(`${BASE}/diffs?ids=${ids}`),
  /** A note's text before and after change #id. */
  diff: (id: number) => j<{ path: string; before: string | null; after: string | null }>(`${BASE}/diff?from=${id}`),
  /** The net lines added and removed by each set of changes (ranges as for diffs), at most 50 sets. */
  diffStats: (sets: string[]) => j<Array<LineStat | null>>(`${BASE}/diffstats?sets=${sets.join(";")}`),
  /** Put a note back the way it was before change #id; with `version`, only if the note is still at that version. */
  restore: (id: number, version?: string) => j<{ path: string; version: string; change: number | null }>(`${BASE}/restore`, send("POST", { id, version })),
  changes: () => j<Change[]>(`${BASE}/changes?limit=40`),
  /** `origin` (this tab's clientId) marks a save the tab's editor already shows, so the live update skips it there. */
  save: (path: string, content: string, baseVersion?: string, allowEmpty = false, origin?: string) =>
    j<{ path: string; version: string }>(`${BASE}/note`, send("PUT", { path, content, baseVersion, clientId: origin, allowEmpty })),
  create: (path: string, content: string) => j<{ path: string; version: string }>(`${BASE}/note`, send("POST", { path, content })),
  move: (from: string, to: string) => j<{ path: string; updated: string[] }>(`${BASE}/move`, send("POST", { from, to })),
  /** Upload a file's bytes; the server picks a free name under `folder` (assets/ by default). */
  async upload(file: File, folder = "assets"): Promise<{ path: string; version: string; size: number }> {
    const r = await fetch(`${BASE}/upload?name=${enc(file.name)}&folder=${enc(folder)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(data.error ?? r.statusText, r.status, data);
    return data;
  },
  resolve(target: string, from?: string): Promise<string | null> {
    const key = `${from ?? ""}\u0000${target}`;
    if (!resolveCache.has(key)) {
      resolveCache.set(
        key,
        j<{ path: string | null }>(`${BASE}/resolve?target=${enc(target)}${from ? `&from=${enc(from)}` : ""}`).then((r) => r.path),
      );
    }
    return resolveCache.get(key)!;
  },
  clearResolveCache: () => resolveCache.clear(),
  // Calendars (src/core/calendar.ts).
  calendars: () => j<CalendarSource[]>(`${BASE}/calendar/sources`),
  /** Subscribe to an ICS or webcal feed; it's read once before this answers. */
  subscribe: (url: string, name?: string, color?: SourceColor) => j<CalendarSource>(`${BASE}/calendar/sources`, send("POST", { url, name, color })),
  updateCalendar: (id: string, patch: { name?: string; color?: SourceColor }) => j<CalendarSource>(`${BASE}/calendar/sources/update`, send("POST", { id, ...patch })),
  unsubscribe: (id: string) => j<{ ok: true }>(`${BASE}/calendar/sources/remove`, send("POST", { id })),
  /** Read one calendar again, or all of them (each at most once a minute). */
  refreshCalendars: (id?: string) => j<CalendarSource[]>(`${BASE}/calendar/refresh`, send("POST", { id })),
  /** Events overlapping [from, to), soonest first; `q` narrows by title. */
  events: (from: Date, to: Date, q?: string) =>
    j<CalendarEvent[]>(`${BASE}/calendar/events?from=${enc(from.toISOString())}&to=${enc(to.toISOString())}&tz=${enc(Intl.DateTimeFormat().resolvedOptions().timeZone)}${q ? `&q=${enc(q)}` : ""}`),
  event: (id: string) => j<CalendarEvent>(`${BASE}/calendar/event?id=${enc(id)}`),
  /** The event's meeting note, made (in Meetings/) and linked if it doesn't have one yet. */
  meetingNote: (id: string) =>
    j<{ path: string; created: boolean }>(`${BASE}/calendar/meeting-note`, send("POST", { id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })),
};

export function assetUrl(target: string, from?: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `${BASE}/file-resolve?target=${enc(target)}${from ? `&from=${enc(from)}` : ""}`;
}

export function connect(onMessage: (m: ServerMsg) => void, onStatus: (up: boolean) => void) {
  let delay = 500;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${LIVE}`);
    ws.onopen = () => {
      delay = 500;
      onStatus(true);
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (e.code === 4001) return location.reload(); // signed out everywhere: back to the sign-in screen
      onStatus(false);
      setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    };
  };
  open();
}
