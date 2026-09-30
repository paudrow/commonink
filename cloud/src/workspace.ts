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
import type { Env } from "./env.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { QuireError } from "../../src/core/paths.ts";
import { accessOn, type SharedAccess, type ShareRole } from "./grants.ts";
import { limit } from "./limits.ts";
import { addShare, linkToken, listShares, removeShare, ShareError, updateShare, type Share, type Target } from "./shares.ts";

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
    // An upload's bytes go from R2 once it's deleted for good.
    this.files = new SqlContent(db, (key) => ctx.waitUntil(env.FILES.delete(key)));
    // A note and its previous text are each a SQLite row here, which holds at most 2 MB.
    this.quire = new Quire(db, this.files, { maxNoteBytes: 1_900_000 });
    // Notes only change through the core here, so this finds nothing to do, except after an
    // upgrade that asks for notes to be indexed again (tags, say).
    this.quire.sync();
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const wsId = req.headers.get("x-ci-workspace")!;
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

    // What's shared with people outside the workspace (and link visitors): checked note by note.
    if (route.startsWith("/shared/")) return this.shared(req, url, route.slice("/shared".length), user);

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
    if (route === "/shares" || route.startsWith("/shares/")) return this.manageShares(req, url, route, wsId, user).catch(shareErrorResponse);
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

  // ---------------------------------------------------------------- sharing

  /** Who a shared-route request is, as the Worker worked out: a member, or the grants that reach them. */
  private sharedAccess(req: Request): SharedAccess {
    return JSON.parse(req.headers.get("x-ci-share") ?? '{"grants":[],"write":false}') as SharedAccess;
  }

  /** A note's meta and the role this request has on it; null for no note and for no access alike. */
  private visibleNote(access: SharedAccess, id: string | null | undefined) {
    const path = id ? this.quire.pathOf(id) : null;
    const meta = path ? this.quire.meta(path) : null;
    const role = meta ? accessOn(access, meta) : null;
    return meta && role ? { meta, role } : null;
  }

  /**
   * The routes for what's shared: a note by its ID, what it links or embeds (only if that's visible
   * too, and never its title otherwise), its files, and live updates for it. Nothing else of the
   * workspace is reachable this way: search, tasks, History and the rest stay members-only.
   */
  private async shared(req: Request, url: URL, route: string, user: string): Promise<Response> {
    const access = this.sharedAccess(req);
    const base = req.headers.get("x-ci-base") ?? "";
    const q = (k: string) => url.searchParams.get(k) ?? "";
    const notFound = () => json({ error: "That note doesn't exist, or it isn't shared with you" }, 404);
    const entry = (meta: { id: string; path: string; title: string; kind: string; version: string }, role: ShareRole) => ({ id: meta.id, path: meta.path, title: meta.title, kind: meta.kind, version: meta.version, role });
    try {
      if (route === "/live") {
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server, [user || "link", `s:${req.headers.get("x-ci-session") ?? ""}`]);
        server.serializeAttachment({ expires: Number(req.headers.get("x-ci-session-expires")) || 0, share: access });
        return new Response(null, { status: 101, webSocket: client });
      }
      if (route.startsWith("/files/") && req.method === "GET") {
        const rel = cleanPath(safeDecode(route.slice("/files/".length)));
        const meta = this.quire.meta(rel);
        return meta && accessOn(access, meta) ? this.serveFile(rel) : notFound();
      }
      switch (`${req.method} ${route}`) {
        case "GET /list":
          return json(this.sharedList(access));
        case "GET /note": {
          const hit = this.visibleNote(access, q("id"));
          if (!hit) return notFound();
          return json({ ...entry(hit.meta, hit.role), content: hit.meta.kind === "asset" ? null : this.files.read(hit.meta.path) });
        }
        case "PUT /note": {
          const b = (await req.json().catch(() => ({}))) as { id?: unknown; content?: unknown; baseVersion?: unknown };
          const hit = this.visibleNote(access, typeof b.id === "string" ? b.id : null);
          if (!hit) return notFound();
          if (hit.role !== "editor") return json({ error: "You can view this note but not edit it" }, 403);
          if (typeof b.content !== "string") return json({ error: '"content" must be a string' }, 400);
          const actor = decodeURIComponent(req.headers.get("x-ci-actor") ?? "someone");
          const r = this.quire.save(hit.meta.path, b.content, { baseVersion: typeof b.baseVersion === "string" ? b.baseVersion : undefined, source: actor });
          if (r.change) this.announce(hit.meta.path, b.content, r.version, r.change);
          return json({ version: r.version });
        }
        // What a shared note links or embeds: its details if that's visible too, else only that it isn't.
        case "GET /resolve":
        case "GET /file-resolve": {
          const from = this.visibleNote(access, q("from"));
          if (!from) return notFound();
          const rel = this.quire.resolve(q("target"), from.meta.path);
          const meta = rel ? this.quire.meta(rel) : null;
          const role = meta ? accessOn(access, meta) : null;
          if (route === "/file-resolve") {
            if (!meta || !role || meta.kind !== "asset") return notFound();
            return new Response(null, { status: 302, headers: { Location: `${base}/files/${meta.path.split("/").map(encodeURIComponent).join("/")}` } });
          }
          return json(meta && role ? entry(meta, role) : { noAccess: true });
        }
      }
      return json({ error: `No route ${req.method} ${route}` }, 404);
    } catch (e) {
      return errorResponse(e);
    }
  }

  /** Every note these grants reach (or everything, for a member), by title. */
  sharedList(access: SharedAccess) {
    return this.quire
      .list(undefined, "all")
      .flatMap((m) => {
        const role = accessOn(access, m);
        return role ? [{ id: m.id, path: m.path, title: m.title, kind: m.kind, version: m.version, role }] : [];
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Members sharing a note or folder, and seeing what's shared (`/shares…`, roles in access.ts). */
  private async manageShares(req: Request, url: URL, route: string, wsId: string, user: string): Promise<Response> {
    const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    switch (`${req.method} ${route}`) {
      case "GET /shares": {
        const target = this.shareTarget({ note: url.searchParams.get("note") ?? undefined, path: url.searchParams.get("path") ?? undefined, folder: url.searchParams.get("folder") ?? undefined }, true);
        return json(await this.describeShares(wsId, target));
      }
      case "POST /shares": {
        const tooMany = await limit(this.env.DB, "share", user);
        if (tooMany) return tooMany;
        const target = this.shareTarget({ note: str("note"), path: str("path"), folder: str("folder") })!;
        const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : null;
        if (!role) throw new ShareError('"role" must be "viewer" or "editor"');
        const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : null;
        await addShare(this.env.DB, this.env.SESSION_SECRET, { workspaceId: wsId, by: user, target, email: str("email"), link: body.link === true, role, expiresAt });
        return json(await this.describeShares(wsId, target));
      }
      case "POST /shares/update": {
        const role = body.role === "editor" || body.role === "viewer" ? body.role : undefined;
        const expiresAt = body.expiresAt === null || typeof body.expiresAt === "number" ? (body.expiresAt as number | null) : undefined;
        await updateShare(this.env.DB, wsId, str("id") ?? "", { role, expiresAt });
        return json({ ok: true });
      }
      case "POST /shares/remove":
        await removeShare(this.env.DB, wsId, str("id") ?? "");
        return json({ ok: true });
    }
    return json({ error: `No route ${req.method} ${route}` }, 404);
  }

  /** The note (by ID or path) or folder a share request is about; none for a GET of everything. */
  private shareTarget(o: { note?: string; path?: string; folder?: string }, optional = false): Target | undefined {
    if (o.folder) return { folder: cleanPath(o.folder) };
    const target = o.note ?? o.path;
    if (!target) {
      if (optional) return undefined;
      throw new ShareError("Say which note (or folder) to share");
    }
    const rel = this.quire.pathOf(target) ?? this.quire.resolve(target);
    const id = rel ? this.quire.meta(rel)?.id : null;
    if (!id) throw new ShareError(`No note matches "${target}"`, 404);
    return { note: id };
  }

  /** The MCP sharing tools, for an agent working as `user` (its role already decided which it gets). */
  private agentSharing(wsId: string, user: string, origin: string) {
    const line = (s: Share & { url: string | null }) =>
      `- ${s.kind === "link" ? `Anyone with the link: ${origin}${s.url}` : `${s.name ? `${s.name} <${s.email}>` : `${s.email} (by email)`}`} — ${s.role}${s.expiresAt ? `, until ${new Date(s.expiresAt).toISOString().slice(0, 10)}` : ""} (id ${s.id})`;
    const describe = async (target: Target | undefined) => {
      const d = await this.describeShares(wsId, target);
      const what = d.path ?? (target?.folder ? `${target.folder}/` : "this workspace");
      if (!d.shares.length && !d.inherited.length) return `${what} isn't shared with anyone outside the workspace.`;
      return [`${what} is shared with:`, ...d.shares.map(line), ...(d.inherited.length ? ["Through its folders:", ...d.inherited.map(line)] : [])].join("\n");
    };
    return {
      list: async (o: { path?: string; folder?: string }) => describe(this.shareTarget({ path: o.path, folder: o.folder }, true)),
      share: async (o: { path?: string; folder?: string; email?: string; link?: boolean; role: ShareRole; expiresInDays?: number }) => {
        const tooMany = await limit(this.env.DB, "share", user);
        if (tooMany) throw new Error(((await tooMany.json()) as { error: string }).error);
        const target = this.shareTarget({ path: o.path, folder: o.folder })!;
        await addShare(this.env.DB, this.env.SESSION_SECRET, {
          workspaceId: wsId,
          by: user,
          target,
          email: o.email,
          link: o.link === true,
          role: o.role,
          expiresAt: o.expiresInDays ? Date.now() + o.expiresInDays * 86_400_000 : null,
        });
        return describe(target);
      },
      unshare: async (id: string) => (await removeShare(this.env.DB, wsId, id), "Stopped sharing it."),
    };
  }

  /** A note's (or folder's) shares, the folder shares it gets too, and each link's URL. */
  private async describeShares(wsId: string, target: Target | undefined) {
    const all = await listShares(this.env.DB, wsId);
    const path = target?.note ? this.quire.pathOf(target.note) : null;
    const direct = target ? all.filter((s) => (target.note ? s.note === target.note : s.folder === target.folder)) : all;
    const inherited = path ? all.filter((s) => s.folder && path.startsWith(`${s.folder}/`)) : [];
    const withLinks = async (list: Share[]) =>
      Promise.all(list.map(async (s) => ({ ...s, url: s.kind === "link" ? `/s/${await linkToken(this.env.SESSION_SECRET, s.id)}` : null })));
    return { target: target ?? null, path, shares: await withLinks(direct), inherited: await withLinks(inherited) };
  }

  private announce(rel: string, content: string | null, version: string, change: Change | null, origin?: string) {
    this.broadcast({ type: "note", path: rel, kind: kindOf(rel), version, content, source: change?.source ?? "external", change, origin });
    if (change) this.broadcast({ type: "change", change });
  }

  /** Whether a connection opened through a share may hear this: only about notes it can see. */
  private mayHear(share: SharedAccess, msg: Record<string, unknown>) {
    if (msg.type === "tree") return true; // says only that something changed
    const path = (msg.type === "change" ? (msg.change as Change | undefined)?.path : msg.path) as string | undefined;
    const meta = path ? this.quire.meta(path) : null;
    return !!meta && !!accessOn(share, meta);
  }

  private broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { expires, share } = (ws.deserializeAttachment() ?? {}) as { expires?: number; share?: SharedAccess };
        if (expires && expires < now) ws.close(4001, "Session expired");
        else if (!share || this.mayHear(share, msg)) ws.send(data);
      } catch {}
    }
  }

  /**
   * One MCP request from a connected agent (the Worker has checked its token and membership). Tools
   * are offered by `role`, and writes are attributed to `actor`, e.g. "Claude (via Audrow)". Open
   * tabs hear about the agent's changes like any other.
   */
  async mcp(req: Request, who: { workspace: string; user: string; actor: string; role: string }): Promise<Response> {
    const role = asRole(who.role);
    const server = createMcpServer({
      quire: this.quire,
      user: who.user,
      source: () => who.actor,
      may: (route) => access(role, ...(route.split(" ") as [string, string])) === "allowed",
      canEditShared: role === "owner" || role === "editor",
      sharing: this.agentSharing(who.workspace, who.user, new URL(req.url).origin),
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
        const content = kindOf(c.path) === "asset" ? null : this.files.read(c.path);
        this.announce(c.path, content, c.version ?? "", c);
      }
      if (made.length) this.broadcast({ type: "tree" });
      this.claimIds(who.workspace);
    }
  }

  /** Close the live connections tagged `tag`: a person's (signed out everywhere) or one session's. Their tabs then ask them to sign in. */
  disconnect(tag: string) {
    for (const ws of this.ctx.getWebSockets(tag)) ws.close(4001, "Signed out");
  }

  /** The workspace is being deleted: close every tab, delete its uploads from R2 and all its storage. */
  async destroy(wsId: string) {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, "This workspace was deleted");
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

/** A share request's error as a response: ShareError has its own status; anything else is a plain 500. */
function shareErrorResponse(e: unknown): Response {
  if (e instanceof ShareError) return json({ error: e.message }, e.status);
  if (e instanceof QuireError) return errorResponse(e);
  console.error(e);
  return json({ error: "Internal error" }, 500);
}
