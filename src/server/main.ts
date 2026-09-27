// Local web app server: JSON API + live updates over WebSocket + Vite for the UI.
// Binds to 127.0.0.1 only. Agents never talk to this server; they write through the MCP server / CLI
// (or straight to disk), and the file watcher here picks the change up and attributes it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createServer as createVite } from "vite";
import { diffstat, PROJECT_ROOT, Quire, versionOf, type ArchiveScope, type Change } from "../core/quire.ts";
import { cleanPath, isHidden, kindOf, mimeOf, QuireError } from "../core/paths.ts";
import { unfurl } from "./unfurl.ts";

const PORT = Number(process.env.PORT ?? 4777);
const quire = Quire.open();

// What every UI client currently believes each file looks like. Used to tell our own writes
// (already broadcast) from writes made by agents or other editors.
const seen = new Map<string, string>();
const lastText = new Map<string, string>();
for (const n of quire.list(undefined, "all")) {
  seen.set(n.path, n.version);
  if (n.kind !== "asset") lastText.set(n.path, fs.readFileSync(quire.abs(n.path), "utf8"));
}

const httpServer = http.createServer((req, res) => {
  handle(req, res).catch((e) => fail(res, e));
});

const vite = await createVite({
  root: path.join(PROJECT_ROOT, "web"),
  server: { middlewareMode: true, hmr: { server: httpServer } },
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

const hosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const origins = new Set([...hosts].map((h) => `http://${h}`));
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
  if (req.url !== "/ws") return; // Vite's HMR socket handles itself
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
fs.watch(quire.root, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const rel = filename.split(path.sep).join("/");
  if (isHidden(rel)) return;
  const key = kindOf(rel) ? rel : "*"; // directory events → full resync
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => (timers.delete(key), key === "*" ? resync() : onDiskChange(rel)), 80));
});

