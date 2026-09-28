// One Durable Object per workspace: its notes, full-text index, links and change log in embedded
// SQLite (so every query is in-process), its files in R2, and a WebSocket hub for live updates.
// Only the Worker can reach it, and the Worker has already checked who's asking and their role; it
// checks the role again against the same table, so a slip in the Worker can't open a route.
import { DurableObject } from "cloudflare:workers";
import { Quire } from "../../src/core/quire.ts";
import { migrate } from "../../src/core/store.ts";
import { errorResponse, handleApi, json, type ApiHost } from "../../src/core/api.ts";
import { cleanPath, fileSecurityHeaders, kindOf, MAX_UPLOAD, mimeOf } from "../../src/core/paths.ts";
import type { Change } from "../../src/core/quire.ts";
import { access, asRole } from "./access.ts";
import { DoDb, SqlContent } from "./do-store.ts";
import { SEED_FILES, SEED_NOTES } from "./seed.ts";
import type { Env } from "./env.ts";

export class Workspace extends DurableObject<Env> {
  private db: DoDb;
  private files: SqlContent;
  private quire: Quire;
  private registering: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = (this.db = new DoDb(ctx.storage));
    migrate(db);
    // Note IDs this workspace has claimed in the directory (see registerIds).
    db.exec("CREATE TABLE IF NOT EXISTS registered_ids(id TEXT PRIMARY KEY)");
    this.files = new SqlContent(db);
    this.quire = new Quire(db, this.files);
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const wsId = req.headers.get("x-ci-workspace")!;
    const res = await this.handle(req, wsId);
    // Claim any new note IDs once the request has done its work (the first request also backfills).
    this.registering ??= this.registerIds(wsId)
      .catch((e) => console.error("Couldn't register note IDs", e))
      .finally(() => (this.registering = null));
    this.ctx.waitUntil(this.registering);
    return res;
  }

  /**
   * Claim this workspace's unclaimed note IDs in the directory, so their URLs work from any
   * workspace. An ID already claimed elsewhere (a collision, or a vault brought in from outside)
   * gets a new one, which the next round claims.
   */
  private async registerIds(wsId: string) {
    for (let round = 0; round < 5; round++) {
      const ids = this.db.all<{ id: string }>("SELECT id FROM notes WHERE id IS NOT NULL AND id NOT IN (SELECT id FROM registered_ids)").map((r) => r.id);
      if (!ids.length) return;
      let reassigned = false;
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const now = Date.now();
        await this.env.DB.batch(
          chunk.map((id) => this.env.DB.prepare("INSERT INTO note_ids(id, workspace_id, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING").bind(id, wsId, now)),
        );
        const { results } = await this.env.DB.prepare(`SELECT id, workspace_id FROM note_ids WHERE id IN (${chunk.map(() => "?").join(",")})`)
          .bind(...chunk)
          .all<{ id: string; workspace_id: string }>();
        const owner = new Map(results.map((r) => [r.id, r.workspace_id]));
        for (const id of chunk) {
          if (owner.get(id) === wsId) this.db.run("INSERT OR IGNORE INTO registered_ids(id) VALUES (?)", id);
          else if (owner.has(id) && this.quire.pathOf(id)) {
            this.quire.reassignId(id);
            reassigned = true;
          }
        }
      }
      if (reassigned) this.broadcast({ type: "tree" });
    }
  }

  private async handle(req: Request, wsId: string): Promise<Response> {
    const url = new URL(req.url);
    const route = url.pathname;
    const base = `/api/w/${wsId}`;
    const user = req.headers.get("x-ci-user") ?? "";

    const allowed = access(asRole(req.headers.get("x-ci-role")), req.method, route);
    if (allowed === "unknown") return json({ error: `No route ${req.method} ${route}` }, 404);
    if (allowed === "forbidden") return json({ error: "You can view this workspace but not edit it" }, 403);

    if (route === "/live") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, [user]); // tagged, so signing out everywhere can close it
      return new Response(null, { status: 101, webSocket: client });
    }
    if (route.startsWith("/files/")) return this.serveFile(decodeURIComponent(route.slice("/files/".length)));
    if (route === "/upload" && req.method === "POST") {
      return this.upload(req, url, wsId, decodeURIComponent(req.headers.get("x-ci-actor") ?? "someone"));
    }
    if (route === "/file-resolve") {
      const rel = this.quire.resolve(url.searchParams.get("target") ?? "", url.searchParams.get("from") ?? undefined);
      if (!rel || kindOf(rel) !== "asset") return json({ error: "Not found" }, 404);
      return new Response(null, { status: 302, headers: { Location: `${base}/files/${rel.split("/").map(encodeURIComponent).join("/")}` } });
    }

    const host: ApiHost = {
      quire: this.quire,
      actor: decodeURIComponent(req.headers.get("x-ci-actor") ?? "someone"),
      user,
      info: () => ({ mode: "cloud", name: decodeURIComponent(req.headers.get("x-ci-workspace-name") ?? "Workspace") }),
      written: (rel, content, version, change, origin) => this.announce(rel, content, version, change, origin),
      moved: (from, to, version, change) => {
        this.broadcast({ type: "removed", path: from });
        this.announce(to, this.files.read(to), version, change);
      },
      tree: () => this.broadcast({ type: "tree" }),
    };
    return (await handleApi(host, req, route)) ?? json({ error: `No route ${req.method} ${route}` }, 404);
  }

  /** Fill a brand-new workspace with the starter notes (no-op if it has anything in it). */
  async seed(wsId: string) {
    if (!this.files.isEmpty) return;
    for (const [rel, { text, mime }] of Object.entries(SEED_FILES)) {
      const key = `ws/${wsId}/${crypto.randomUUID()}`;
      await this.env.FILES.put(key, text, { httpMetadata: { contentType: mime } });
      this.files.putBlob(rel, key, new TextEncoder().encode(text).length, mime);
    }
    for (const [rel, text] of Object.entries(SEED_NOTES)) this.quire.create(rel, text, "Common Ink");
    this.quire.sync();
  }

  /** Store an uploaded file in R2 and list it in this workspace (assets/ by default, under a free name). */
  private async upload(req: Request, url: URL, wsId: string, actor: string): Promise<Response> {
    try {
      const name = url.searchParams.get("name") ?? "";
      const folder = url.searchParams.get("folder") ?? "assets";
      let rel = this.quire.uploadPath(name, folder);
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_UPLOAD) return json({ error: "That file is over 50 MB" }, 413);
      const mime = mimeOf(rel)!;
      const key = `ws/${wsId}/${crypto.randomUUID()}`;
      await this.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
      if (this.files.stat(rel)) rel = this.quire.uploadPath(name, folder); // taken while we were storing it
      this.files.putBlob(rel, key, body.byteLength, mime);
      const r = this.quire.recordUpload(rel, false, actor);
      this.announce(rel, null, r.version, r.change);
      this.broadcast({ type: "tree" });
      return json({ path: rel, version: r.version, size: r.size });
    } catch (e) {
      return errorResponse(e);
    }
  }

  private async serveFile(raw: string): Promise<Response> {
    const rel = cleanPath(raw);
    const meta = this.files.blob(rel);
    if (!meta?.blob) return json({ error: "Not found" }, 404);
    const obj = await this.env.FILES.get(meta.blob);
    if (!obj) return json({ error: "Not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": meta.mime ?? "application/octet-stream",
        "Content-Length": String(obj.size),
        ...fileSecurityHeaders(meta.mime ?? ""),
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  private announce(rel: string, content: string | null, version: string, change: Change | null, origin?: string) {
    this.broadcast({ type: "note", path: rel, kind: kindOf(rel), version, content, source: change?.source ?? "external", change, origin });
    if (change) this.broadcast({ type: "change", change });
  }

  private broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  /** Close someone's live connections (they signed out everywhere). Their tabs then ask them to sign in. */
  disconnect(userId: string) {
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(4001, "Signed out");
  }

  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
