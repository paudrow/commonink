// One Durable Object per workspace: its notes, full-text index, links and change log in embedded
// SQLite (so every query is in-process), its files in R2, and a WebSocket hub for live updates.
// Only the Worker can reach it, and the Worker has already checked who's asking and their role; it
// checks the role again against the same table, so a slip in the Worker can't open a route.
import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Vault } from "../../src/core/vault.ts";
import { migrate } from "../../src/core/store.ts";
import { errorResponse, handleApi, json, type ApiHost } from "../../src/core/api.ts";
import { cleanPath, fileSecurityHeaders, kindOf, MAX_UPLOAD, mimeOf, VaultError } from "../../src/core/paths.ts";
import type { Change } from "../../src/core/vault.ts";
import { createMcpServer } from "../../src/core/tools.ts";
import { COMMANDS, UsageError, type VaultBytes } from "../../src/core/commands/index.ts";
import type { RunResponse } from "../../src/core/commands/wire.ts";
import { coreExporter } from "../../src/core/export.ts";
import { access, asRole } from "./access.ts";
import { DoDb, SqlContent } from "./do-store.ts";
import { SEED_FILES, SEED_NOTES } from "./seed.ts";
import { membersOf } from "./admin.ts";
import type { Env } from "./env.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { AGENTS_NOTE } from "../../src/core/noteRoles.ts";
import { accessOn, type SharedAccess, type ShareRole } from "./grants.ts";
import { readUpTo } from "./body.ts";
import { limit } from "./limits.ts";
import { addShare, agentLinksAllowed, linkToken, listShares, removeShare, ShareError, updateShare, type Share, type Target } from "./shares.ts";
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
  private vault: Vault;
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
    this.vault = new Vault(db, this.files, { maxNoteBytes: MAX_NOTE_BYTES });
    // Notes only change through the core here, so this finds nothing to do, except after an
    // upgrade that asks for notes to be indexed again (tags, say).
    this.vault.sync();
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
          else if (owner.has(id) && this.vault.pathOf(id)) {
            this.vault.reassignId(id);
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
      const rel = this.vault.resolve(url.searchParams.get("target") ?? "", url.searchParams.get("from") ?? undefined);
      if (!rel || kindOf(rel) !== "asset") return json({ error: "Not found" }, 404);
      return new Response(null, { status: 302, headers: { Location: `${base}/files/${rel.split("/").map(encodeURIComponent).join("/")}` } });
    }

    const host: ApiHost = {
      vault: this.vault,
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
      fileBytes: (rel) => this.fileBytes(rel),
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
    for (const [rel, text] of Object.entries(SEED_NOTES)) this.vault.create(rel, text, "Common Ink");
    this.vault.sync();
  }

  /** Store an uploaded file in R2 and list it in this workspace (assets/ by default, under a free name). */
  private async upload(req: Request, url: URL, wsId: string, actor: string): Promise<Response> {
    try {
      const name = url.searchParams.get("name") ?? "";
      const folder = url.searchParams.get("folder") ?? "assets";
      const body = await readUpTo(req, MAX_UPLOAD);
      if (!body) return json({ error: "That file is over 50 MB" }, 413);
      const { rel, r } = await this.storeFile(wsId, this.vault.uploadPath(name, folder), body, actor, () => this.vault.uploadPath(name, folder));
      this.announce(rel, null, r.version, r.change);
      this.broadcast({ type: "tree" });
      return json({ path: rel, version: r.version, size: r.size });
    } catch (e) {
      return errorResponse(e);
    }
  }

  /** A new file's bytes into R2, listed at `rel` (or `again()`, if that was taken while they were stored), and logged. */
  private async storeFile(wsId: string, rel: string, bytes: Uint8Array, source: string, again = () => rel) {
    const mime = mimeOf(rel)!;
    const key = `ws/${wsId}/${crypto.randomUUID()}`;
    await this.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
    if (this.files.stat(rel)) rel = again();
    this.files.putBlob(rel, key, bytes.byteLength, mime);
    return { rel, r: this.vault.recordUpload(rel, false, source) };
  }

  /** Files' bytes for commands that move them (the CLI's upload and download): assets from R2, notes as text. */
  private vaultBytes(wsId: string): VaultBytes {
    return {
      read: async (rel) => {
        const blob = this.files.blob(rel)?.blob;
        if (blob) {
          const obj = await this.env.FILES.get(blob);
          return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
        }
        const text = this.files.read(rel);
        return text === null ? null : new TextEncoder().encode(text);
      },
      add: async (rel, bytes, source) => {
        if (bytes.byteLength > MAX_UPLOAD) throw new VaultError(`${rel} is over 50 MB`);
        await this.storeFile(wsId, rel, bytes, source);
      },
    };
  }

  /** An uploaded file's bytes, from R2. */
  private async fileBytes(rel: string): Promise<Uint8Array | null> {
    const key = this.files.blob(rel)?.blob;
    const obj = key ? await this.env.FILES.get(key) : null;
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
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
    const path = id ? this.vault.pathOf(id) : null;
    const meta = path ? this.vault.meta(path) : null;
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
        // Tagged "shared" when grants decide what it hears, so any change to sharing can close it.
        const tags = [user || "link", `s:${req.headers.get("x-ci-session") ?? ""}`, ...("grants" in access ? ["shared"] : [])];
        this.ctx.acceptWebSocket(server, tags);
        server.serializeAttachment({ expires: Number(req.headers.get("x-ci-session-expires")) || 0, share: access });
        return new Response(null, { status: 101, webSocket: client });
      }
      if (route.startsWith("/files/") && req.method === "GET") {
        const rel = cleanPath(safeDecode(route.slice("/files/".length)));
        const meta = this.vault.meta(rel);
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
          const r = this.vault.save(hit.meta.path, b.content, { baseVersion: typeof b.baseVersion === "string" ? b.baseVersion : undefined, source: actor });
          if (r.change) this.announce(hit.meta.path, b.content, r.version, r.change);
          return json({ version: r.version });
        }
        // What a shared note links or embeds: its details if that's visible too, else only that it isn't.
        case "GET /resolve":
        case "GET /file-resolve": {
          const from = this.visibleNote(access, q("from"));
          if (!from) return notFound();
          const rel = this.vault.resolve(q("target"), from.meta.path);
          const meta = rel ? this.vault.meta(rel) : null;
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
    return this.vault
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
        return json(await this.describeShares(wsId, target, ["owner", "editor"].includes(req.headers.get("x-ci-role") ?? "")));
      }
      case "POST /shares": {
        const tooMany = await limit(this.env.DB, "share", user);
        if (tooMany) return tooMany;
        const target = this.shareTarget({ note: str("note"), path: str("path"), folder: str("folder") })!;
        const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : null;
        if (!role) throw new ShareError('"role" must be "viewer" or "editor"');
        this.refuseEditingAgentsNote(target, role);
        const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : null;
        await addShare(this.env.DB, this.env.SESSION_SECRET, { workspaceId: wsId, by: user, target, email: str("email"), link: body.link === true, role, expiresAt, viaAgent: false });
        this.sharingChanged();
        return json(await this.describeShares(wsId, target, true));
      }
      case "POST /shares/update": {
        const role = body.role === "editor" || body.role === "viewer" ? body.role : undefined;
        const expiresAt = body.expiresAt === null || typeof body.expiresAt === "number" ? (body.expiresAt as number | null) : undefined;
        const share = role === "editor" ? (await listShares(this.env.DB, wsId)).find((s) => s.id === str("id")) : undefined;
        if (share?.note) this.refuseEditingAgentsNote({ note: share.note }, role);
        await updateShare(this.env.DB, wsId, str("id") ?? "", { role, expiresAt });
        this.sharingChanged();
        return json({ ok: true });
      }
      case "POST /shares/remove":
        await removeShare(this.env.DB, wsId, str("id") ?? "");
        this.sharingChanged();
        return json({ ok: true });
    }
    return json({ error: `No route ${req.method} ${route}` }, 404);
  }

  /** Every member's agent follows AGENTS.md, so no one outside the workspace may edit it. */
  private refuseEditingAgentsNote(target: Target, role: ShareRole | undefined) {
    if (role === "editor" && target.note && this.vault.pathOf(target.note) === AGENTS_NOTE) {
      throw new ShareError(`${AGENTS_NOTE} can't be shared for editing: every connected agent follows it. Share it as a viewer.`);
    }
  }

  /** The note (by ID or path) or folder a share request is about; none for a GET of everything. */
  private shareTarget(o: { note?: string; path?: string; folder?: string }, optional = false): Target | undefined {
    // "Projects/" is the folder "Projects": grants match notes under `${folder}/`.
    if (o.folder) return { folder: cleanPath(o.folder).replace(/\/+$/, "") };
    const target = o.note ?? o.path;
    if (!target) {
      if (optional) return undefined;
      throw new ShareError("Say which note (or folder) to share");
    }
    const rel = this.vault.pathOf(target) ?? this.vault.resolve(target);
    const id = rel ? this.vault.meta(rel)?.id : null;
    if (!id) throw new ShareError(`No note matches "${target}"`, 404);
    return { note: id };
  }

  /**
   * The MCP sharing tools, for an agent working as `user` (its role already decided which it gets).
   * It sees links' URLs only if it could make a link itself: a URL hands out the link, as making one does.
   */
  private agentSharing(wsId: string, user: string, origin: string, canManage: boolean) {
    const line = (s: Share & { url: string | null }) =>
      `- ${s.kind === "link" ? `Anyone with the link${s.url ? `: ${origin}${s.url}` : ""}` : `${s.name ? `${s.name} <${s.email}>` : `${s.email} (by email)`}`} — ${s.role}${s.expiresAt ? `, until ${new Date(s.expiresAt).toISOString().slice(0, 10)}` : ""} (id ${s.id})`;
    const describe = async (target: Target | undefined) => {
      const d = await this.describeShares(wsId, target, canManage && (await agentLinksAllowed(this.env.DB, wsId)));
      const what = d.path ?? (target?.folder ? `${target.folder}/` : "this workspace");
      if (!d.shares.length && !d.inherited.length) return `${what} isn't shared with anyone outside the workspace.`;
      return [`${what} is shared with:`, ...d.shares.map(line), ...(d.inherited.length ? ["Through its folders:", ...d.inherited.map(line)] : [])].join("\n");
    };
    // A refusal reaches the agent or the CLI as its message, with the code it would have in the app.
    const refusing = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ShareError) throw new VaultError(e.message, ({ 403: "forbidden", 404: "not_found", 409: "conflict" } as const)[e.status as 403] ?? "invalid");
        if (e instanceof VaultError) throw e;
        throw new VaultError((e as Error).message);
      }
    };
    return {
      list: (o: { path?: string; folder?: string }) => refusing(async () => describe(this.shareTarget({ path: o.path, folder: o.folder }, true))),
      share: (o: { path?: string; folder?: string; email?: string; link?: boolean; role: ShareRole; expiresInDays?: number }) => refusing(async () => {
        const tooMany = await limit(this.env.DB, "share", user);
        if (tooMany) throw new Error(((await tooMany.json()) as { error: string }).error);
        const target = this.shareTarget({ path: o.path, folder: o.folder })!;
        this.refuseEditingAgentsNote(target, o.role);
        await addShare(this.env.DB, this.env.SESSION_SECRET, {
          workspaceId: wsId,
          by: user,
          target,
          email: o.email,
          link: o.link === true,
          role: o.role,
          expiresAt: o.expiresInDays ? Date.now() + o.expiresInDays * 86_400_000 : null,
          viaAgent: true,
        });
        this.sharingChanged();
        return describe(target);
      }),
      unshare: (id: string) => refusing(async () => {
        await removeShare(this.env.DB, wsId, id);
        this.sharingChanged();
        return "Stopped sharing it.";
      }),
    };
  }

  /**
   * A note's (or folder's) shares and the folder shares it gets too. Each link's URL is its token,
   * which lets anyone join with the link's role, so only those who may change sharing get it.
   */
  private async describeShares(wsId: string, target: Target | undefined, withUrls: boolean) {
    const all = await listShares(this.env.DB, wsId);
    const path = target?.note ? this.vault.pathOf(target.note) : null;
    const direct = target ? all.filter((s) => (target.note ? s.note === target.note : s.folder === target.folder)) : all;
    const inherited = path ? all.filter((s) => s.folder && path.startsWith(`${s.folder}/`)) : [];
    const withLinks = async (list: Share[]) =>
      Promise.all(list.map(async (s) => ({ ...s, url: withUrls && s.kind === "link" ? `/s/${await linkToken(this.env.SESSION_SECRET, s.id)}` : null })));
    return { target: target ?? null, path, shares: await withLinks(direct), inherited: await withLinks(inherited) };
  }

  /**
   * Sharing changed, and an open shared connection still hears by the grants it opened with. Close
   * them all; each reconnects with what's shared with it now, or is refused. (The Worker calls it
   * too, when someone leaves and what was shared with them goes.)
   */
  sharingChanged() {
    for (const ws of this.ctx.getWebSockets("shared")) ws.close(4003, "Sharing changed");
  }

  private announce(rel: string, content: string | null, version: string, change: Change | null, origin?: string) {
    this.broadcast({ type: "note", path: rel, kind: kindOf(rel), version, content, source: change?.source ?? "external", change, origin });
    if (change) this.broadcast({ type: "change", change });
  }

  /** Whether a connection opened through a share may hear this: only about notes it can see. */
  private mayHear(share: SharedAccess, msg: Record<string, unknown>) {
    if (msg.type === "tree") return true; // says only that something changed
    const path = (msg.type === "change" ? (msg.change as Change | undefined)?.path : msg.path) as string | undefined;
    const meta = path ? this.vault.meta(path) : null;
    return !!meta && !!accessOn(share, meta);
  }

  private broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { expires, share } = (ws.deserializeAttachment() ?? {}) as { expires?: number; share?: SharedAccess };
        if (expires && expires < now) ws.close(4001, "Session expired");
        else if (share && "grants" in share && share.grants.some((g) => g.expiresAt && g.expiresAt < now)) ws.close(4003, "Sharing changed");
        else if (!share || this.mayHear(share, msg)) ws.send(data);
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
      vault: new Vault(this.db, this.files, { maxNoteBytes: MAX_NOTE_BYTES, timeZone: who.timeZone }),
      user: who.user,
      source: () => who.actor,
      may: (route) => access(role, ...(route.split(" ") as [string, string])) === "allowed",
      canEditShared: role === "owner" || role === "editor",
      sharing: this.agentSharing(who.workspace, who.user, new URL(req.url).origin, role === "owner" || role === "editor"),
      members: () => membersOf(this.env, who.workspace),
      calendar: this.calendar,
      origin: new URL(req.url).origin,
      // Markdown and .zip; a web page and Word are drawn by the app (Share → Export as).
      exporter: coreExporter({ vault: this.vault, bytes: (rel) => this.fileBytes(rel), origin: new URL(req.url).origin }),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const last = this.lastChange();
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
      this.announceSince(last);
      this.claimIds(who.workspace);
    }
  }

  /**
   * One command from someone's CLI (`commonink login`; see COMMANDS). The Worker has checked their token,
   * that they're a member and that their role allows the command's route; the role is checked again
   * here, as for every route. Open tabs hear about its changes like any other.
   */
  async runCommand(name: string, input: Record<string, unknown>, who: { workspace: string; user: string; actor: string; role: string; timeZone: string; origin?: string }): Promise<RunResponse> {
    const command = COMMANDS.find((c) => c.cli === name);
    // The Worker runs settings commands itself (cloud/src/cli.ts): they aren't in a workspace's notes.
    if (!command || command.settings) return { ok: false, error: `No command "${name}" here: see commonink help`, code: "usage" };
    const role = asRole(who.role);
    if (access(role, ...(command.route.split(" ") as [string, string])) !== "allowed") {
      return { ok: false, error: role === "viewer" ? "You can view this workspace but not edit it" : "Only the workspace's owner can do that", code: "forbidden" };
    }
    const last = this.lastChange();
    try {
      // Its "today" is a day in the person's time zone, as an agent's is.
      const vault = new Vault(this.db, this.files, { maxNoteBytes: MAX_NOTE_BYTES, timeZone: who.timeZone });
      if (command.readOnly) vault.sync();
      const host = {
        vault,
        user: who.user,
        source: who.actor,
        canEditShared: role === "owner" || role === "editor",
        bytes: this.vaultBytes(who.workspace),
        calendar: this.calendar,
        origin: who.origin,
        members: () => membersOf(this.env, who.workspace),
        // As an agent's: a command can't tell a person from an agent, so the workspace's agent setting holds.
        sharing: who.origin ? this.agentSharing(who.workspace, who.user, who.origin, role === "owner" || role === "editor") : undefined,
        // Markdown and .zip, as over MCP; a web page and Word are drawn by the app (Share → Export as).
        exporter: who.origin ? coreExporter({ vault, bytes: (rel) => this.fileBytes(rel), origin: who.origin }) : undefined,
      };
      return { ok: true, ...(await command.run(host, input as never)) };
    } catch (e) {
      if (e instanceof VaultError) return { ok: false, error: e.message, code: e.code };
      if (e instanceof UsageError) return { ok: false, error: e.message, code: "usage" };
      throw e;
    } finally {
      this.announceSince(last);
      this.claimIds(who.workspace);
    }
  }

  private lastChange = () => this.vault.changes({ limit: 1 })[0]?.id ?? 0;

  /** Tell open tabs about every change since change `last`: what an agent or a CLI did in one go. */
  private announceSince(last: number) {
    const made = this.vault.changes({ since: last, limit: 500 }).reverse();
    for (const c of made) {
      if (c.from_path && c.from_path !== c.path) this.broadcast({ type: "removed", path: c.from_path });
      // Sent to Trash: a tab with it open says so, as when it's deleted in the app.
      if (c.op === "delete") this.broadcast({ type: "removed", path: c.path });
      const content = kindOf(c.path) === "asset" ? null : this.files.read(c.path);
      this.announce(c.path, content, c.version ?? "", c);
    }
    if (made.length) {
      this.broadcast({ type: "tree" });
      this.broadcast({ type: "calendar" }); // a meeting note made here is linked to its event
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

/** A share request's error as a response: ShareError has its own status; anything else is a plain 500. */
function shareErrorResponse(e: unknown): Response {
  if (e instanceof ShareError) return json({ error: e.message }, e.status);
  if (e instanceof VaultError) return errorResponse(e);
  console.error(e);
  return json({ error: "Internal error" }, 500);
}
