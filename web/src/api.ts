import { localDate, type TaskMeta, type TaskPatch } from "../../src/core/tasks.ts";
import type { GuideAction, GuideState } from "../../src/core/guide.ts";
import { did } from "./events.ts";
import type { NoteRole } from "../../src/core/noteRoles.ts";
import type { Contact, ContactFields, TimelineItem } from "../../src/core/contacts.ts";
import { encodeTarget, safeDecode } from "../../src/core/uri.ts";
import type { Decision, DecisionValue } from "../../src/core/decisions.ts";
import type { FillOptions, TemplateInfo } from "../../src/core/templates.ts";
import type { CalendarEvent, EventDraft, Source as CalendarSource, SourceColor } from "../../src/core/calendar.ts";
import type { QuerySort } from "../../src/core/query.ts";
import type { AwaySummary } from "../../src/core/away.ts";
import type { Checkup } from "../../src/core/checkup.ts";

/** The reader's day, which task writes and due filters go by (the server may be in another time zone). */
const today = () => localDate(Date.now());

export type { GuideState, TaskMeta, TaskPatch };
export type { Contact, ContactFields, TimelineItem } from "../../src/core/contacts.ts";
export type { Member } from "../../src/core/api.ts";
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
/** A note's name written as plain text in another note (Vault.unlinkedMentions). */
export interface UnlinkedMention {
  path: string;
  title: string;
  line: number;
  from: number;
  to: number;
  text: string;
  context: string;
}
/** A note find and replace changes: how many places, and its first changed lines (Vault.replaceAcross). */
export interface ReplacedNote {
  path: string;
  title: string;
  count: number;
  lines: Array<{ line: number; before: string; after: string }>;
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
export { isArchived } from "../../src/core/archive.ts";
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
/** A smart folder in someone's favorites. */
export interface SmartFavorite extends SmartFolder {
  smartFolder: true;
}
/** A favorite is a note, a tag or a smart folder, in one order. */
export type Favorite = NoteMeta | TagFavorite | SmartFavorite;
export const isTagFavorite = (f: Favorite): f is TagFavorite => "tag" in f;
export const isSmartFavorite = (f: Favorite): f is SmartFavorite => "smartFolder" in f;
export const isNoteFavorite = (f: Favorite): f is NoteMeta => "path" in f;
/** How a favorite is named in an order: a note's path, "#" and the tag, or "~" and a smart folder's ID. */
export const favoriteKey = (f: Favorite) => (isTagFavorite(f) ? `#${f.tag}` : isSmartFavorite(f) ? `~${f.id}` : f.path);
/** A tag (parents included), and how many notes, tasks and assets carry it or a tag under it. */
export interface TagCount {
  tag: string;
  display: string;
  notes: number;
  tasks: number;
  assets: number;
}
/** A tag someone added by name that nothing carries yet. */
export const unusedTag = (t: TagCount) => t.notes + t.tasks + t.assets === 0;
/** The day at a glance (Vault.today): sections of tasks, and today's journal note. */
export interface TodayView {
  date: string;
  sections: Array<{ id: "overdue" | "due" | "starting"; title: string; tasks: Task[] }>;
  journal: { path: string; exists: boolean };
  /** How many of today's tasks were ticked today (missing from an older server). */
  done?: number;
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

export type { CalendarEvent, CalendarSource, SourceColor, Decision };
/** An event as the app sends it to be made or changed: guests by name and address (the server keeps their replies). */
export type EventInput = Omit<EventDraft, "attendees"> & { attendees: Array<{ name: string | null; email: string | null }> };

/** Google Calendar on this server (cloud/src/connections.ts): "mock" is the Preview stand-in, "off" not set up. */
export interface GoogleStatus {
  mode: "real" | "mock" | "off";
  /** `calendar`: its calendars were allowed; `drive`: saving notes to Drive was (each is asked for the first time it's used). */
  connection: { account: string; calendar: boolean; canWrite: boolean; drive: boolean; connectedAt: number } | null;
}
/** One of the person's Google calendars. */
export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
}

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
/** Who a note or folder is shared with (online; see cloud/src/shares.ts). */
export interface Share {
  id: string;
  note: string | null;
  folder: string | null;
  kind: "user" | "email" | "link";
  name: string | null;
  email: string | null;
  role: "viewer" | "editor";
  expiresAt: number | null;
  createdBy: string | null;
  createdAt: number;
  /** A link's page, `/s/<token>`. */
  url: string | null;
}
export interface ShareList {
  target: { note?: string; folder?: string } | null;
  path: string | null;
  shares: Share[];
  /** Folder shares that reach the note too. */
  inherited: Share[];
}
/** A note someone can see through a share (or a link). */
export interface SharedNote {
  id: string;
  path: string;
  title: string;
  kind: "md" | "html" | "asset";
  version: string;
  role: "viewer" | "editor";
  content?: string | null;
}
export type ShareTarget = { path: string } | { folder: string };

export interface ConnectedAgent {
  id: string;
  client: string;
  /** How its changes are attributed in the change log, e.g. "Claude (via Audrow)". */
  actor: string;
  /** The person it works for, and its name in the change log (`person`, `agent` there). */
  person: string;
  workspace: { id: string; name: string; role: "owner" | "editor" | "viewer" } | null;
  /** It may work in every workspace you're in (the commonink CLI). */
  allWorkspaces?: boolean;
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
  /** Whether it's you. */
  you?: boolean;
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
  /** How many labels it has, which deleting it for good deletes too (none if left out). */
  labels?: number;
}
/** A label of a note (core Vault.label). */
export interface Label {
  id: string;
  note_id: string;
  /** Where the note is now; null while it's in Trash. */
  path: string | null;
  /** The change right before this version, or null. */
  change_id: number | null;
  name: string;
  description: string | null;
  version: string;
  ts: number;
  source: string;
  person: string | null;
  agent: string | null;
  /** The note is at this version now. */
  current: boolean;
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
  /** Locally, `vault` and `projectRoot` (where bin/commonink is) are absolute paths. */
  info: () => j<{ mode: "local" | "cloud"; name: string; vault?: string; projectRoot?: string }>(`${BASE}/info`),
  /** Online: which of your workspaces a note ID is in (404 if none you can open). */
  locate: (id: string) => j<{ workspace: { id: string; name: string } }>(`/api/note-ids/${id}`),
  createWorkspace: (name: string) => j<{ id: string }>("/api/workspaces", send("POST", { name })),
  /** Online: tell the server this browser's time zone, so your agents' "today" is yours. */
  reportTimeZone: () => j<{ timeZone: string }>("/api/me/time-zone", send("POST", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })),
  signOutEverywhere: () => j<{ ok: true }>("/api/sign-out-everywhere", send("POST", {})),
  /** Online: the agents you've connected over MCP, most recently used first. */
  agents: () => j<ConnectedAgent[]>("/api/agents"),
  revokeAgent: (id: string) => j<{ ok: true }>("/api/agents/revoke", send("POST", { id })),
  /** Online: notes other workspaces share with you. */
  sharedWithMe: () => j<Array<{ workspace: { id: string; name: string }; notes: SharedNote[] }>>("/api/shared"),
  /** This workspace's shares: of one note or folder, or all of them. */
  shares: (target?: ShareTarget) =>
    j<ShareList>(`${BASE}/shares${target ? ("folder" in target ? `?folder=${enc(target.folder)}` : `?path=${enc(target.path)}`) : ""}`),
  share: (target: ShareTarget, o: { email?: string; link?: boolean; role: "viewer" | "editor"; expiresAt?: number | null }) =>
    j<ShareList>(`${BASE}/shares`, send("POST", { ...target, ...o })),
  updateShare: (id: string, o: { role?: "viewer" | "editor"; expiresAt?: number | null }) => j<{ ok: true }>(`${BASE}/shares/update`, send("POST", { id, ...o })),
  unshare: (id: string) => j<{ ok: true }>(`${BASE}/shares/remove`, send("POST", { id })),
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
  /** Whether agents may share by link (online only), and whether the workspace is gamified (web/src/gamify.ts). Owners change them; locally, you do. */
  workspaceSettings: () => j<{ agentLinks?: boolean; gamified: boolean }>(`${BASE}/workspace/settings`),
  setWorkspaceSettings: (s: { agentLinks?: boolean; gamified?: boolean }) => j<{ agentLinks?: boolean; gamified: boolean }>(`${BASE}/workspace/settings`, send("POST", s)),
  workspaceLog: () => j<WorkspaceLogEntry[]>(`${BASE}/workspace/log`),
  renameWorkspace: (name: string) => j<{ ok: true; name: string }>(`${BASE}/workspace/rename`, send("POST", { name })),
  deleteWorkspace: (confirm: string) => j<{ ok: true }>(`${BASE}/workspace/delete`, send("POST", { confirm })),
  notes: () => j<NoteMeta[]>(`${BASE}/notes`),
  note: (path: string) => j<Note>(`${BASE}/note?path=${enc(path)}`),
  search: (q: string, scope: Scope = "active") => j<SearchHit[]>(`${BASE}/search?q=${enc(q)}&limit=20&scope=${scope}`),
  feed: (p: { q?: string; scope?: Scope; folder?: string; tag?: string; match?: "all" | "any"; sort?: QuerySort; offset?: number; limit?: number }) =>
    j<FeedPage>(`${BASE}/feed?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  /** `assignee`: someone's name (every @name that's theirs) or "me"; `by: "me"`: tasks you gave someone else, in your notes. */
  tasks: (p: { folder?: string; note?: string; tag?: string; assignee?: string; by?: "me"; due?: string; start?: string; done?: string; priority?: string; today?: string }) =>
    j<Task[]>(`${BASE}/tasks?${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
  /** How many tasks are still open across the workspace (the Tasks badge). */
  openTasks: () => j<{ open: number }>(`${BASE}/tasks/count`).then((r) => r.open),
  tags: () => j<TagCount[]>(`${BASE}/tags`),
  smartFolders: () => j<SmartFolder[]>(`${BASE}/smart-folders`),
  /** Create a smart folder, or change one by `id`. */
  saveSmartFolder: (f: { id?: string; name: string; query: string; shared: boolean }) => j<SmartFolder>(`${BASE}/smart-folders`, send("POST", { id: f.id, name: f.name, query: f.query, shared: f.shared })),
  deleteSmartFolder: (id: string) => j<SmartFolder[]>(`${BASE}/smart-folders/delete`, send("POST", { id })),
  /** Each tagged asset's tags. */
  assetTags: () => j<Record<string, string[]>>(`${BASE}/asset-tags`),
  setAssetTags: (path: string, tags: string[]) => j<{ tags: string[] }>(`${BASE}/asset-tags`, send("PUT", { path, tags })),
  /** Add a tag by name, before any note carries it; take one away while nothing does. Each returns every tag. */
  addTag: (tag: string) => j<TagCount[]>(`${BASE}/tags`, send("POST", { tag })),
  deleteTag: (tag: string) => j<TagCount[]>(`${BASE}/tags/delete`, send("POST", { tag })),
  /** Rename (or merge) a tag everywhere. Restoring `changes` and setting `assets` back undoes it. */
  /** Find and replace across notes. `dryRun` only says what would change; else `restore(changes[i], versions[i])` undoes each note. */
  replace: (find: string, replace: string, opts: { matchCase?: boolean; wholeWord?: boolean; folder?: string; dryRun?: boolean } = {}) =>
    j<{ notes: ReplacedNote[]; changes: number[]; versions: string[] }>(`${BASE}/replace`, send("POST", { find, replace, ...opts })),
  renameTag: (from: string, to: string) => j<{ changes: number[]; versions: string[]; assets: Record<string, string[]> }>(`${BASE}/tags/rename`, send("POST", { from, to })),
  setTask: (t: Task, done: boolean) => (done && did("tick"), j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/set`, send("POST", { path: t.path, line: t.line, text: t.text, done, today: today() }))),
  /** Change a task's tokens in its note; the rest of its line stays as written. */
  updateTask: (t: Task, patch: TaskPatch) => j<{ path: string; version: string; line: number; text: string }>(`${BASE}/tasks/update`, send("POST", { path: t.path, line: t.line, text: t.text, patch, today: today() })),
  /** The day at a glance for `day` (the viewer's today). */
  today: (day: string) => j<TodayView>(`${BASE}/today?today=${encodeURIComponent(day)}`),
  /** Today's journal note, made from the journal template if it's missing. */
  dailyNote: (day: string) => j<{ path: string; created: boolean }>(`${BASE}/today/journal`, send("POST", { today: day })),
  /** Decisions agents asked for that wait on the person (src/core/decisions.ts), in the order asked; "settled" for answered ones, newest first. */
  decisions: (status?: "settled") => j<Decision[]>(`${BASE}/decisions${status ? `?status=${status}` : ""}`),
  /** Answer one in its shape (an option, several, a choice per row, an order, a number, words), or dismiss it. It's written into today's journal note; `change` answers one again and rewrites its lines there. */
  answerDecision: (id: string, a: { value?: DecisionValue; comment?: string; dismiss?: boolean; change?: boolean }) =>
    j<Decision>(`${BASE}/decisions/answer`, send("POST", { id, ...a, today: today() })),
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
  starSmartFolder: (id: string) => j<Favorite[]>(`${BASE}/favorites/star`, send("POST", { smart_folder: id })),
  unstarSmartFolder: (id: string) => j<Favorite[]>(`${BASE}/favorites/unstar`, send("POST", { smart_folder: id })),
  /** `keys` are note paths, "#tag"s and "~id"s for smart folders (see favoriteKey). */
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
    j<{ trashed: Trashed[]; moved: Array<{ from: string; to: string }>; unshared?: number }>(`${BASE}/delete-folder`, send("POST", { folder, notes })),
  /** Rename a folder (or move it under another): everything in it moves, links rewritten. */
  renameFolder: (folder: string, to: string) =>
    j<{ from: string; path: string; moved: Array<{ from: string; to: string }> }>(`${BASE}/folders/rename`, send("POST", { folder, to })),
  trash: () => j<TrashItem[]>(`${BASE}/trash`),
  restoreTrash: (ids: string[]) => j<{ restored: string[] }>(`${BASE}/trash/restore`, send("POST", { ids })),
  purgeTrash: (ids: string[]) => j<{ deleted: string[] }>(`${BASE}/trash/delete`, send("POST", { ids })),
  emptyTrash: () => j<{ deleted: string[] }>(`${BASE}/trash/empty`, send("POST", {})),
  unarchive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>(`${BASE}/unarchive`, send("POST", { paths })),
  /** Links to `path`; "all" brings the ones from archived notes too. */
  backlinks: (path: string, scope: "active" | "all" = "active") => j<Backlink[]>(`${BASE}/backlinks?path=${enc(path)}&scope=${scope}`),
  /** Where other notes write this note's name without linking it. */
  mentions: (path: string) => j<UnlinkedMention[]>(`${BASE}/mentions?path=${enc(path)}`),
  /** Turn one of them into a link to `target`: one change, restored by `restore(change, version)`. */
  linkMention: (target: string, m: UnlinkedMention) =>
    j<{ path: string; version: string; change: number | null }>(`${BASE}/mentions/link`, send("POST", { target, path: m.path, line: m.line, from: m.from, to: m.to, text: m.text })),
  /** The workspace's contacts (notes in People/), by name. */
  contacts: () => j<Contact[]>(`${BASE}/contacts?today=${today()}`),
  /** One contact, and the notes that mention them, newest first. */
  contact: (path: string) => j<{ contact: Contact; timeline: TimelineItem[] }>(`${BASE}/contact?path=${enc(path)}&today=${today()}`),
  createContact: (c: Partial<ContactFields> & { name: string; notes?: string }) => j<{ path: string; version: string }>(`${BASE}/contacts`, send("POST", c)),
  updateContact: (path: string, patch: Partial<Omit<ContactFields, "name">>) => j<{ path: string; version: string }>(`${BASE}/contacts/update`, send("POST", { path, patch })),
  /** `keep` gains `drop`'s details and links; `drop` goes to Trash (`trashed` restores it). */
  mergeContacts: (keep: string, drop: string) => j<{ path: string; updated: string[]; trashed: Trashed[] }>(`${BASE}/contacts/merge`, send("POST", { keep, drop })),
  /** Many notes at once, path → text; ones already there are left alone (or replaced). */
  importNotes: (notes: Record<string, string>, existing: "skip" | "replace" = "skip") =>
    j<{ created: string[]; replaced: string[]; skipped: string[] }>(`${BASE}/import`, send("POST", { notes, existing })),
  importContacts: (format: "vcard" | "csv", text: string) => j<{ created: string[]; updated: string[]; unchanged: string[] }>(`${BASE}/contacts/import`, send("POST", { format, text })),
  /** The note templates (notes in Templates/), by name. */
  templates: () => j<TemplateInfo[]>(`${BASE}/templates`),
  /** A template filled in, to insert: its text and where its {{cursor}} is. */
  renderTemplate: (template: string, o: FillOptions) => j<{ path: string; text: string; cursor: number | null; unfilled: string[] }>(`${BASE}/templates/render`, send("POST", { template, ...o })),
  /** A new note from a template; `cursor` is where its {{cursor}} is. */
  fromTemplate: (template: string, o: FillOptions & { folder?: string }) =>
    j<{ path: string; version: string; cursor: number | null; unfilled: string[] }>(`${BASE}/notes/from-template`, send("POST", { template, ...o })),
  /** A page of the change log, newest first; `before` pages further back. */
  history: (p: { limit?: number; before?: number; after?: number; path?: string; by?: string }) =>
    j<Change[]>(`${BASE}/changes?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  /** What agents did since your own last change, and after change `after` (the last one dismissed); null if nothing. */
  away: (after = 0) => j<AwaySummary | null>(`${BASE}/changes/away?after=${after}`),
  /** What may need tending in the workspace (src/core/checkup.ts). */
  checkup: () => j<Checkup>(`${BASE}/checkup`),
  /** The agents in the change log, for filtering History by one. */
  changeAgents: () => j<string[]>(`${BASE}/changes/agents`),
  /** What a set of changes did, note by note. `ids` is ranges like "12-18,20". */
  diffs: (ids: string) => j<DiffFile[]>(`${BASE}/diffs?ids=${ids}`),
  /** A note's text before and after change #id. */
  diff: (id: number) => j<{ path: string; before: string | null; after: string | null }>(`${BASE}/diff?from=${id}`),
  /** The net lines added and removed by each set of changes (ranges as for diffs), at most 50 sets. */
  diffStats: (sets: string[]) => j<Array<LineStat | null>>(`${BASE}/diffstats?sets=${sets.join(";")}`),
  /** Put a note back the way it was before change #id; with `version`, only if the note is still at that version. */
  /** A note's labels, or every note's. */
  labels: (path?: string) => j<Label[]>(`${BASE}/labels${path ? `?path=${enc(path)}` : ""}`),
  label: (path: string, name: string, opts: { description?: string; at?: number } = {}) => j<Label>(`${BASE}/labels`, send("POST", { path, name, ...opts })),
  renameLabel: (id: string, name: string, description: string | null) => j<Label>(`${BASE}/labels/rename`, send("POST", { id, name, description })),
  deleteLabel: (id: string) => j<Label>(`${BASE}/labels/delete`, send("POST", { id })),
  /** A label's text beside another label's, or the note's now (`to` = "now"). */
  compareLabels: (from: string, to = "now") =>
    j<{ path: string; from: Label & { text: string }; to: (Label & { text: string }) | { now: true; text: string } }>(`${BASE}/labels/compare?from=${enc(from)}&to=${enc(to)}`),
  restoreLabel: (id: string, version?: string) => j<{ path: string; version: string; change: number | null }>(`${BASE}/labels/restore`, send("POST", { id, version })),
  restore: (id: number, version?: string) => j<{ path: string; version: string; change: number | null }>(`${BASE}/restore`, send("POST", { id, version })),
  changes: () => j<Change[]>(`${BASE}/changes?limit=40`),
  /**
   * `origin` (this tab's clientId) marks a save the tab's editor already shows, so the live update
   * skips it there. With the note's `id`, a note that moved meanwhile is saved where it is now; the
   * answer's `path` says where.
   */
  save: (path: string, content: string, baseVersion?: string, allowEmpty = false, origin?: string, id?: string) =>
    j<{ path: string; version: string }>(`${BASE}/note`, send("PUT", { path, content, baseVersion, clientId: origin, allowEmpty, id })),
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
  /** Notes as a .zip (core/export.ts): some notes by path (each with its files), a folder, or everything. */
  async exportZip(q: { paths?: string[]; folder?: string; all?: boolean }): Promise<{ name: string; data: Blob }> {
    const qs = new URLSearchParams();
    for (const p of q.paths ?? []) qs.append("path", p);
    if (q.folder) qs.set("folder", q.folder);
    if (q.all) qs.set("all", "1");
    const r = await fetch(`${BASE}/export?${qs}`);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new ApiError(data.error ?? r.statusText, r.status, data);
    }
    const disposition = r.headers.get("Content-Disposition") ?? "";
    const name = safeDecode(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "") || "Notes.zip";
    return { name, data: await r.blob() };
  },
  // Calendars (src/core/calendar.ts).
  calendars: () => j<CalendarSource[]>(`${BASE}/calendar/sources`),
  /** Subscribe to an ICS or webcal feed; it's read once before this answers. */
  subscribe: (url: string, name?: string, color?: SourceColor) => j<CalendarSource>(`${BASE}/calendar/sources`, send("POST", { url, name, color })),
  updateCalendar: (id: string, patch: { name?: string; color?: SourceColor; writeBack?: boolean }) => j<CalendarSource>(`${BASE}/calendar/sources/update`, send("POST", { id, ...patch })),
  /** Add one of your Google calendars to this workspace, where only you see it. */
  addGoogleCalendar: (calendar: string, name?: string, accessRole?: string) => j<CalendarSource>(`${BASE}/calendar/google`, send("POST", { calendar, name, accessRole })),
  /** Online: whether Google Calendar works on this server, and your connection to it (404 locally). */
  google: () => j<GoogleStatus>("/api/google"),
  googleCalendars: () => j<GoogleCalendar[]>("/api/google/calendars"),
  /** Google forgets the grant, and your Google calendars leave every workspace. */
  disconnectGoogle: () => j<{ ok: true }>("/api/google/disconnect", send("POST", {})),
  /** Save a note to your Google Drive, sent as Word or markdown, as a Google Doc, a PDF or a markdown file. Where it went, to open. */
  saveToDrive: (as: "doc" | "pdf" | "md", title: string, file: Blob) =>
    j<{ id: string; name: string; url: string }>(`/api/google/drive?${new URLSearchParams({ as, title })}`, { method: "POST", headers: { "Content-Type": file.type }, body: file }),
  unsubscribe: (id: string) => j<{ ok: true }>(`${BASE}/calendar/sources/remove`, send("POST", { id })),
  /** Read one calendar again, or all of them (each at most once a minute). */
  refreshCalendars: (id?: string) => j<CalendarSource[]>(`${BASE}/calendar/refresh`, send("POST", { id })),
  /** Events overlapping [from, to), soonest first; `q` narrows by title. */
  events: (from: Date, to: Date, q?: string) =>
    j<CalendarEvent[]>(`${BASE}/calendar/events?from=${enc(from.toISOString())}&to=${enc(to.toISOString())}&tz=${enc(Intl.DateTimeFormat().resolvedOptions().timeZone)}${q ? `&q=${enc(q)}` : ""}`),
  event: (id: string) => j<CalendarEvent>(`${BASE}/calendar/event?id=${enc(id)}`),
  /** Add an event to a calendar you can write to ("local": the workspace's own, made on its first event), and its meeting note if asked. */
  createEvent: (draft: EventInput & { source: string; meetingNote?: boolean; note?: string }) =>
    j<{ event: CalendarEvent; note: { path: string } | null }>(`${BASE}/calendar/events`, send("POST", draft)),
  /** Move an event, change its length or what it says; it keeps its ID. */
  updateEvent: (id: string, patch: Partial<EventInput>) => j<CalendarEvent>(`${BASE}/calendar/events/update`, send("POST", { id, ...patch })),
  deleteEvent: (id: string) => j<{ ok: true }>(`${BASE}/calendar/events/delete`, send("POST", { id })),
  /**
   * The event's meeting note, made (in Meetings/) and linked if it doesn't have one yet. `linkedBack`:
   * for a Google event with write-back on, whether the note's link reached the event.
   */
  meetingNote: (id: string) =>
    j<{ path: string; created: boolean; linkedBack?: { ok: true } | { ok: false; error: string } | null }>(`${BASE}/calendar/meeting-note`, send("POST", { id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })),
};

export function assetUrl(target: string, from?: string): string {
  if (/^(?:https?:\/\/|data:image\/)/i.test(target)) return target;
  return `${BASE}/file-resolve?target=${encodeTarget(target)}${from ? `&from=${encodeTarget(from)}` : ""}`;
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
