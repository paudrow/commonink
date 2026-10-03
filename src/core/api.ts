// The note API, written against the web-standard Request/Response so the same routes run in the
// local Node server and in a Cloudflare workspace Durable Object.
import { cleanPath, VaultError } from "./paths.ts";
import type { ArchiveScope, Change, Vault } from "./vault.ts";
import type { TaskPatch } from "./tasks.ts";
import type { ContactFields } from "./contacts.ts";
import type { FillOptions, PersonPick } from "./templates.ts";
import { agentSource, parseAuthorFilter } from "./actor.ts";
import { findStartNote, GUIDE, parseGuideAction, runGuide } from "./guide.ts";
import { exportZip, type ExportWhat } from "./export.ts";
import { ON_EXISTING, pairsImport, writeImport, type OnExisting } from "./import.ts";
import type { Calendar, EventDraft, NoteWrite } from "./calendar.ts";
import { notePath } from "./ids.ts";
import { isSort } from "./query.ts";
import { checkup } from "./checkup.ts";

export interface ApiHost {
  vault: Vault;
  /** Who changes made through this request are attributed to ("you" locally, a person's name online). */
  actor: string;
  /** Whose favorites and personal views (in Views/<user>/) this request reads and changes (the vault's one person locally, a user ID online). */
  user: string;
  /** May this person change what the whole workspace shares, like shared views? Everyone locally; not viewers online. */
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
  /** A folder was renamed or moved (online: its shares go with it). */
  folderMoved?(from: string, to: string): Promise<void>;
  /** Before a folder is renamed or moved (online): throws if its new name still has shares of its own. */
  folderMoving?(from: string, to: string): Promise<void>;
  /** A folder was deleted (online: its shares stop); how many shares stopped. */
  folderDeleted?(folder: string): Promise<number>;
  /** The workspace's calendars, where the host can sync them (both hosts today). */
  calendar?: Calendar;
  /** Calendars or their events changed: tell connected clients (and reschedule syncing). */
  calendarChanged?(): void;
  /** Where the app is ("https://commonink.app"), for links that leave it (a meeting note's, written back to Google). */
  origin?: string;
  /** An uploaded file's bytes (for exports), or null if it's gone. */
  fileBytes?(rel: string): Promise<Uint8Array | null>;
  /** The workspace's members (online); a local vault has none. */
  members?(): Promise<Member[]>;
}

/** Someone with an account in the workspace. A contact with the same email is them (see contacts.ts). */
export interface Member {
  id: string;
  name: string;
  email: string;
  /** Whether it's the person asking. */
  you?: boolean;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** `attachment; filename=…` for a download, the name in ASCII and in full. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof VaultError) {
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
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new VaultError(`"patch" must be an object`);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const ok =
      k === "checked" ? typeof x === "boolean"
      : k === "summary" ? typeof x === "string"
      : k === "assignees" || k === "tags" ? Array.isArray(x) && x.every((s) => typeof s === "string")
      : ["due", "start", "done", "rec", "until", "priority"].includes(k) ? x === null || typeof x === "string"
      : k === "times" ? x === null || typeof x === "number"
      : false;
    if (!ok) throw new VaultError(`"patch.${k}" isn't a task field or has the wrong type`);
    out[k] = x;
  }
  return out as TaskPatch;
}

const CONTACT_LISTS = ["email", "phone", "links", "aliases", "tags"];
/** The most text one contacts import may bring (about 20,000 contacts). */
const MAX_IMPORT = 8 * 1024 * 1024;

/** Contact fields from a request: lists of strings, and company and role as strings. `name` only where it's allowed. */
function contactFields(v: unknown, withName: boolean): Partial<ContactFields> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new VaultError("Expected an object of contact fields");
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    const ok =
      CONTACT_LISTS.includes(k) ? Array.isArray(x) && x.every((s) => typeof s === "string")
      : k === "company" || k === "role" || k === "checkIn" || (k === "name" && withName) || (k === "notes" && withName) ? typeof x === "string"
      : false;
    if (!ok) throw new VaultError(`"${k}" isn't a contact field or has the wrong type`);
    out[k] = x;
  }
  return out as Partial<ContactFields>;
}

