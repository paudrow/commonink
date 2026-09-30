// Local web app server: JSON API + live updates over WebSocket + Vite for the UI.
// Binds to 127.0.0.1 only. Agents never talk to this server; they write through the MCP server / CLI
// (or straight to disk), and the file watcher here picks the change up and attributes it.
import { randomBytes } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { ASSET_TAGS, diffstat, versionOf, type Change } from "../core/quire.ts";
import { LOCAL_USER, openVault, PROJECT_ROOT } from "../core/local.ts";
import { cleanPath, fileSecurityHeaders, isHidden, kindOf, mimeOf, MAX_UPLOAD, QuireError } from "../core/paths.ts";
import { errorResponse, handleApi, json, type ApiHost } from "../core/api.ts";
import { SANDBOX_PATH, sandboxPage } from "../core/sandbox.ts";
import { appPolicy } from "../core/csp.ts";
import { assertPublic, unfurl } from "./unfurl.ts";
import { Calendar, fetchFeed } from "../core/calendar.ts";
import { watchTree } from "./watch.ts";

// PORT=0 picks a free port (printed on start). QUIRE_NO_UI=1 serves only /api, skipping Vite.
const PORT = Number(process.env.PORT ?? 4777);
const UI = process.env.QUIRE_NO_UI !== "1";
const quire = openVault();
const files = quire.files;

// What every UI client currently believes each file looks like. Used to tell our own writes
// (already broadcast) from writes made by agents or other editors.
const seen = new Map<string, string>();
const lastText = new Map<string, string>();
for (const n of quire.list(undefined, "all")) {
  seen.set(n.path, n.version);
  if (n.kind !== "asset") lastText.set(n.path, files.read(n.path) ?? "");
}

const httpServer = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, errorResponse(e)));
});

// The same CSP as online. Vite stamps this nonce on the scripts in the page it serves; it lasts
// as long as the server, since Vite builds the page once per request from a fixed setting.
const NONCE = randomBytes(16).toString("base64");

const vite = UI && await (await import("vite")).createServer({
  html: { cspNonce: NONCE },
  root: path.join(PROJECT_ROOT, "web"),
  // No CORS, and nothing but the app's own files: Vite would otherwise serve anything under the
  // project (the default vault, .dev.vars) to any localhost page that asked.
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
    cors: false,
    fs: { strict: true, deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.dev.vars", "**/.quire/**", "**/vault/**"] },
  },
  appType: "spa",
  logLevel: "warn",
  // Pre-bundle everything up front. If Vite discovers a dependency mid-session it re-bundles and
  // reloads the page, and a page mixing old and new bundles can't build an editor.
  optimizeDeps: {
    include: [
      "@codemirror/state", "@codemirror/view", "@codemirror/language", "@codemirror/commands", "@codemirror/search",
      "@codemirror/autocomplete", "@codemirror/lang-markdown", "@codemirror/language-data", "@codemirror/lang-html",
      "@codemirror/lang-yaml", "@lezer/markdown", "@lezer/highlight", "@lezer/common", "@replit/codemirror-vim",
      "marked", "dompurify", "diff", "node-diff3", "mermaid",
    ],
  },
});

// ------------------------------------------------------------------ security

// Filled in once we're listening, when the port is known.
const hosts = new Set<string>();
const origins = new Set<string>();
/** Blocks DNS-rebinding: only answer requests addressed to us by a loopback name. */
const hostOk = (req: http.IncomingMessage) => hosts.has(req.headers.host ?? "");
/**
 * Blocks cross-site writes (other websites, and sandboxed HTML notes whose origin is "null").
 * Mutations must also be JSON, which forces a CORS preflight we never approve.
 */
const originOk = (req: http.IncomingMessage) => {
  const o = req.headers.origin;
  return o === undefined ? req.method === "GET" : origins.has(o);
};

// ------------------------------------------------------------------ live updates

const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    if (!vite) socket.destroy(); // with Vite, its HMR socket handles itself; without, nothing does
    return;
  }
  if (!hostOk(req) || !origins.has(req.headers.origin ?? "")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
function broadcast(msg: Record<string, unknown>) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}
function announce(rel: string, content: string | null, version: string, change: Change | null, origin?: string) {
  broadcast({ type: "note", path: rel, kind: kindOf(rel), version, content, source: change?.source ?? "external", change, origin });
  if (change) broadcast({ type: "change", change });
}

// ------------------------------------------------------------------ file watcher

const timers = new Map<string, NodeJS.Timeout>();
watchTree(files.root, (rel) => {
  if (isHidden(rel) && rel !== ASSET_TAGS) return;
  const key = kindOf(rel) ? rel : "*"; // directory events → full resync
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      // A file the parser chokes on is logged, not allowed to take the server down.
      try {
        if (key === "*") resync();
        else onDiskChange(rel);
      } catch (e) {
        console.error(`Couldn't pick up ${rel}:`, e);
      }
    }, 80),
  );
});

