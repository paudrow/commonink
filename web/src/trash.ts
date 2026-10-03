// Deleting, and Trash. Everything deleted waits in Trash for 30 days: deleting comes with Undo, and
// asks first only when other notes link to what's going, or when it's a whole folder. Trash, a tab
// of the Notes page, lists what's there to restore, and (for whoever may) to delete for good.
import { api, ApiError, type TrashItem } from "./api.ts";
import { authorAvatar, authorName, displayName, el, icon, timeAgo } from "./dom.ts";
import type { ToastSpec } from "./toast.ts";
import { emptyState } from "./emptyState.ts";
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

/** Does a Trash item have every word of `q` in its path or its opening lines? Trash isn't in the search index, so this is what finds it. */
export function trashMatches(t: TrashItem, q: string): boolean {
  const text = `${t.path} ${t.excerpt ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => text.includes(w));
}

/** Trash, the Notes page's third tab: what's been deleted, newest first, to restore or (for whoever may) delete for good. */
export class TrashPage {
  readonly root = el("div", { class: "trash" });
  private list = el("div", { class: "tr-list" });
  private head = el("div", { class: "tr-head" });
  private items: TrashItem[] = [];
  private loaded = false;
  /** The words Trash is narrowed to (the Notes page's filter). */
  private q = "";

  constructor(private hooks: DeleteHooks & { canPurge(): boolean; open(path: string): void }) {
    this.root.append(this.head, this.list);
  }

  /** List what's in Trash with every word of `q`. */
  async show(q = "") {
    this.q = q;
    this.render();
    await this.load();
  }

  /** How many things in Trash have every word of `q`. */
  async count(q: string): Promise<number> {
    const items = await api.trash().catch(() => []);
    return items.filter((t) => trashMatches(t, q)).length;
  }

  /** Something may have been deleted or restored elsewhere. */
  async refresh() {
    if (this.root.isConnected && !this.root.closest("[hidden]")) await this.load();
  }

  private async load() {
    this.items = await api.trash().catch(() => []);
    this.loaded = true;
    this.render();
  }

  private render() {
    const purge = this.hooks.canPurge();
    const shown = this.items.filter((t) => trashMatches(t, this.q));
    this.head.replaceChildren(...(purge && this.items.length ? [el("button", { type: "button", class: "qw-btn danger", onclick: () => void this.empty() }, icon("trash", 14), "Empty trash")] : []));
    this.list.replaceChildren(
      ...(shown.length
        ? shown.map((t) => this.row(t, purge))
        : !this.loaded
          ? []
          : this.items.length
            ? [emptyState({ icon: "search", title: `Nothing in Trash matches “${this.q}”`, text: ["Trash finds a note by its name, its folder or its first lines."] })]
            : [emptyState({ icon: "trash", title: "Trash is empty", text: ["Delete a note from its top bar, from Notes with the Delete key, or with :trash in vim."] })]),
    );
  }

  private row(t: TrashItem, purge: boolean): HTMLElement {
    const days = Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86_400_000));
    return el(
      "div",
      { class: "tr-row" },
      el("span", { class: "tr-icon" }, icon(t.kind === "asset" ? "image" : t.kind === "html" ? "html" : "file", 16)),
      el(
        "div",
        { class: "tr-main" },
        el("div", { class: "tr-name" }, displayName(t.path), el("span", { class: "tr-path" }, t.path)),
        t.excerpt ? el("div", { class: "tr-excerpt" }, t.excerpt) : null,
        el(
          "div",
          { class: "tr-meta" },
          t.by ? authorAvatar(t.by, 16) : null,
          `Deleted ${timeAgo(t.deletedAt)}${t.by ? ` by ${authorName(t.by)}` : ""} · gone for good in ${plural(days, "day")}`,
        ),
      ),
      el("button", { type: "button", class: "qw-btn", onclick: () => void this.restore(t) }, icon("reset", 14), "Restore"),
      purge ? el("button", { type: "button", class: "qw-btn danger", title: "Delete forever", onclick: () => void this.purge(t) }, "Delete forever") : null,
    );
  }

  private async restore(t: TrashItem) {
    const r = await api.restoreTrash([t.id]).catch(() => null);
    if (!r) return this.hooks.toast({ text: `Couldn't restore ${displayName(t.path)}` });
    await this.hooks.changed();
    await this.load();
    const to = r.restored[0];
    this.hooks.toast({ icon: "reset", text: to === t.path ? `Restored ${displayName(to)}` : `Restored ${displayName(t.path)} as ${to}`, actionLabel: "Open", action: () => this.hooks.open(to) });
  }

  private async purge(t: TrashItem) {
    const ok = await ask({
      title: `Delete ${displayName(t.path)} forever?`,
      body: [`It can't be restored after this, and its earlier versions go from History too${t.labels ? `, with its ${plural(t.labels, "named version")}` : ""}.`],
      actions: [{ label: "Delete forever", value: "yes", kind: "danger" }],
    });
    if (!ok) return;
    await api.purgeTrash([t.id]).catch(() => this.hooks.toast({ text: "Couldn't delete that" }));
    await this.load();
  }

  private async empty() {
    const labels = this.items.reduce((n, t) => n + (t.labels ?? 0), 0);
    const ok = await ask({
      title: `Empty Trash?`,
      body: [`${plural(this.items.length, "item")} will be deleted for good. They can't be restored after this, and their earlier versions go from History too${labels ? `, with ${plural(labels, "named version")}` : ""}.`],
      actions: [{ label: "Empty trash", value: "yes", kind: "danger" }],
    });
    if (!ok) return;
    await api.emptyTrash().catch(() => this.hooks.toast({ text: "Couldn't empty Trash" }));
    await this.load();
  }
}