/** How to fill a template, from a request: `at` (the person's own clock), `title`, `answers`, `clipboard`. */
function fillOptions(raw: unknown): FillOptions {
  const b = raw as Record<string, unknown>;
  const out: FillOptions = {};
  for (const k of ["at", "title", "clipboard"] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    if (typeof b[k] !== "string") throw new VaultError(`"${k}" must be a string`);
    out[k] = b[k] as string;
  }
  if (out.at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(out.at)) throw new VaultError(`"at" must look like 2026-10-01T09:30`);
  if (b.answers !== undefined && b.answers !== null) {
    if (typeof b.answers !== "object" || Array.isArray(b.answers) || !Object.values(b.answers).every((v) => typeof v === "string")) {
      throw new VaultError(`"answers" must be an object of strings`);
    }
    out.answers = b.answers as Record<string, string>;
  }
  if (b.picks !== undefined && b.picks !== null) {
    const person = (p: unknown) =>
      typeof p === "object" && p !== null && typeof (p as PersonPick).name === "string" && typeof (p as PersonPick).handle === "string" && ["undefined", "string"].includes(typeof (p as PersonPick).link);
    if (typeof b.picks !== "object" || Array.isArray(b.picks) || !Object.values(b.picks).every((v) => Array.isArray(v) && v.every(person))) {
      throw new VaultError(`"picks" must be an object of lists of { name, handle, link? }`);
    }
    out.picks = b.picks as Record<string, PersonPick[]>;
  }
  return out;
}