function onDiskChange(rel: string) {
  if (rel === ASSET_TAGS) {
    quire.sync(); // re-reads the asset tags file if it changed
    return broadcast({ type: "tree" });
  }
  if (!files.stat(rel)) {
    if (!seen.delete(rel)) return;
    lastText.delete(rel);
    quire.unindex(rel);
    broadcast({ type: "removed", path: rel });
    broadcast({ type: "tree" });
    return;
  }
  const kind = kindOf(rel)!;
  const isNew = !seen.has(rel);
  if (kind === "asset") {
    const meta = quire.indexFile(rel);
    if (meta) seen.set(rel, meta.version);
    if (isNew) broadcast({ type: "tree" });
    return;
  }
  const content = files.read(rel) ?? "";
  const version = versionOf(content);
  if (seen.get(rel) === version) return; // our own write, already announced
  const before = lastText.get(rel);
  seen.set(rel, version);
  lastText.set(rel, content);
  quire.indexFile(rel, content);
  // Written through MCP/CLI? Then the change log already knows who did it.
  const change =
    quire.attribution(rel, version) ??
    quire.recordChange(
      {
        path: rel,
        op: isNew ? "create" : "edit",
        source: "external",
        version,
        summary: before === undefined ? `${content.split("\n").length} lines` : diffstat(before, content),
        from_path: null,
      },
      before ?? null,
    );
  announce(rel, content, version, change);
  if (isNew) broadcast({ type: "tree" });
}

function resync() {
  quire.sync();
  const now = new Set(quire.list(undefined, "all").map((n) => n.path));
  for (const p of [...seen.keys()]) if (!now.has(p)) onDiskChange(p);
  for (const p of now) if (!seen.has(p)) onDiskChange(p);
}

// ------------------------------------------------------------------ http

/** The note API, shared with the Cloudflare workspace. Writes here are announced directly; the watcher skips them. */
const host: ApiHost = {
  quire,
  actor: "you",
  user: LOCAL_USER,
  canEditShared: true,
  info: () => ({ mode: "local", name: path.basename(files.root), vault: files.root, projectRoot: PROJECT_ROOT }),
  written(rel, content, version, change, origin) {
    seen.set(rel, version);
    if (content !== null) lastText.set(rel, content);
    if (change) announce(rel, content, version, change, origin);
  },
  moved: () => resync(),
  removed(rel, change) {
    seen.delete(rel);
    lastText.delete(rel);
    broadcast({ type: "removed", path: rel });
    broadcast({ type: "change", change });
  },
  tree: () => broadcast({ type: "tree" }),
  // Calendar feeds are fetched from public hosts only, like link previews.
  calendar: new Calendar(quire.db, (url, last) => fetchFeed(url, last, assertPublic)),
  calendarChanged: () => broadcast({ type: "calendar" }),
};

