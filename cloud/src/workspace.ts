// One Durable Object per workspace: its notes, full-text index, links and change log in embedded
// SQLite (so every query is in-process), its files in R2, and a WebSocket hub for live updates.
// Only the Worker can reach it, and the Worker has already checked who's asking and their role; it
// checks the role again against the same table, so a slip in the Worker can't open a route.
import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Quire } from "../../src/core/quire.ts";
import { migrate } from "../../src/core/store.ts";
import { errorResponse, handleApi, json, type ApiHost } from "../../src/core/api.ts";
import { cleanPath, fileSecurityHeaders, kindOf, MAX_UPLOAD, mimeOf } from "../../src/core/paths.ts";
import type { Change } from "../../src/core/quire.ts";
import { createMcpServer } from "../../src/core/tools.ts";
import { access, asRole } from "./access.ts";
import { DoDb, SqlContent } from "./do-store.ts";
import { SEED_FILES, SEED_NOTES } from "./seed.ts";
import { membersOf } from "./admin.ts";
import type { Env } from "./env.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { Calendar } from "../../src/core/calendar.ts";
import { assertPublicUrl } from "../../src/core/unfurl.ts";
import { feedsFor } from "./demo-calendar.ts";
import { googleMode } from "./connections.ts";
import { googleReader } from "./google-reader.ts";

/** A note and its previous text are each a SQLite row here, which holds at most 2 MB. */
const MAX_NOTE_BYTES = 1_900_000;