/** Typed reads of a request's JSON body and query string. Anything malformed is a 400 naming the field. */
function inputs(body: unknown, url: URL) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new VaultError("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof b[k] !== "string") throw new VaultError(`"${k}" must be a string`);
    return b[k];
  };
  const int = (k: string, v: unknown = b[k]): number => {
    if (!Number.isInteger(v)) throw new VaultError(`"${k}" must be a whole number`);
    return v as number;
  };
  const q = (k: string) => url.searchParams.get(k) ?? "";
  return {
    raw: b,
    str,
    int,
    optStr: (k: string) => (b[k] === undefined || b[k] === null ? undefined : str(k)),
    text: (k: string) => (b[k] === undefined || b[k] === null ? "" : str(k)),
    flag: (k: string) => !!b[k],
    optBool: (k: string) => {
      if (b[k] === undefined || b[k] === null) return undefined;
      if (typeof b[k] !== "boolean") throw new VaultError(`"${k}" must be true or false`);
      return b[k] as boolean;
    },
    patch: () => taskPatch(b.patch),
    paths: (k: string): string[] => {
      const v = b[k];
      if (!Array.isArray(v) || !v.every((p) => typeof p === "string")) throw new VaultError(`"${k}" must be a list of strings`);
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
      if (!SCOPES.includes(s)) throw new VaultError(`"scope" must be one of ${SCOPES.join(", ")}`);
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
  const { vault, actor } = host;
  const url = new URL(req.url);
  const raw = req.method === "GET" || req.method === "HEAD" ? {} : await req.json().catch(() => {
    throw new VaultError("Invalid JSON");
  });
  const { str, int, optStr, text, flag, paths, patch, q, qInt, qCount, qScope } = inputs(raw, url);

  const moveAll = (paths: string[], fn: (p: string) => ReturnType<Vault["move"]>) => {
    const moved = paths.map((p) => {
      const r = fn(p);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.moved(r.from, r.path, r.version, r.change);
      return { from: r.from, to: r.path };
    });
    host.tree();
    return json({ moved });
  };

  const trashed = (gone: ReturnType<Vault["delete"]>) => {
    for (const g of gone) host.removed(g.path, g.change);
    return gone.map(({ id, path }) => ({ id, path }));
  };

  /** Favorites changed: the person's other tabs pick them up when they refresh. */
  const favorited = <T>(list: T) => (host.tree(), list);

  switch (`${req.method} ${route}`) {
    case "GET /info":
      return json(host.info());
    case "GET /notes":
      return json(vault.list(undefined, "all")); // the UI hides archived notes itself
    case "GET /note":
      return json(vault.read(q("path")));
    case "GET /resolve":
      return json({ path: vault.resolve(q("target"), q("from") || undefined) });
    case "GET /search":
      return json(vault.search(q("q"), qCount("limit", 30, 200), qScope()));
    case "GET /feed":
      return json(
        vault.feed({
          q: q("q"),
          scope: qScope(),
          folder: q("folder") || undefined,
          tag: q("tag") || undefined,
          match: q("match") === "any" ? "any" : undefined,
          sort: [q("sort")].find(isSort) ?? "modified",
          cols: q("cols") || undefined,
          offset: qCount("offset", 0, Infinity),
          limit: qCount("limit", 30, Infinity), // the feed re-fetches everything it has shown
        }),
      );
    case "GET /backlinks":
      return json(vault.backlinks(q("path"), qScope()));
    case "GET /checkup":
      return json(checkup(vault, host.user));
    case "GET /links/missing":
      return json(vault.missingLinks({ folder: q("folder") || undefined, scope: qScope() }));
    case "GET /mentions":
      return json(vault.unlinkedMentions(q("path")));
    case "POST /mentions/link": {
      // One unlinked mention made a link: one change, which Undo restores while the note is still at `version`.
      const r = vault.linkMention(str("target"), { path: str("path"), line: int("line"), from: int("from"), to: int("to"), text: str("text") }, actor);
      host.written(r.path, r.content, r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null });
    }
    case "GET /changes":
      return json(
        vault.changes({ limit: qCount("limit", 50, 500), before: qCount("before", 0, Infinity) || undefined, since: qCount("after", 0, Infinity) || undefined, path: q("path") || undefined, by: parseAuthorFilter(q("by")) }),
      );
    case "GET /changes/away":
      // What agents did since this person's own last change (and after the change they last dismissed).
      return json(vault.awaySummary(host.actor, qCount("after", 0, Infinity)));
    case "GET /changes/agents":
      return json(vault.agents());
    case "GET /diffs":
      return json(vault.diffSet(parseIdRanges(q("ids"))));
    case "GET /diffstats":
      return json(vault.diffStats(q("sets").split(";").slice(0, 50).map(parseIdRanges)));
    case "GET /favorites":
      return json(vault.favorites(host.user));
    case "GET /smart-folders":
      return json(vault.smartFolders(host.user));
    case "GET /tasks": {
      // `assignee` is someone's name (every @name that's theirs) or "me"; `by=me` keeps the tasks
      // the reader gave someone else in their own notes. Only those need the workspace's members.
      const assignee = q("assignee") || undefined;
      const by = q("by") || undefined;
      if (by !== undefined && by !== "me") throw new VaultError(`"by" can only be "me"`);
      const members = assignee || by ? ((await host.members?.()) ?? []) : [];
      return json(
        vault.tasksFor({ user: host.user, person: actor, members }, {
          folder: q("folder") || undefined,
          note: q("note") || undefined,
          tag: q("tag") || undefined,
          assignee,
          by,
          due: q("due") || undefined,
          start: q("start") || undefined,
          done: q("done") || undefined,
          priority: q("priority") || undefined,
          today: q("today") || undefined, // the browser's day, so "today" means the reader's today
        }),
      );
    }
    case "GET /tasks/count":
      return json({ open: vault.openTaskCount() });
    case "GET /properties":
      return json(vault.properties());
    case "GET /tags":
      return json(vault.tags());
    case "GET /asset-tags":
      return json(vault.assetTags());
    case "GET /diff":
      return json(vault.diff(qInt("from"), q("to") ? qInt("to") : qInt("from")));
    case "GET /contacts":
      return json(vault.contacts(q("today") || undefined));
    case "GET /contact":
      return json(vault.contact(q("path"), q("today") || undefined));
    case "GET /members":
      return json(host.members ? await host.members() : []);
    case "POST /contacts": {
      const r = vault.createContact({ ...contactFields(raw, true), name: str("name") }, actor);
      host.written(r.path, vault.files.read(r.path), r.version, r.change);
      host.tree();
      return json({ path: r.path, version: r.version });
    }
    case "POST /contacts/update": {
      const r = vault.updateContact(str("path"), contactFields((raw as { patch?: unknown }).patch, false), actor);
      if (r.change) host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version });
    }
    case "POST /contacts/merge": {
      const r = vault.mergeContacts(str("keep"), str("drop"), actor);
      host.written(r.path, r.content, r.version, r.change);
      trashed(r.trashed);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.tree();
      return json({ path: r.path, updated: r.updated, trashed: r.trashed.map(({ id, path }) => ({ id, path })) });
    }
    case "POST /contacts/import": {
      const format = str("format");
      if (format !== "vcard" && format !== "csv") throw new VaultError(`"format" must be "vcard" or "csv"`);
      const body = str("text");
      if (body.length > MAX_IMPORT) throw new VaultError("That file is too big to import at once; split it up");
      const r = vault.importContacts(body, format, actor);
      for (const p of [...r.created, ...r.updated]) host.written(p, vault.files.read(p), vault.meta(p)?.version ?? "", null);
      if (r.created.length) host.tree();
      return json(r);
    }
    case "GET /templates":
      return json(vault.templates());
    // A template filled in, to insert at the cursor (the editor writes it, so this only reads).
    case "POST /templates/render":
      return json(vault.renderTemplate(str("template"), fillOptions(raw)));
    case "POST /notes/from-template": {
      const r = vault.createFromTemplate(str("template"), { ...fillOptions(raw), folder: optStr("folder") }, actor);
      host.written(r.path, vault.files.read(r.path), r.version, r.change);
      host.tree();
      return json({ path: r.path, version: r.version, cursor: r.cursor, unfilled: r.unfilled });
    }

    case "PUT /note": {
      let rel = cleanPath(str("path"));
      // The note moved while this save was on its way (its first title renamed it, an agent moved
      // it): save it where it is now, not as a new note at the old path.
      const id = optStr("id");
      if (id) rel = vault.pathOf(id) ?? rel;
      const content = text("content");
      // Never let a client blank out a note by accident (e.g. a stale tab whose editor failed to load).
      if (!content.trim() && !flag("allowEmpty") && vault.files.read(rel)?.trim()) {
        return json({ error: `Refusing to replace ${rel} with an empty note`, code: "empty" }, 422);
      }
      const isNew = !vault.files.stat(rel);
      const r = vault.save(rel, content, { baseVersion: optStr("baseVersion"), source: actor, autosave: true });
      host.written(rel, content, r.version, r.change, optStr("clientId"));
      if (isNew) host.tree();
      return json({ path: rel, version: r.version });
    }
    case "POST /note": {
      const content = text("content");
      const r = vault.create(str("path"), content, actor);
      host.written(r.path, content, r.version, r.change);
      host.tree();
      return json({ path: r.path, version: r.version });
    }
    // Many notes at once (the app's Import notes; files' bytes go through /upload).
    case "POST /import": {
      const notes = (raw as Record<string, unknown>).notes;
      if (typeof notes !== "object" || notes === null || Array.isArray(notes) || !Object.values(notes).every((v) => typeof v === "string")) {
        throw new VaultError(`"notes" must be an object of path → text`);
      }
      const existing = optStr("existing");
      if (existing !== undefined && !ON_EXISTING.includes(existing as OnExisting)) throw new VaultError(`"existing" must be ${ON_EXISTING.join(" or ")}`);
      const r = await writeImport(vault, pairsImport(notes as Record<string, string>, optStr("folder")), {
        existing: existing as OnExisting | undefined,
        source: actor,
        written: (p, content, version, change) => host.written(p, content, version, change),
      });
      if (r.created.length) host.tree();
      return json(r);
    }
    case "POST /tasks/set": {
      const r = vault.setTask(str("path"), int("line"), str("text"), flag("done"), actor, optStr("today")); // done: gets the person's day
      if (r.change) host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /tasks/update": {
      const r = vault.updateTask(str("path"), int("line"), str("text"), patch(), actor, optStr("today"));
      if (r.change) host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "GET /today":
      return json(vault.today(q("today") || undefined));
    case "POST /today/journal": {
      const r = vault.dailyNote(str("today"), actor);
      if (r.change) {
        host.written(r.path, vault.files.read(r.path), r.version!, r.change);
        host.tree();
      }
      return json({ path: r.path, created: r.created });
    }
    case "POST /tasks/add": {
      const r = vault.addTask(str("text"), actor, { today: optStr("today"), to: optStr("to"), ignore: (raw as { ignore?: unknown }).ignore === undefined ? [] : paths("ignore") });
      host.written(r.path, vault.files.read(r.path), r.version, r.change);
      if (r.change?.op === "create") host.tree();
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /tasks/remove": {
      const r = vault.removeTask(str("path"), int("line"), str("text"), actor);
      host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version });
    }
    case "POST /tasks/move": {
      const r = vault.moveTask(str("path"), int("line"), str("text"), str("to"), actor);
      host.written(r.cut.path, vault.files.read(r.cut.path), r.cut.version, r.cut.change);
      host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, line: r.line, text: r.text });
    }
    case "POST /move": {
      const r = vault.move(str("from"), str("to"), actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.moved(r.from, r.path, r.version, r.change);
      host.tree();
      return json({ path: r.path, updated: r.updated });
    }
    case "PUT /asset-tags": {
      const tags = vault.setAssetTags(str("path"), paths("tags"));
      host.tree();
      return json({ tags });
    }
    // A tag added by name, before any note carries it, and taking one away again. Both return every tag.
    case "POST /tags": {
      const tags = vault.addTag(str("tag"));
      host.tree();
      return json(tags);
    }
    case "POST /tags/delete": {
      const tags = vault.removeTag(str("tag"));
      host.tree();
      return json(tags);
    }
    case "POST /replace": {
      // Find and replace across notes. With dryRun, only what would change; else each changed note is
      // its own change, and restoring each while its note is still at `versions` undoes the lot.
      const r = vault.replaceAcross(str("find"), str("replace"), {
        folder: optStr("folder"), matchCase: flag("matchCase"), wholeWord: flag("wholeWord"), dryRun: flag("dryRun"),
      }, actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      return json({ notes: r.notes, changes: r.edits.map((e) => e.change.id), versions: r.edits.map((e) => e.version) });
    }
    case "POST /tags/rename": {
      const r = vault.renameTag(str("from"), str("to"), actor);
      for (const e of r.edits) host.written(e.path, e.content, e.version, e.change);
      host.tree();
      // Restoring each change while its note is still at `versions` (the text the rename left), and
      // setting these assets' tags back, undoes the rename without writing over a later edit.
      return json({ changes: r.edits.map((e) => e.change.id), versions: r.edits.map((e) => e.version), assets: r.assets });
    }
    // Labels (Vault.label): a name on a version of a note, to compare with or go back to.
    case "GET /labels":
      return json(vault.labels(q("path") || undefined));
    case "GET /labels/compare": {
      // Two versions' text: a label and another label (?to=<id>), or the note now (?to=now, the default).
      const c = vault.compareLabels(q("from"), q("to") || "now");
      return json({ path: c.path, from: { ...c.from.label, text: c.from.text }, to: c.to.label ? { ...c.to.label, text: c.to.text } : { now: true, text: c.to.text } });
    }
    case "POST /labels": {
      const at = (raw as { at?: unknown }).at == null ? undefined : int("at"); // a past change to label the version after; now if absent
      return json(vault.label(str("path"), str("name"), actor, { description: optStr("description"), at }));
    }
    case "POST /labels/rename": {
      const description = (raw as { description?: unknown }).description;
      return json(vault.renameLabel(str("id"), str("name"), { description: description === undefined ? undefined : description === null ? null : str("description") }));
    }
    case "POST /labels/delete":
      return json(vault.deleteLabel(str("id")));
    case "POST /labels/restore": {
      const r = vault.restoreLabel(str("id"), actor, { baseVersion: optStr("version") });
      if (r.change) host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null }); // restoring `change` undoes this
    }
    case "POST /restore": {
      const r = vault.restore(int("id"), actor, optStr("version"));
      if (r.change) host.written(r.path, vault.files.read(r.path), r.version, r.change);
      return json({ path: r.path, version: r.version, change: r.change?.id ?? null }); // restoring `change` undoes this
    }
    // A `tag` stars or unstars a tag; a `smart_folder` (its note ID) a saved view; a `path` a note.
    case "POST /favorites/star":
      if (optStr("smart_folder") !== undefined) return json(favorited(vault.starSmartFolder(host.user, str("smart_folder"))));
      return json(favorited(optStr("tag") !== undefined ? vault.starTag(host.user, str("tag")) : vault.star(host.user, str("path"))));
    case "POST /favorites/unstar":
      if (optStr("smart_folder") !== undefined) return json(favorited(vault.unstarSmartFolder(host.user, str("smart_folder"))));
      return json(favorited(optStr("tag") !== undefined ? vault.unstarTag(host.user, str("tag")) : vault.unstar(host.user, str("path"))));
    case "PUT /favorites":
      return json(favorited(vault.orderFavorites(host.user, paths("paths"))));
    // Views (smart folders) are notes in Views/: saving one writes (or renames) its note, and
    // deleting one sends its note to Trash, so open tabs hear about it as about any note.
    case "POST /smart-folders": {
      const r = vault.saveSmartFolder(host.user, { id: optStr("id"), name: str("name"), query: text("query"), shared: flag("shared") }, host.canEditShared, actor, true);
      if (r.moved) {
        for (const e of r.moved.edits) host.written(e.path, e.content, e.version, e.change);
        host.moved(r.moved.from, r.moved.path, r.moved.version, r.moved.change);
      }
      if (r.written) host.written(r.written.path, r.written.content, r.written.version, r.written.change);
      host.tree();
      return json(r.view);
    }
    case "POST /smart-folders/delete": {
      const r = vault.deleteSmartFolder(host.user, str("id"), host.canEditShared, actor, true);
      host.removed(r.trashed.path, r.trashed.change);
      host.tree();
      return json(r.views);
    }
    case "GET /guide":
      return json(findStartNote(vault)?.state ?? null);
    // The guide ticks its own checklist as the person tries things. Only these fixed edits, and
    // only in the start note, so this can't be used to write anything else under the guide's name.
    case "POST /guide": {
      const r = runGuide(vault, parseGuideAction(str("action")), agentSource(GUIDE, actor));
      if (r.write) host.written(r.write.path, r.write.content, r.write.version, r.write.change);
      return json(r.state);
    }
    case "POST /archive":
      return moveAll(paths("paths"), (p) => vault.archive(p, actor));
    // Trash. Deleting sends notes, assets or a folder's contents there; `trashed` is what Undo restores.
    case "GET /delete-check":
      return json(vault.deleteCheck(url.searchParams.getAll("path"), q("folder") || undefined));
    case "POST /delete": {
      const out = trashed(vault.delete(paths("paths"), actor));
      host.tree();
      return json({ trashed: out });
    }
    case "POST /folders/rename": {
      await host.folderMoving?.(str("folder"), str("to"));
      const r = vault.moveFolder(str("folder"), str("to"), actor);
      for (const m of r.moved) {
        for (const e of m.edits) host.written(e.path, e.content, e.version, e.change);
        host.moved(m.from, m.path, m.version, m.change);
      }
      for (const v of r.views) host.written(v.path, v.content, v.version, v.change);
      await host.folderMoved?.(r.from, r.path);
      host.tree();
      return json({ from: r.from, path: r.path, moved: r.moved.map((m) => ({ from: m.from, to: m.path })) });
    }
    case "POST /delete-folder": {
      const notes = str("notes");
      if (notes !== "trash" && notes !== "lift") throw new VaultError(`"notes" must be "trash" or "lift"`);
      const r = vault.deleteFolder(str("folder"), notes, actor);
      for (const m of r.moved) {
        for (const e of m.edits) host.written(e.path, e.content, e.version, e.change);
        host.moved(m.from, m.path, m.version, m.change);
      }
      const out = trashed(r.deleted);
      // The folder is gone, so its shares go too: a folder made with its name later isn't shared.
      const unshared = await host.folderDeleted?.(str("folder")); // online only; left out locally
      host.tree();
      return json({ trashed: out, moved: r.moved.map((m) => ({ from: m.from, to: m.path })), unshared });
    }
    case "GET /trash":
      return json(vault.trash());
    case "GET /export": {
      // Notes as a .zip (core/export.ts): ?path=… (repeated), ?folder=…, or ?all=1 for the whole workspace.
      const what: ExportWhat = q("all") ? { all: true } : q("folder") ? { folder: q("folder") } : { paths: url.searchParams.getAll("path").slice(0, 2000) };
      const out = await exportZip({ vault, bytes: host.fileBytes ?? (async () => null), origin: host.origin ?? url.origin, name: String(host.info().name ?? "Workspace") }, what);
      return new Response(out.zip as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "application/zip", "Content-Disposition": attachment(out.name), "Cache-Control": "no-store" } });
    }
    case "POST /trash/restore": {
      const back = vault.untrash(paths("ids"), actor);
      for (const b of back) host.written(b.path, vault.files.read(b.path), b.version, b.change);
      host.tree();
      return json({ restored: back.map((b) => b.path) });
    }
    case "POST /trash/delete":
      return json({ deleted: vault.purge(paths("ids"), actor) });
    case "POST /trash/empty":
      return json({ deleted: vault.emptyTrash(actor) });
    case "POST /unarchive":
      return moveAll(paths("paths"), (p) => vault.unarchive(p, actor));
  }
  if (route.startsWith("/calendar/") && host.calendar) return calendarRoute(host, host.calendar, `${req.method} ${route}`, inputs(raw, url));
  return null;
}

