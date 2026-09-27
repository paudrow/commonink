export type Kind = "md" | "html" | "asset";
export interface NoteMeta {
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
  info: () => j<{ vault: string; name: string; projectRoot: string }>("/api/info"),
  notes: () => j<NoteMeta[]>("/api/notes"),
  note: (path: string) => j<Note>(`/api/note?path=${enc(path)}`),
  search: (q: string, scope: Scope = "active") => j<SearchHit[]>(`/api/search?q=${enc(q)}&limit=20&scope=${scope}`),
  feed: (p: { q?: string; scope?: Scope; folder?: string; tag?: string; sort?: "modified" | "title"; offset?: number; limit?: number }) =>
    j<FeedPage>(`/api/feed?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
  tasks: (p: { folder?: string; note?: string }) =>
    j<Task[]>(`/api/tasks?${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
  setTask: (t: Task, done: boolean) => j<{ path: string; version: string }>("/api/tasks/set", send("POST", { path: t.path, line: t.line, text: t.text, done })),
  archive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>("/api/archive", send("POST", { paths })),
  unarchive: (paths: string[]) => j<{ moved: Array<{ from: string; to: string }> }>("/api/unarchive", send("POST", { paths })),
  backlinks: (path: string) => j<Backlink[]>(`/api/backlinks?path=${enc(path)}`),
  changes: () => j<Change[]>("/api/changes?limit=40"),
  save: (path: string, content: string, baseVersion?: string, allowEmpty = false) =>
    j<{ path: string; version: string }>("/api/note", send("PUT", { path, content, baseVersion, clientId, allowEmpty })),
  create: (path: string, content: string) => j<{ path: string; version: string }>("/api/note", send("POST", { path, content })),
  move: (from: string, to: string) => j<{ path: string; updated: string[] }>("/api/move", send("POST", { from, to })),
  resolve(target: string, from?: string): Promise<string | null> {
    const key = `${from ?? ""}\u0000${target}`;
    if (!resolveCache.has(key)) {
      resolveCache.set(
        key,
        j<{ path: string | null }>(`/api/resolve?target=${enc(target)}${from ? `&from=${enc(from)}` : ""}`).then((r) => r.path),
      );
    }
    return resolveCache.get(key)!;
  },
  clearResolveCache: () => resolveCache.clear(),
};

export function assetUrl(target: string, from?: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `/vault-resolve?target=${enc(target)}${from ? `&from=${enc(from)}` : ""}`;
}

export function connect(onMessage: (m: ServerMsg) => void, onStatus: (up: boolean) => void) {
  let delay = 500;
  const open = () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      onStatus(true);
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus(false);
      setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    };
  };
  open();
}