export class Workspace extends DurableObject<Env> {
  private db: DoDb;
  private files: SqlContent;
  private quire: Quire;
  private registering: Promise<void> | null = null;
  private calendar: Calendar;
  /** Where this app is ("https://commonink.app"), from the last request: feeds may not point back at it, and links written to Google use it. */
  private selfOrigin: string | null = null;
  private alarmChecked = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = (this.db = new DoDb(ctx.storage));
    migrate(db);
    // Note IDs this workspace has claimed in the directory (see registerIds).
    db.exec("CREATE TABLE IF NOT EXISTS registered_ids(id TEXT PRIMARY KEY)");
    // An upload's bytes go from R2 once it's deleted for good.
    this.files = new SqlContent(db, (key) => ctx.waitUntil(env.FILES.delete(key)));
    this.quire = new Quire(db, this.files, { maxNoteBytes: MAX_NOTE_BYTES });
    // Notes only change through the core here, so this finds nothing to do, except after an
    // upgrade that asks for notes to be indexed again (tags, say).
    this.quire.sync();
    // Calendar feeds come from public hosts only, as link previews do.
    this.calendar = new Calendar(
      db,
      feedsFor(env, (u) => {
        assertPublicUrl(u);
        if (this.selfOrigin && u.hostname.replace(/\.$/, "") === new URL(this.selfOrigin).hostname) throw new Error("self");
      }),
      { readers: googleMode(env) === "off" ? {} : { google: googleReader(env, db) } },
    );
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const wsId = req.headers.get("x-ci-workspace")!;
    this.selfOrigin = req.headers.get("x-ci-origin") ?? this.selfOrigin;
    if (!this.alarmChecked) {
      this.alarmChecked = true;
      await this.schedule();
    }
    // Anything unexpected is a plain 500, with no stack or message from inside.
    const res = await this.handle(req, wsId).catch(errorResponse);
    this.claimIds(wsId);
    return res;
  }

  /** Claim any new note IDs once a request has done its work (the first request also backfills). */
  private claimIds(wsId: string) {
    this.registering ??= this.registerIds(wsId)
      .catch((e) => console.error("Couldn't register note IDs", e))
      .finally(() => (this.registering = null));
    this.ctx.waitUntil(this.registering);
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
      // Tagged by person and by session, so signing out (here or everywhere) can close it, and it
      // closes when its session runs out.
      this.ctx.acceptWebSocket(server, [user, `s:${req.headers.get("x-ci-session") ?? ""}`]);
      server.serializeAttachment({ expires: Number(req.headers.get("x-ci-session-expires")) || 0 });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (route.startsWith("/files/")) return this.serveFile(safeDecode(route.slice("/files/".length)));
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
      canEditShared: ["owner", "editor"].includes(req.headers.get("x-ci-role") ?? ""), // an unknown or missing role can't
      info: () => ({ mode: "cloud", name: decodeURIComponent(req.headers.get("x-ci-workspace-name") ?? "Workspace") }),
      written: (rel, content, version, change, origin) => this.announce(rel, content, version, change, origin),
      moved: (from, to, version, change) => {
        this.broadcast({ type: "removed", path: from });
        this.announce(to, this.files.read(to), version, change);
      },
      removed: (rel, change) => {
        this.broadcast({ type: "removed", path: rel });
        this.broadcast({ type: "change", change });
      },
      tree: () => this.broadcast({ type: "tree" }),
      // Everyone in the workspace (the directory's, in D1): who "me" is on a task. (The Worker answers GET /members itself.)
      members: async () => (await membersOf(this.env, wsId)).map((m) => ({ ...m, you: m.id === user })),
      calendar: this.calendar,
      origin: this.selfOrigin ?? undefined,
      calendarChanged: () => {
        this.broadcast({ type: "calendar" });
        this.ctx.waitUntil(this.schedule());
      },
    };
    return (await handleApi(host, req, route)) ?? json({ error: `No route ${req.method} ${route}` }, 404);
  }

  /** Wake when the next calendar feed is due; with none, don't wake at all. */
  private async schedule() {
    const next = this.calendar.nextSync();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  /** Read the calendar feeds that are due, tell open tabs, and sleep until the next one. */
  async alarm() {
    if (await this.calendar.syncDue()) this.broadcast({ type: "calendar" });
    await this.schedule();
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
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { expires } = (ws.deserializeAttachment() ?? {}) as { expires?: number };
        if (expires && expires < now) ws.close(4001, "Session expired");
        else ws.send(data);
      } catch {}
    }
  }

  /**
   * One MCP request from a connected agent (the Worker has checked its token and membership). Tools
   * are offered by `role`, and writes are attributed to `actor`, e.g. "Claude (via Audrow)". Open
   * tabs hear about the agent's changes like any other. Its "today" is a day in `who.timeZone`.
   */
  async mcp(req: Request, who: { workspace: string; user: string; actor: string; role: string; timeZone: string }): Promise<Response> {
    const role = asRole(who.role);
    const server = createMcpServer({
      quire: new Quire(this.db, this.files, { maxNoteBytes: MAX_NOTE_BYTES, timeZone: who.timeZone }),
      user: who.user,
      source: () => who.actor,
      may: (route) => access(role, ...(route.split(" ") as [string, string])) === "allowed",
      canEditShared: role === "owner" || role === "editor",
      calendar: this.calendar,
      origin: new URL(req.url).origin,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const last = this.quire.changes({ limit: 1 })[0]?.id ?? 0;
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
      const made = this.quire.changes({ since: last, limit: 500 }).reverse();
      for (const c of made) {
        if (c.from_path && c.from_path !== c.path) this.broadcast({ type: "removed", path: c.from_path });
        // Sent to Trash: a tab with it open says so, as when it's deleted in the app.
        if (c.op === "delete") this.broadcast({ type: "removed", path: c.path });
        const content = kindOf(c.path) === "asset" ? null : this.files.read(c.path);
        this.announce(c.path, content, c.version ?? "", c);
      }
      if (made.length) {
        this.broadcast({ type: "tree" });
        this.broadcast({ type: "calendar" }); // a meeting note an agent made is linked to its event
      }
      this.claimIds(who.workspace);
    }
  }

  /** Close the live connections tagged `tag`: a person's (signed out everywhere) or one session's. Their tabs then ask them to sign in. */
  /**
   * Remove a person's own calendars here (of one kind, or all): they disconnected Google, or left or
   * were removed from the workspace.
   */
  async dropCalendarsOf(user: string, kind?: "google") {
    if (this.calendar.dropOwner(user, kind)) {
      this.broadcast({ type: "calendar" });
      await this.schedule();
    }
  }

  disconnect(tag: string) {
    for (const ws of this.ctx.getWebSockets(tag)) ws.close(4001, "Signed out");
  }

  /** The workspace is being deleted: close every tab, delete its uploads from R2 and all its storage. */
  async destroy(wsId: string) {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, "This workspace was deleted");
    await this.ctx.storage.deleteAlarm();
    for (let cursor: string | undefined, more = true; more; ) {
      const page = await this.env.FILES.list({ prefix: `ws/${wsId}/`, cursor });
      if (page.objects.length) await this.env.FILES.delete(page.objects.map((o) => o.key));
      more = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    }
    await this.ctx.storage.deleteAll();
  }

  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