/** An event's fields from a request body: every one for a new event, only those given for a change. */
function draftOf({ str, optStr, optBool, raw }: ReturnType<typeof inputs>, whole: boolean): Partial<EventDraft> {
  const out: Partial<EventDraft> = {};
  const take = <K extends keyof EventDraft>(k: K, v: EventDraft[K] | undefined) => v !== undefined && (out[k] = v);
  take("title", whole ? str("title") : optStr("title"));
  take("start", whole ? str("start") : optStr("start"));
  take("end", whole ? str("end") : optStr("end"));
  take("allDay", optBool("allDay") ?? (whole ? false : undefined));
  take("timeZone", optStr("timeZone"));
  take("location", optStr("location"));
  take("description", optStr("description"));
  const people = raw.attendees;
  if (people !== undefined) {
    if (!Array.isArray(people) || !people.every((a) => a && typeof a === "object" && ["name", "email"].every((k) => a[k] === undefined || a[k] === null || typeof a[k] === "string"))) {
      throw new VaultError('"attendees" must be a list of { name, email }');
    }
    out.attendees = people.map((a: { name?: string | null; email?: string | null }) => ({ name: a.name ?? null, email: a.email ?? null, status: null }));
  } else if (whole) out.attendees = [];
  return out;
}

/** An instant from the query: an ISO date or time. */
function instant(s: string, name: string): number {
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) throw new VaultError(`"${name}" must be a date or time like 2026-10-01 or 2026-10-01T09:00:00Z`);
  return t;
}

