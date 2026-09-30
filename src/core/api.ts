// The note API, written against the web-standard Request/Response so the same routes run in the
// local Node server and in a Cloudflare workspace Durable Object.
import { cleanPath, QuireError } from "./paths.ts";
import type { ArchiveScope, Change, Quire } from "./quire.ts";
import type { TaskPatch } from "./tasks.ts";
import { agentSource, parseAuthorFilter } from "./actor.ts";
import { findStartNote, GUIDE, parseGuideAction, runGuide } from "./guide.ts";

export interface ApiHost {
  quire: Quire;
  /** Who changes made through this request are attributed to ("you" locally, a person's name online). */
  actor: string;
  /** Whose favorites and personal smart folders this request reads and changes (the vault's one person locally, a user ID online). */
  user: string;
  /** May this person change what the whole workspace shares, like shared smart folders? Everyone locally; not viewers online. */
  canEditShared: boolean;
  info(): Record<string, unknown>;
  /** A note's text changed through the API: tell connected clients. */
  written(rel: string, content: string | null, version: string, change: Change | null, origin?: string): void;
  /** A note moved (renamed, archived, unarchived). */
  moved(from: string, to: string, version: string, change: Change | null): void;
  /** A note or asset went to Trash. */
  removed(rel: string, change: Change): void;
  /** The set of notes changed. */
  tree(): void;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function errorResponse(e: unknown): Response {
  if (e instanceof QuireError) {
    const status = { not_found: 404, conflict: 409, exists: 409, invalid: 400, forbidden: 403 }[e.code];
    return json({ error: e.message, code: e.code, ...e.data }, status);
  }
  console.error(e);
  return json({ error: "Internal error" }, 500);
}

/** "12-18,20" → [12…18, 20]. Capped, so a URL can't ask for millions of rows. */
function parseIdRanges(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) continue;
    for (let i = a; i <= b && out.length < 5000; i++) out.push(i);
  }
  return out;
}

const SCOPES: ArchiveScope[] = ["active", "archived", "all"];

/** A task patch from a request body: each field a string, null, or (for lists) strings. Values are the core's to check. */
function taskPatch(v: unknown): TaskPatch {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new QuireError(`"patch" must be an object`);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const ok =
      k === "checked" ? typeof x === "boolean"
      : k === "summary" ? typeof x === "string"
      : k === "assignees" || k === "tags" ? Array.isArray(x) && x.every((s) => typeof s === "string")
      : ["due", "start", "done", "rec", "until", "priority"].includes(k) ? x === null || typeof x === "string"
      : k === "times" ? x === null || typeof x === "number"
      : false;
    if (!ok) throw new QuireError(`"patch.${k}" isn't a task field or has the wrong type`);
    out[k] = x;
  }
  return out as TaskPatch;
}

