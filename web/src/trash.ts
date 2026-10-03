// Deleting, and Trash. Everything deleted waits in Trash for 30 days: deleting comes with Undo, and
// asks first only when other notes link to what's going, or when it's a whole folder. Trash, a tab
// of the Notes page, lists what's there as cards to restore, and (for whoever may) to delete for good.
import { api, ApiError, type TagCount, type TrashItem } from "./api.ts";
import { displayName, el, icon } from "./dom.ts";
import type { ToastSpec } from "./toast.ts";
import { folderList, tagList, type NoteQuery } from "../../src/core/query.ts";
import { tagMatches } from "../../src/core/tags.ts";
import { ask } from "./modal.ts";

export interface DeleteHooks {
  toast(t: ToastSpec): void;
  /** Notes changed: fetch the list again (and anything showing it). */
  changed(): Promise<void>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 notes link here: Plan, Launch and Retro." (for assets: "embed it"). */
function linksLine(from: string[], assets: boolean): HTMLElement {
  const names = from.slice(0, 3).map(displayName);
  const rest = from.length - names.length;
  const list = rest > 0 ? `${names.join(", ")} and ${plural(rest, "more")}` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const what = assets ? plural(from.length, "note embeds it", "notes embed it") : plural(from.length, "note links here", "notes link here");
  return el("p", { class: "ask-warn" }, icon("link", 14), `${what}: ${list}. ${assets ? "It" : "Their links"} will show as missing until it's restored.`);
}

/**
 * Send notes and assets to Trash, with Undo. If other notes link to them (or embed an asset), say
 * which and ask first. Resolves to the paths that went, or [] if it was called off or failed.
 */
export async function deletePaths(paths: string[], hooks: DeleteHooks): Promise<string[]> {
  if (!paths.length) return [];
  const check = await api.deleteCheck({ paths }).catch(() => null);
  const what = paths.length === 1 ? displayName(paths[0]) : plural(paths.length, "item");
  if (check?.linkedFrom.length) {
    const ok = await ask({
      title: `Delete ${what}?`,
      body: [linksLine(check.linkedFrom, check.notes === 0), `It goes to Trash, where you can restore it for 30 days.`],
      actions: [{ label: "Delete", value: "delete", kind: "danger" }],
    });
    if (!ok) return [];
  }
  const r = await api.delete(paths).catch((e) => (hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't delete that" }), null));
  if (!r) return [];
  await hooks.changed();
  hooks.toast({
    icon: "trash",
    text: `Deleted ${r.trashed.length === 1 ? displayName(r.trashed[0].path) : plural(r.trashed.length, "item")}`,
    actionLabel: "Undo",
    action: async () => {
      await api.restoreTrash(r.trashed.map((t) => t.id));
      await hooks.changed();
    },
  });
  return r.trashed.map((t) => t.path);
}

/**
 * Delete a folder: ask whether its notes go to Trash too or move up a level, showing how many there
 * are and who links to them. An empty folder just goes. Resolves to whether it went.
 */
export async function deleteFolder(folder: string, hooks: DeleteHooks): Promise<boolean> {
  const check = await api.deleteCheck({ folder }).catch(() => null);
  if (!check) return false;
  const total = check.notes + check.assets;
  // An empty one just goes, and stops being shared (online), so a folder made with its name later isn't.
  if (!total) return (await api.deleteFolder(folder, "trash").catch(() => null), true);
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "the top level";
  const counts = [check.notes && plural(check.notes, "note"), check.assets && plural(check.assets, "asset")].filter(Boolean).join(" and ");
  const choice = await ask({
    title: `Delete the folder ${displayName(folder)}?`,
    body: [`It has ${counts} in it, subfolders included.`, ...(check.linkedFrom.length ? [linksLine(check.linkedFrom, false)] : [])],
    actions: [
      { label: `Move ${total === 1 ? "it" : "them"} to ${parent}`, value: "lift" },
      { label: `Delete ${total === 1 ? "it" : "them"} too`, value: "trash", kind: "danger" },
    ],
  });
  if (choice !== "lift" && choice !== "trash") return false;
  const r = await api.deleteFolder(folder, choice).catch((e) => (hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't delete the folder" }), null));
  if (!r) return false;
  await hooks.changed();
  hooks.toast({
    icon: choice === "trash" ? "trash" : "move",
    text:
      (choice === "trash" ? `Deleted ${displayName(folder)} and ${counts}` : `Deleted ${displayName(folder)}; moved ${counts} to ${parent}`) +
      (r.unshared ? ", and stopped sharing it" : ""),
    actionLabel: "Undo",
    action: async () => {
      if (r.trashed.length) await api.restoreTrash(r.trashed.map((t) => t.id));
      for (const m of r.moved) await api.move(m.to, m.from);
      await hooks.changed();
    },
  });
  return true;
}

/** Where a Trash item's folder is, as Notes reads it: an archived note's is the one it was archived from. */
const homeOf = (t: TrashItem) => t.path.replace(/^Archive\//, "");

/** Does a Trash item have every word of `q` in its title, path, tags or opening lines? Trash isn't in the search index, so this is what finds it. */
export function trashMatches(t: TrashItem, q: string): boolean {
  const text = `${t.title ?? ""} ${t.path} ${(t.tags ?? []).join(" ")} ${t.excerpt ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => text.includes(w));
}

/** What Trash lists for the Notes page's filters: its words, folder, tags (each, or a tag under it) and order. */
export function filterTrash(items: TrashItem[], query: NoteQuery): TrashItem[] {
  // Several folders (`A|B`) mean any of them; several tags mean each one, or with match=any, one of them.
  const folders = folderList(query.folder).map((f) => f.replace(/\/?$/, "/"));
  const tags = tagList(query.tag).map((t) => t.toLowerCase());
  const hasTag = (t: TrashItem, f: string) => (t.tags ?? []).some((x) => tagMatches(x.toLowerCase(), f));
  const shown = items.filter(
    (t) =>
      (!query.q || trashMatches(t, query.q)) &&
      (!folders.length || folders.some((f) => homeOf(t).startsWith(f))) &&
      (!tags.length || (query.match === "any" ? tags.some((f) => hasTag(t, f)) : tags.every((f) => hasTag(t, f)))),
  );
  // Trash keeps no note dates: newest and recently changed both mean most recently deleted.
  if (query.sort === "oldest") return shown.sort((a, b) => a.deletedAt - b.deletedAt);
  if (query.sort === "title") return shown.sort((a, b) => a.title.localeCompare(b.title));
  return shown.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** The top-level folders things in Trash came from, for the folder chips. */
export const trashFolders = (items: TrashItem[]): string[] => [...new Set(items.map(homeOf).filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort();

/** The tags on things in Trash, with how many carry each (a tag under it counts too), for the tag filter. */
export function trashTags(items: TrashItem[]): TagCount[] {
  const tags = new Map<string, TagCount>();
  for (const t of items) {
    const names = new Set((t.tags ?? []).flatMap((display) => display.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
    for (const name of names) {
      const key = name.toLowerCase();
      const c = tags.get(key) ?? { tag: key, display: name, notes: 0, tasks: 0, assets: 0 };
      c.notes++;
      tags.set(key, c);
    }
  }
  return [...tags.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Trash, the Notes page's third tab: what's been deleted, to restore or (for whoever may) delete for
 * good. The Notes page lists it as cards, as it does notes; this fetches it and does what its buttons say.
 */
export class Trash {
  constructor(private hooks: DeleteHooks & { canPurge(): boolean; open(path: string): void }) {}

  /** Whoever may delete for good sees Delete forever and Empty trash. */
  get canPurge() {
    return this.hooks.canPurge();
  }

  /** Everything in Trash, newest first. */
  list(): Promise<TrashItem[]> {
    return api.trash().catch(() => []);
  }

  /** How many things in Trash have every word of `q`. */
  async count(q: string): Promise<number> {
    return (await this.list()).filter((t) => trashMatches(t, q)).length;
  }

  /** Put things back where they were. Resolves to whether they went. */
  async restore(items: TrashItem[]): Promise<boolean> {
    if (!items.length) return false;
    const r = await api.restoreTrash(items.map((t) => t.id)).catch(() => null);
    if (!r) return (this.hooks.toast({ text: `Couldn't restore ${items.length === 1 ? items[0].title : "those"}` }), false);
    await this.hooks.changed();
    const [t] = items;
    const to = r.restored[0];
    if (items.length > 1) this.hooks.toast({ icon: "reset", text: `Restored ${plural(items.length, "item")}` });
    else this.hooks.toast({ icon: "reset", text: to === t.path ? `Restored ${t.title}` : `Restored ${t.title} as ${to}`, actionLabel: "Open", action: () => this.hooks.open(to) });
    return true;
  }

  /** Delete things for good, asking first. Resolves to whether they went. */
  async purge(items: TrashItem[]): Promise<boolean> {
    if (!items.length || !this.canPurge) return false;
    const one = items.length === 1;
    const labels = items.reduce((n, t) => n + (t.labels ?? 0), 0);
    const ok = await ask({
      title: one ? `Delete ${items[0].title} forever?` : `Delete ${plural(items.length, "item")} forever?`,
      body: [`${one ? "It" : "They"} can't be restored after this, and ${one ? "its" : "their"} earlier versions go from History too${labels ? `, with ${one ? "its " : ""}${plural(labels, "named version")}` : ""}.`],
      actions: [{ label: "Delete forever", value: "yes", kind: "danger" }],
    });
    if (!ok) return false;
    return (await api.purgeTrash(items.map((t) => t.id)).catch(() => (this.hooks.toast({ text: "Couldn't delete that" }), null))) !== null;
  }

  /** Delete everything in Trash for good, asking first. Resolves to whether it went. */
  async empty(items: TrashItem[]): Promise<boolean> {
    if (!items.length || !this.canPurge) return false;
    const labels = items.reduce((n, t) => n + (t.labels ?? 0), 0);
    const ok = await ask({
      title: `Empty Trash?`,
      body: [`${plural(items.length, "item")} will be deleted for good. They can't be restored after this, and their earlier versions go from History too${labels ? `, with ${plural(labels, "named version")}` : ""}.`],
      actions: [{ label: "Empty trash", value: "yes", kind: "danger" }],
    });
    if (!ok) return false;
    return (await api.emptyTrash().catch(() => (this.hooks.toast({ text: "Couldn't empty Trash" }), null))) !== null;
  }
}