function onDiskChange(rel: string) {
  if (!fs.existsSync(quire.abs(rel))) {
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
  const content = fs.readFileSync(quire.abs(rel), "utf8");
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

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!hostOk(req)) return send(res, 403, { error: "Forbidden host" });
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (url.pathname.startsWith("/vault/")) return asset(res, decodeURIComponent(url.pathname.slice(7)));
  if (url.pathname === "/vault-resolve") {
    const rel = quire.resolve(url.searchParams.get("target") ?? "", url.searchParams.get("from") ?? undefined);
    if (!rel || kindOf(rel) !== "asset") return send(res, 404, { error: "Not found" });
    res.writeHead(302, { Location: `/vault/${rel.split("/").map(encodeURIComponent).join("/")}` });
    return res.end();
  }
  vite.middlewares(req, res);
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!originOk(req)) return send(res, 403, { error: "Cross-origin request refused" });
  const route = `${req.method} ${url.pathname}`;
  const q = (k: string) => url.searchParams.get(k) ?? "";
  if (req.method !== "GET" && !String(req.headers["content-type"]).startsWith("application/json")) {
    return send(res, 415, { error: "JSON only" });
  }
  const body = req.method === "GET" ? {} : await readJson(req);

  switch (route) {
    case "GET /api/info":
      return send(res, 200, { vault: quire.root, name: path.basename(quire.root), projectRoot: PROJECT_ROOT });
    case "GET /api/notes":
      return send(res, 200, quire.list(undefined, "all")); // the UI hides archived notes itself
    case "GET /api/note": {
      const n = quire.read(q("path"));
      return send(res, 200, n);
    }
    case "GET /api/resolve":
      return send(res, 200, { path: quire.resolve(q("target"), q("from") || undefined) });
    case "GET /api/search":
      return send(res, 200, quire.search(q("q"), Number(q("limit")) || 30, (q("scope") || "active") as ArchiveScope));
    case "GET /api/feed":
      return send(
        res,
        200,
        quire.feed({
          q: q("q"),
          scope: (q("scope") || "active") as ArchiveScope,
          folder: q("folder") || undefined,
          tag: q("tag") || undefined,
          sort: q("sort") === "title" ? "title" : "modified",
          offset: Number(q("offset")) || 0,
          limit: Number(q("limit")) || 30,
        }),
      );
    case "GET /api/tasks":
      return send(res, 200, quire.tasks({ folder: q("folder") || undefined, note: q("note") || undefined }));
    case "POST /api/tasks/set": {
      const r = quire.setTask(String(body.path), Number(body.line), String(body.text), !!body.done, "you");
      if (r.change) {
        const content = fs.readFileSync(quire.abs(r.path), "utf8");
        seen.set(r.path, r.version);
        lastText.set(r.path, content);
        announce(r.path, content, r.version, r.change);
      }
      return send(res, 200, { path: r.path, version: r.version });
    }
    case "POST /api/archive":
    case "POST /api/unarchive": {
      const paths: string[] = Array.isArray(body.paths) ? body.paths : [];
      const moved = paths.map((p) => {
        const r = route.endsWith("unarchive") ? quire.unarchive(p, "you") : quire.archive(p, "you");
        return { from: p, to: r.path };
      });
      resync();
      broadcast({ type: "tree" });
      return send(res, 200, { moved });
    }
    case "GET /api/backlinks":
      return send(res, 200, quire.backlinks(q("path")));
    case "GET /api/unfurl": {
      const target = q("url");
      if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: "http(s) URLs only" });
      return send(res, 200, await unfurl(target));
    }
    case "GET /api/changes":
      return send(res, 200, quire.changes({ limit: Number(q("limit")) || 50 }));
    case "PUT /api/note": {
      const rel = cleanPath(body.path);
      // Never let a client blank out a note by accident (e.g. a stale tab whose editor failed to load).
      if (!String(body.content ?? "").trim() && !body.allowEmpty && fs.existsSync(quire.abs(rel)) && fs.readFileSync(quire.abs(rel), "utf8").trim()) {
        return send(res, 422, { error: `Refusing to replace ${rel} with an empty note`, code: "empty" });
      }
      const isNew = !seen.has(rel);
      const r = quire.save(rel, String(body.content), { baseVersion: body.baseVersion, source: "you" });
      seen.set(rel, r.version);
      lastText.set(rel, String(body.content));
      if (r.change) announce(rel, String(body.content), r.version, r.change, body.clientId);
      if (isNew) broadcast({ type: "tree" });
      return send(res, 200, { path: rel, version: r.version });
    }
    case "POST /api/note": {
      const r = quire.create(body.path, String(body.content ?? ""), "you");
      seen.set(r.path, r.version);
      lastText.set(r.path, String(body.content ?? ""));
      broadcast({ type: "change", change: r.change });
      broadcast({ type: "tree" });
      return send(res, 200, { path: r.path, version: r.version });
    }
    case "POST /api/move": {
      const r = quire.move(body.from, body.to, "you");
      resync();
      broadcast({ type: "tree" });
      return send(res, 200, r);
    }
  }
  send(res, 404, { error: `No route ${route}` });
}

function asset(res: http.ServerResponse, raw: string) {
  const rel = cleanPath(raw);
  const mime = mimeOf(rel);
  if (!mime || !fs.existsSync(quire.abs(rel))) return send(res, 404, { error: "Not found" });
  res.writeHead(200, {
    "Content-Type": mime,
    // Assets are agent-writable too: never let one run script in our origin (e.g. an SVG opened directly).
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(quire.abs(rel)).pipe(res);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) reject(new QuireError("Body too large"));
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new QuireError("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function fail(res: http.ServerResponse, e: unknown) {
  if (e instanceof QuireError) {
    const status = { not_found: 404, conflict: 409, exists: 409, invalid: 400 }[e.code];
    return send(res, status, { error: e.message, code: e.code, ...e.data });
  }
  console.error(e);
  send(res, 500, { error: "Internal error" });
}

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Quire  http://localhost:${PORT}\n  vault  ${quire.root}\n`);
});