/** Typed reads of a request's JSON body and query string. Anything malformed is a 400 naming the field. */
function inputs(body: unknown, url: URL) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new QuireError("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof b[k] !== "string") throw new QuireError(`"${k}" must be a string`);
    return b[k];
  };
  const int = (k: string, v: unknown = b[k]): number => {
    if (!Number.isInteger(v)) throw new QuireError(`"${k}" must be a whole number`);
    return v as number;
  };
  const q = (k: string) => url.searchParams.get(k) ?? "";
  return {
    str,
    int,
    optStr: (k: string) => (b[k] === undefined || b[k] === null ? undefined : str(k)),
    text: (k: string) => (b[k] === undefined || b[k] === null ? "" : str(k)),
    flag: (k: string) => !!b[k],
    patch: () => taskPatch(b.patch),
    paths: (k: string): string[] => {
      const v = b[k];
      if (!Array.isArray(v) || !v.every((p) => typeof p === "string")) throw new QuireError(`"${k}" must be a list of strings`);
      return v;
    },
    q,
    qInt: (k: string) => int(k, q(k) === "" ? NaN : Number(q(k))),
    /** A positive count from the query, `fallback` if absent or not positive, never above `max`. */
    qCount: (k: string, fallback: number, max: number) => {
      const n = Number(q(k));
      return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
    },
    qScope: (): ArchiveScope => {
      const s = (q("scope") || "active") as ArchiveScope;
      if (!SCOPES.includes(s)) throw new QuireError(`"scope" must be one of ${SCOPES.join(", ")}`);
      return s;
    },
  };
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
  const raw = req.method === "GET" || req.method === "HEAD" ? {} : await req.json().catch(() => {
    throw new QuireError("Invalid JSON");
  });
  const { str, int, optStr, text, flag, paths, patch, q, qInt, qCount, qScope } = inputs(raw, url);

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

  const trashed = (gone: ReturnType<Quire["delete"]>) => {
    for (const g of gone) host.removed(g.path, g.change);
    return gone.map(({ id, path }) => ({ id, path }));
  };

  /** Favorites changed: the person's other tabs pick them up when they refresh. */
  const favorited = <T>(list: T) => (host.tree(), list);

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
      return json(quire.search(q("q"), qCount("limit", 30, 200), qScope()));
    case "GET /feed":
      return json(
        quire.feed({
          q: q("q"),
          scope: qScope(),
          folder: q("folder") || undefined,
          tag: q("tag") || undefined,
          sort: q("sort") === "title" ? "title" : "modified",
          offset: qCount("offset", 0, Infinity),
          limit: qCount("limit", 30, Infinity), // the feed re-fetches everything it has shown
        }),
      );
    case "GET /backlinks":
      return json(quire.backlinks(q("path")));
    case "GET /changes":
      return json(quire.changes({ limit: qCount("limit", 50, 500), before: qCount("before", 0, Infinity) || undefined, path: q("path") || undefined, by: parseAuthorFilter(q("by")) }));
    case "GET /changes/agents":
      return json(quire.agents());
    case "GET /diffs":
      return json(quire.diffSet(parseIdRanges(q("ids"))));
    case "GET /diffstats":
      return json(quire.diffStats(q("sets").split(";").slice(0, 50).map(parseIdRanges)));
    case "GET /favorites":
      return json(quire.favorites(host.user));
    case "GET /smart-folders":
      return json(quire.smartFolders(host.user));
    case "GET /tasks":
      return json(
        quire.tasks({
          folder: q("folder") || undefined,
          note: q("note") || undefined,
          tag: q("tag") || undefined,
          assignee: q("assignee") || undefined,
          due: q("due") || undefined,
          today: q("today") || undefined, // the browser's day, so "today" means the reader's today
        }),
      );
    case "GET /tasks/count":
      return json({ open: quire.openTaskCount() });
    case "GET /tags":
      return json(quire.tags());
    case "GET /asset-tags":
      return json(quire.assetTags());
    case "GET /diff":
      return json(quire.diff(qInt("from"), q("to") ? qInt("to") : qInt("from")));

    case "PUT /note": {
      let rel = cleanPath(str("path"));
      // The note moved while this save was on its way (its first title renamed it, an agent moved
      // it): save it where it is now, not as a new note at the old path.
      const id = optStr("id");
      if (id) rel = quire.pathOf(id) ?? rel;
      const content = text("content");
      // Never let a client blank out a note by accident (e.g. a stale tab whose editor failed to load).
      if (!content.trim() && !flag("allowEmpty") && quire.files.read(rel)?.trim()) {
        return json({ error: `Refusing to replace ${rel} with an empty note`, code: "empty" }, 422);
      }
      const isNew = !quire.files.stat(rel);
      const r = quire.save(rel, content, { baseVersion: optStr("baseVersion"), source: actor });
      host.written(rel, content, r.version, r.change, optStr("clientId"));
      if (isNew) host.tree();
      return json({ path: rel, version: r.version });
    }
    case "POST /note": {
      const content = text("content");
      const r = quire.create(str("path"), content, actor);
      host.written(r.path, content, r.version, r.change);
      host.tree();
      return json({ path: r.path, version: r.version });
    }
    case "POST /tasks/set": {
      const r = quire.setTask(str("path"), int("line"), str("text"), flag("done"), actor, optStr("today")); // done: gets the person's day
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /tasks/update": {
      const r = quire.updateTask(str("path"), int("line"), str("text"), patch(), actor, optStr("today"));
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "GET /today":
      return json(quire.today(q("today") || undefined));
    case "POST /today/journal": {
      const r = quire.dailyNote(str("today"), actor);
      if (r.change) {
        host.written(r.path, quire.files.read(r.path), r.version!, r.change);
        host.tree();
      }
      return json({ path: r.path, created: r.created });
    }
    case "POST /tasks/add": {
      const r = quire.addTask(str("text"), actor, { today: optStr("today"), to: optStr("to"), ignore: (raw as { ignore?: unknown }).ignore === undefined ? [] : paths("ignore") });
      host.written(r.path, quire.files.read(r.path), r.version, r.change);
      if (r.change?.op === "create") host.tree();
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /tasks/remove": {
      const r = quire.removeTask(str("path"), int("line"), str("text"), actor);
      host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version });
    }
    case "POST /tasks/move": {
      const r = quire.moveTask(str("path"), int("line"), str("text"), str("to"), actor);
      host.written(r.cut.path, quire.files.read(r.cut.path), r.cut.version, r.cut.change);
      host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /move": {
      const r = quire.move(str("from"), str("to"), actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.moved(r.from, r.path, r.version, r.change);
      host.tree();
      return json({ path: r.path, updated: r.updated });
    }
    case "PUT /asset-tags": {
      const tags = quire.setAssetTags(str("path"), paths("tags"));
      host.tree();
      return json({ tags });
    }
    case "POST /tags/rename": {
      const r = quire.renameTag(str("from"), str("to"), actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.tree();
      // Restoring each change while its note is still at `versions` (the text the rename left), and
      // setting these assets' tags back, undoes the rename without writing over a later edit.
      return json({ changes: r.edits.map((e) => e.change.id), versions: r.edits.map((e) => e.version), assets: r.assets });
    }
    // Marked versions (Quire.mark): a name on a version of a note, to compare with or go back to.
    case "GET /marks":
      return json(quire.marks(q("path") || undefined));
    case "GET /marks/compare": {
      // Two versions' text: a mark and another mark (?to=<id>), or the note now (?to=now, the default).
      const c = quire.compareMarks(q("from"), q("to") || "now");
      return json({ path: c.path, from: { ...c.from.mark, text: c.from.text }, to: c.to.mark ? { ...c.to.mark, text: c.to.text } : { now: true, text: c.to.text } });
    }
    case "POST /marks": {
      const at = (raw as { at?: unknown }).at == null ? undefined : int("at"); // a past change to mark the version after; now if absent
      return json(quire.mark(str("path"), str("name"), actor, { description: optStr("description"), at }));
    }
    case "POST /marks/rename": {
      const description = (raw as { description?: unknown }).description;
      return json(quire.renameMark(str("id"), str("name"), { description: description === undefined ? undefined : description === null ? null : str("description") }));
    }
    case "POST /marks/delete":
      return json(quire.deleteMark(str("id")));
    case "POST /marks/restore": {
      const r = quire.restoreMark(str("id"), actor, { baseVersion: optStr("version") });
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null }); // restoring `change` undoes this
    }
    case "POST /restore": {
      const r = quire.restore(int("id"), actor, optStr("version"));
      if (r.change) host.written(r.path, quire.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null }); // restoring `change` undoes this
    }
    // A `tag` stars or unstars a tag; a `path` a note.
    case "POST /favorites/star":
      return json(favorited(optStr("tag") !== undefined ? quire.starTag(host.user, str("tag")) : quire.star(host.user, str("path"))));
    case "POST /favorites/unstar":
      return json(favorited(optStr("tag") !== undefined ? quire.unstarTag(host.user, str("tag")) : quire.unstar(host.user, str("path"))));
    case "PUT /favorites":
      return json(favorited(quire.orderFavorites(host.user, paths("paths"))));
    case "POST /smart-folders": {
      const f = quire.saveSmartFolder(host.user, { id: optStr("id"), name: str("name"), query: text("query"), shared: flag("shared") }, host.canEditShared, true);
      host.tree();
      return json(f);
    }
    case "POST /smart-folders/delete": {
      const list = quire.deleteSmartFolder(host.user, str("id"), host.canEditShared, true);
      host.tree();
      return json(list);
    }
    case "GET /guide":
      return json(findStartNote(quire)?.state ?? null);
    // The guide ticks its own checklist as the person tries things. Only these fixed edits, and
    // only in the start note, so this can't be used to write anything else under the guide's name.
    case "POST /guide": {
      const r = runGuide(quire, parseGuideAction(str("action")), agentSource(GUIDE, actor));
      if (r.write) host.written(r.write.path, r.write.content, r.write.version, r.write.change);
      return json(r.state);
    }
    case "POST /archive":
      return moveAll(paths("paths"), (p) => quire.archive(p, actor));
    // Trash. Deleting sends notes, assets or a folder's contents there; `trashed` is what Undo restores.
    case "GET /delete-check":
      return json(quire.deleteCheck(url.searchParams.getAll("path"), q("folder") || undefined));
    case "POST /delete": {
      const out = trashed(quire.delete(paths("paths"), actor));
      host.tree();
      return json({ trashed: out });
    }
    case "POST /delete-folder": {
      const notes = str("notes");
      if (notes !== "trash" && notes !== "lift") throw new QuireError(`"notes" must be "trash" or "lift"`);
      const r = quire.deleteFolder(str("folder"), notes, actor);
      for (const m of r.moved) {
        for (const e of m.edits) host.written(e.path, e.content, e.version, e.change);
        host.moved(m.from, m.path, m.version, m.change);
      }
      const out = trashed(r.deleted);
      host.tree();
      return json({ trashed: out, moved: r.moved.map((m) => ({ from: m.from, to: m.path })) });
    }
    case "GET /trash":
      return json(quire.trash());
    case "POST /trash/restore": {
      const back = quire.untrash(paths("ids"), actor);
      for (const b of back) host.written(b.path, quire.files.read(b.path), b.version, b.change);
      host.tree();
      return json({ restored: back.map((b) => b.path) });
    }
    case "POST /trash/delete":
      return json({ deleted: quire.purge(paths("ids"), actor) });
    case "POST /trash/empty":
      return json({ deleted: quire.emptyTrash(actor) });
    case "POST /unarchive":
      return moveAll(paths("paths"), (p) => quire.unarchive(p, actor));
  }
  return null;
}
