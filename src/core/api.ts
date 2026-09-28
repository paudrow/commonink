// The note API, written against the web-standard Request/Response so the same routes run in the
// local Node server and in a Cloudflare workspace Durable Object.
import { cleanPath, QuireError } from "./paths.ts";
import type { ArchiveScope, Change, Quire } from "./quire.ts";

export interface ApiHost {
  quire: Quire;
  /** Who changes made through this request are attributed to ("you" locally, a person's name online). */
  actor: string;
  info(): Record<string, unknown>;
  /** A note's text changed through the API: tell connected clients. */
  written(rel: string, content: string | null, version: string, change: Change | null, origin?: string): void;
  /** A note moved (renamed, archived, unarchived). */
  moved(from: string, to: string, version: string, change: Change | null): void;
  /** The set of notes changed. */
  tree(): void;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function errorResponse(e: unknown): Response {
  if (e instanceof QuireError) {
    const status = { not_found: 404, conflict: 409, exists: 409, invalid: 400 }[e.code];
    return json({ error: e.message, code: e.code, ...e.data }, status);
  }
  console.error(e);
  return json({ error: "Internal error" }, 500);
}

/** Handle one API route (`route` is the path after the API base, e.g. "/note"). Null if it isn't a note route. */
export async function handleApi(host: ApiHost, req: Request, route: string): Promise<Response | null> {
  try {
    return await dispatch(host, req, route);
  } catch (e) {
    return errorResponse(e);
  }
}

async function dispatch(host: ApiHost, req: Request, route: string): Promise<Response | null> {
  const { quire, actor } = host;
  const url = new URL(req.url);
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const body: any = req.method === "GET" || req.method === "HEAD" ? {} : await req.json().catch(() => {
    throw new QuireError("Invalid JSON");
  });

  const moveAll = (paths: string[], fn: (p: string) => ReturnType<Quire["move"]>) => {
    const moved = paths.map((p) => {
      const r = fn(p);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.moved(r.from, r.path, r.version, r.change);
      return { from: r.from, to: r.path };
    });
    host.tree();
    return json({ moved });
  };

  switch (`${req.method} ${route}`) {
    case "GET /info":
      return json(host.info());
    case "GET /notes":
      return json(quire.list(undefined, "all")); // the UI hides archived notes itself
    case "GET /note":
      return json(quire.read(q("path")));
    case "GET /resolve":
      return json({ path: quire.resolve(q("target"), q("from") || undefined) });
    case "GET /search":
      return json(quire.search(q("q"), Number(q("limit")) || 30, (q("scope") || "active") as ArchiveScope));
    case "GET /feed":
      return json(
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
    case "GET /backlinks":
      return json(quire.backlinks(q("path")));
    case "GET /changes":
      return json(quire.changes({ limit: Number(q("limit")) || 50 }));
    case "GET /tasks":
      return json(quire.tasks({ folder: q("folder") || undefined, note: q("note") || undefined }));
    case "GET /diff":
      return json(quire.diff(Number(q("from")), Number(q("to") || q("from"))));

    case "PUT /note": {
      const rel = cleanPath(body.path);
      const content = String(body.content ?? "");
      // Never let a client blank out a note by accident (e.g. a stale tab whose editor failed to load).
      if (!content.trim() && !body.allowEmpty && quire.files.read(rel)?.trim()) {
        return json({ error: `Refusing to replace ${rel} with an empty note`, code: "empty" }, 422);
      }
      const isNew = !quire.files.stat(rel);
      const r = quire.save(rel, content, { baseVersion: body.baseVersion, source: actor });
      host.written(rel, content, r.version, r.change, body.clientId);
      if (isNew) host.tree();
      return json({ path: rel, version: r.version });
    }
    case "POST /note": {
      const content = String(body.content ?? "");
      const r = quire.create(body.path, content, actor);
      host.written(r.path, content, r.version, r.change);
      host.tree();
      return json({ path: r.path, version: r.version });
    }
    case "POST /tasks/set": {
      const r = quire.setTask(String(body.path), Number(body.line), String(body.text), !!body.done, actor);
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version });
    }
    case "POST /move": {
      const r = quire.move(body.from, body.to, actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.moved(r.from, r.path, r.version, r.change);
      host.tree();
      return json({ path: r.path, updated: r.updated });
    }
    case "POST /restore": {
      const r = quire.restore(Number(body.id), actor);
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null }); // restoring `change` undoes this
    }
    case "POST /archive":
      return moveAll(Array.isArray(body.paths) ? body.paths : [], (p) => quire.archive(p, actor));
    case "POST /unarchive":
      return moveAll(Array.isArray(body.paths) ? body.paths : [], (p) => quire.unarchive(p, actor));
  }
  return null;
}