/** Read calendar feeds as they come due (every half hour each), while the app is running. */
async function syncCalendars() {
  if (await host.calendar!.syncDue().catch((e) => (console.error("Calendar sync failed:", e), 0))) broadcast({ type: "calendar" });
}
setInterval(syncCalendars, 60_000).unref();
void syncCalendars();

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!hostOk(req)) return send(res, json({ error: "Forbidden host" }, 403));
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // Every path, the app's files included: another site (or another localhost port) gets nothing.
  if (!originOk(req)) return send(res, json({ error: "Cross-origin request refused" }, 403));
  if (url.pathname === SANDBOX_PATH) return send(res, sandboxPage());
  if (!url.pathname.startsWith("/api/")) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", appPolicy(NONCE, url)); // also: no framing the app to click through it
    return vite ? vite.middlewares(req, res) : send(res, json({ error: "Not found (QUIRE_NO_UI)" }, 404));
  }
  const route = url.pathname.slice("/api".length);
  // Uploads are raw bytes; the Origin check above is what keeps other sites out.
  if (route === "/upload" && req.method === "POST") return upload(req, res, url);
  if (req.method !== "GET" && !String(req.headers["content-type"]).startsWith("application/json")) {
    return send(res, json({ error: "JSON only" }, 415));
  }
  // The web app asks who's signed in to tell online from local: here, nobody signs in.
  if (route === "/me") return send(res, json({ local: true }));
  if (route.startsWith("/files/")) return asset(res, decodePath(route.slice("/files/".length)));
  if (route === "/file-resolve") {
    const rel = quire.resolve(url.searchParams.get("target") ?? "", url.searchParams.get("from") ?? undefined);
    if (!rel || kindOf(rel) !== "asset") return send(res, json({ error: "Not found" }, 404));
    res.writeHead(302, { Location: `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}` });
    return res.end();
  }
  if (route === "/unfurl") {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target)) return send(res, json({ error: "http(s) URLs only" }, 400));
    return send(res, json(await unfurl(target)));
  }
  const request = await toRequest(req, url);
  if (!request) return tooLarge(res, "Request body is over 20 MB");
  const response = await handleApi(host, request, route);
  send(res, response ?? json({ error: `No route ${req.method} ${url.pathname}` }, 404));
}

function decodePath(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new QuireError(`Invalid path: ${s}`);
  }
}

function asset(res: http.ServerResponse, raw: string) {
  const rel = cleanPath(raw);
  const mime = mimeOf(rel);
  if (!mime || !files.stat(rel)) return send(res, json({ error: "Not found" }, 404));
  // Opened before answering: a file that can't be read (its permissions, or deleted just now) is a
  // 404, not an error on a stream with no listener, which would stop the server.
  let fd: number;
  try {
    fd = fs.openSync(files.abs(rel), "r");
  } catch {
    return send(res, json({ error: "Not found" }, 404));
  }
  res.writeHead(200, { "Content-Type": mime, "Content-Length": String(fs.fstatSync(fd).size), ...fileSecurityHeaders(mime), "Cache-Control": "no-cache" });
  fs.createReadStream("", { fd }).on("error", () => res.destroy()).pipe(res);
}

/** Save an uploaded file into the vault (assets/ by default), under a free name. */
async function upload(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  try {
    const rel = quire.uploadPath(url.searchParams.get("name") ?? "", url.searchParams.get("folder") ?? "assets");
    const bytes = await readBody(req, MAX_UPLOAD);
    if (!bytes) return tooLarge(res, "That file is over 50 MB");
    seen.set(rel, "uploading"); // the watcher leaves it to us
    files.write(rel, bytes);
    const r = quire.recordUpload(rel, false, host.actor);
    seen.set(rel, r.version);
    announce(rel, null, r.version, r.change);
    broadcast({ type: "tree" });
    send(res, json({ path: rel, version: r.version, size: r.size }));
  } catch (e) {
    send(res, errorResponse(e));
  }
}

/**
 * A request body, or null if it's over `limit` bytes. An oversized body is still read to its end and
 * dropped, so the client has sent all of it when the 413 comes back. Closing the connection on a
 * client that's still sending resets it, which can lose the 413.
 */
function readBody(req: http.IncomingMessage, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
      else chunks.length = 0;
    });
    req.on("end", () => resolve(size <= limit ? Uint8Array.from(Buffer.concat(chunks)) : null));
    req.on("error", reject);
  });
}

const tooLarge = (res: http.ServerResponse, error: string) => send(res, json({ error }, 413));

/** The web-standard Request for the shared API, or null if the body is too big. */
async function toRequest(req: http.IncomingMessage, url: URL): Promise<Request | null> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = (await readBody(req, 20 * 1024 * 1024)) ?? undefined;
    if (!body) return null;
  }
  return new Request(url, { method: req.method, headers, body });
}

async function send(res: http.ServerResponse, r: Response) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

httpServer.listen(PORT, "127.0.0.1", () => {
  const port = (httpServer.address() as { port: number }).port;
  for (const h of [`localhost:${port}`, `127.0.0.1:${port}`]) hosts.add(h), origins.add(`http://${h}`);
  console.log(`\n  Quire  http://localhost:${port}\n  vault  ${files.root}\n`);
});