/** Calendars: the sources the workspace subscribes to, their events, and meeting notes made from them. */
async function calendarRoute(host: ApiHost, cal: Calendar, key: string, input: ReturnType<typeof inputs>): Promise<Response | null> {
  const { str, optStr, optBool, q, qCount } = input;
  const viewer = { user: host.user, canEdit: host.canEditShared };
  const changed = <T>(out: T) => (host.calendarChanged?.(), json(out));
  // The workspace's own events are notes: what an event change wrote, clients hear about as any note change.
  const writes: NoteWrite[] = [];
  const wrote = () => {
    for (const w of writes) {
      if (w.op === "written") host.written(w.path, host.vault.files.read(w.path), w.version, w.change);
      else if (w.op === "removed") host.removed(w.path, w.change);
      else {
        for (const e of w.edits) host.written(e.path, e.content, e.version, e.change);
        host.moved(w.from, w.path, w.version, w.change);
      }
    }
    if (writes.length) host.tree();
  };
  switch (key) {
    case "GET /calendar/sources":
      return json(cal.sources(viewer));
    case "POST /calendar/sources":
      return changed(await cal.addIcs({ url: str("url"), name: optStr("name"), color: optStr("color") }, viewer, host.actor));
    case "POST /calendar/google":
      return changed(await cal.addGoogle({ calendar: str("calendar"), name: optStr("name"), color: optStr("color"), writeBack: optBool("writeBack"), accessRole: optStr("accessRole") }, viewer, host.actor));
    case "POST /calendar/sources/update":
      return changed(cal.update(str("id"), { name: optStr("name"), color: optStr("color"), writeBack: optBool("writeBack") }, viewer));
    case "POST /calendar/sources/remove":
      cal.remove(str("id"), viewer);
      return changed({ ok: true });
    case "POST /calendar/refresh":
      return changed(await cal.refresh(viewer, optStr("id")));
    case "GET /calendar/events": {
      const from = instant(q("from"), "from");
      const to = instant(q("to"), "to");
      if (to <= from || to - from > 400 * 86_400_000) throw new VaultError(`"to" must be after "from", and at most 400 days later`);
      return json(cal.events(viewer, { from, to, zone: q("tz") || undefined, q: q("q") || undefined, source: q("source") || undefined, limit: qCount("limit", 2000, 5000) }));
    }
    case "GET /calendar/event": {
      const ev = cal.event(q("id"), viewer);
      return ev ? json(ev) : json({ error: "That event doesn't exist, or you can't see it" }, 404);
    }
    // Events made and changed in the app: in the workspace's own calendar ("local"), or a Google one.
    case "POST /calendar/events": {
      const ev = await cal.createEvent(str("source"), draftOf(input, true) as EventDraft, viewer, host.actor, optStr("note"), writes);
      wrote();
      host.calendarChanged?.();
      if (!optBool("meetingNote")) return json({ event: ev, note: null });
      const r = cal.meetingNote(host.vault, ev.id, viewer, { timeZone: optStr("timeZone"), source: host.actor });
      if (r.created) {
        host.written(r.path, host.vault.files.read(r.path), r.version, r.change);
        host.tree();
      }
      return json({ event: cal.event(ev.id, viewer), note: { path: r.path } });
    }
    case "POST /calendar/events/update": {
      const ev = await cal.updateEvent(str("id"), draftOf(input, false), viewer, host.actor, writes);
      wrote();
      return changed(ev);
    }
    case "POST /calendar/events/delete":
      await cal.deleteEvent(str("id"), viewer, host.actor, writes);
      wrote();
      return changed({ ok: true });
    case "POST /calendar/meeting-note": {
      const id = str("id");
      const r = cal.meetingNote(host.vault, id, viewer, { timeZone: optStr("timeZone"), source: host.actor });
      if (!r.created) return json({ path: r.path, created: false });
      host.written(r.path, host.vault.files.read(r.path), r.version, r.change);
      host.tree();
      host.calendarChanged?.();
      const title = host.vault.read(r.path).title;
      const linked = host.origin && r.noteId ? await cal.linkBack(id, viewer, `${host.origin}${notePath(title, r.noteId)}`) : null;
      return json({ path: r.path, created: true, linkedBack: linked });
    }
  }
  return null;
}
