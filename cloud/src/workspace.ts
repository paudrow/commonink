// One Durable Object per workspace: its notes, full-text index, links and change log in embedded
// SQLite (so every query is in-process), its files in R2, and a WebSocket hub for live updates.
// Only the Worker can reach it, and the Worker has already checked who's asking and their role.
import { DurableObject } from "cloudflare:workers";
import { Quire } from "../../src/core/quire.ts";
import { migrate } from "../../src/core/store.ts";
import { handleApi, json, type ApiHost } from "../../src/core/api.ts";
import { cleanPath, kindOf } from "../../src/core/paths.ts";
import type { Change } from "../../src/core/quire.ts";
import { DoDb, SqlContent } from "./do-store.ts";
import { SEED_FILES, SEED_NOTES } from "./seed.ts";
import type { Env } from "./env.ts";

export class Workspace extends DurableObject<Env> {
  private files: SqlContent;
  private quire: Quire;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = new DoDb(ctx.storage);
    migrate(db);
    this.files = new SqlContent(db);
    this.quire = new Quire(db, this.files);
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = url.pathname;
    const wsId = req.headers.get("x-ci-workspace")!;
    const base = `/api/w/${wsId}`;

    if (route === "/live") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (route === "/seed" && req.method === "POST") {
      await this.seed(wsId);
      return json({ ok: true });
    }
    if (route.startsWith("/files/")) return this.serveFile(decodeURIComponent(route.slice("/files/".length)));
    if (route === "/file-resolve") {
      const rel = this.quire.resolve(url.searchParams.get("target") ?? "", url.searchParams.get("from") ?? undefined);
      if (!rel || kindOf(rel) !== "asset") return json({ error: "Not found" }, 404);
      return new Response(null, { status: 302, headers: { Location: `${base}/files/${rel.split("/").map(encodeURIComponent).join("/")}` } });
    }

    const host: ApiHost = {
      quire: this.quire,
      actor: decodeURIComponent(req.headers.get("x-ci-actor") ?? "someone"),
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
  private async seed(wsId: string) {
    if (!this.files.isEmpty) return;
    for (const [rel, { text, mime }] of Object.entries(SEED_FILES)) {
      const key = `ws/${wsId}/${crypto.randomUUID()}`;
      await this.env.FILES.put(key, text, { httpMetadata: { contentType: mime } });
      this.files.putBlob(rel, key, new TextEncoder().encode(text).length, mime);
    }
    for (const [rel, text] of Object.entries(SEED_NOTES)) this.quire.create(rel, text, "Common Ink");
    this.quire.sync();
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
        // Files are writable by agents and teammates: never let one run script in our origin.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'",
        "X-Content-Type-Options": "nosniff",
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

  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
