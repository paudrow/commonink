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
  op: "create" | "edit" | "move" | "delete" | "archive" | "unarchive";
  source: string;
  version: string | null;
  summary: string | null;
  from_path: string | null;
  note_id: string | null;
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
}
export interface FeedPage {
  items: FeedItem[];
  total: number;
  counts: { active: number; archived: number };
  folders: string[];
}
export const isArchived = (p: string) => p.startsWith("Archive/");
export interface Task {
  path: string;
  title: string;
  line: number;
  text: string;
  done: boolean;
  heading: string | null;
}

export type ServerMsg =
  | { type: "note"; path: string; kind: Kind; version: string; content: string | null; source: string; change: Change | null; origin?: string }
  | { type: "change"; change: Change }
  | { type: "removed"; path: string }
  | { type: "tree" };

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
export const apiBase = () => BASE;
export const fileUrl = (path: string) => `${BASE}/files/${path.split("/").map(encodeURIComponent).join("/")}`;

export interface Me {
  user: { id: string; name: string; email: string; picture: string | null };
  workspaces: Array<{ id: string; name: string; kind: "personal" | "team"; role: "owner" | "editor" | "viewer" }>;
}
/** Online: who's signed in (null if nobody). Locally the endpoint doesn't exist: undefined. */
export async function whoAmI(): Promise<{ me: Me | null; devLogin: boolean } | undefined> {
  const r = await fetch("/api/me").catch(() => null);
  if (!r || r.status === 404) return undefined;
  const data = await r.json().catch(() => ({}));
  return r.ok ? { me: data as Me, devLogin: false } : { me: null, devLogin: !!data.devLogin };
}
const enc = encodeURIComponent;

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
  info: () => j<{ mode: "local" | "cloud"; name: string; vault?: string }>(`${BASE}/info`),
  /** Online: which of your workspaces a note ID is in (404 if none you can open). */
  locate: (id: string) => j<{ workspace: { id: string; name: string } }>(`/api/note-ids/${id}`),
  createWorkspace: (name: string) => j<{ id: string }>("/api/workspaces", send("POST", { name })),
  signOutEverywhere: () => j<{ ok: true }>("/api/sign-out-everywhere", send("POST", {})),
  invite: (role: "editor" | "viewer") => j<{ url: string }>(`${BASE}/invites`, send("POST", { role })),
  notes: () => j<NoteMeta[]>(`${BASE}/notes`),
  note: (path: string) => j<Note>(`${BASE}/note?path=${enc(path)}`),
  search: (q: string, scope: Scope = "active") => j<SearchHit[]>(`${BASE}/search?q=${enc(q)}&limit=20&scope=${scope}`),
  feed: (p: { q?: string; scope?: Scope; folder?: string; tag?: string; sort?: "modified" | "title"; offset?: number; limit?: number }) =>
    j<FeedPage>(`${BASE}/feed?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  tasks: (p: { folder?: string; note?: string }) =>
    j<Task[]>(`${BASE}/tasks?${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
  setTask: (t: Task, done: boolean) => j<{ path: string; version: string }>(`${BASE}/tasks/set`, send("POST", { path: t.path, line: t.line, text: t.text, done })),
  /** Your starred notes, in your order. Each change returns the new list. */
  favorites: () => j<NoteMeta[]>(`${BASE}/favorites`),
  star: (path: string) => j<NoteMeta[]>(`${BASE}/favorites/star`, send("POST", { path })),
  unstar: (path: string) => j<NoteMeta[]>(`${BASE}/favorites/unstar`, send("POST", { path })),
  orderFavorites: (paths: string[]) => j<NoteMeta[]>(`${BASE}/favorites`, send("PUT", { paths })),
  archive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>(`${BASE}/archive`, send("POST", { paths })),
  unarchive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>(`${BASE}/unarchive`, send("POST", { paths })),
  backlinks: (path: string) => j<Backlink[]>(`${BASE}/backlinks?path=${enc(path)}`),
  /** A page of the change log, newest first; `before` pages further back. */
  history: (p: { limit?: number; before?: number; path?: string }) =>
    j<Change[]>(`${BASE}/changes?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  /** What a set of changes did, note by note. `ids` is ranges like "12-18,20". */
  diffs: (ids: string) => j<DiffFile[]>(`${BASE}/diffs?ids=${ids}`),
  restore: (id: number) => j<{ path: string; version: string; change: number | null }>(`${BASE}/restore`, send("POST", { id })),
  changes: () => j<Change[]>(`${BASE}/changes?limit=40`),
  save: (path: string, content: string, baseVersion?: string, allowEmpty = false) =>
    j<{ path: string; version: string }>(`${BASE}/note`, send("PUT", { path, content, baseVersion, clientId, allowEmpty })),
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
