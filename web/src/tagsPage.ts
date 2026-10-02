// Tags: every tag as a tree, with how many notes, tasks and assets carry it (tags under it
// included). Click one to see its notes. Rename rewrites the tag everywhere; renaming onto a tag
// that exists merges the two. Either comes with Undo. A tag added by name that nothing carries yet
// can be deleted too.
import { api, unusedTag, type TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import type { ToastSpec } from "./toast.ts";
import { cleanTag, tagMatches } from "../../src/core/tags.ts";

interface Hooks {
  tags(): TagCount[];
  /** The tags changed: fetch them again. */
  refresh(): Promise<void>;
  openTag(tag: string, where?: "notes" | "tasks"): void;
  /** Take away a tag nothing carries yet, with Undo. */
  deleteTag(t: TagCount): Promise<void>;
  /** A viewer (online) can't change tags. */
  readOnly(): boolean;
  toast(t: ToastSpec): void;
}

export class TagsPage {
  readonly root: HTMLElement;
  private list = el("div", { class: "tags-list", role: "list" });
  private input = el("input", { placeholder: "Filter tags…", spellcheck: "false", autocomplete: "off" });

  constructor(
    root: HTMLElement,
    private hooks: Hooks,
  ) {
    this.root = root;
    root.append(
      el(
        "div",
        { class: "page" },
        el(
          "header",
          { class: "page-head" },
          el("h1", {}, "Tags"),
          el("p", { class: "page-sub" }, "Every #tag across your notes, tasks and assets. Nest them with /: a tag includes every tag under it."),
        ),
        el("label", { class: "feed-search tags-search" }, icon("search", 16), this.input),
        this.list,
      ),
    );
    this.input.addEventListener("input", () => this.render());
  }

  get visible() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
    this.render();
    this.input.focus({ preventScroll: true });
  }

  refresh() {
    if (this.visible && !this.list.querySelector(".tag-rename")) this.render();
  }

  private render() {
    const had = this.list.contains(document.activeElement) ? document.activeElement?.closest(".tags-row")?.getAttribute("data-tag") : null;
    const q = this.input.value.trim().replace(/^#/, "").toLowerCase();
    const all = this.hooks.tags();
    // A filter keeps the matching tags and their parents, so each still sits in its place in the tree.
    const shown = q ? all.filter((t) => all.some((m) => m.tag.includes(q) && (m.tag === t.tag || m.tag.startsWith(`${t.tag}/`)))) : all;
    this.list.replaceChildren(
      ...(shown.length
        ? shown.map((t) => this.row(t))
        : [el("div", { class: "feed-empty" }, all.length ? `No tags match “${q}”.` : "No tags yet. Type #tag in a note, or add tags to an asset.")]),
    );
    if (had) this.focusTag(had); // a redraw (a live update) keeps the keyboard on the tag it was on
  }

  /** Give the keyboard to a tag's row. Its buttons stay hidden until the row has the focus, so the tag's own button takes it. */
  private focusTag(tag: string) {
    this.list.querySelector<HTMLElement>(`.tags-row[data-tag="${CSS.escape(tag)}"] .tags-open`)?.focus();
  }

  private row(t: TagCount): HTMLElement {
    const depth = t.tag.split("/").length - 1;
    const name = t.display.split("/").pop()!;
    const uses = [
      t.notes ? `${t.notes} note${t.notes === 1 ? "" : "s"}` : "",
      t.tasks ? `${t.tasks} task${t.tasks === 1 ? "" : "s"}` : "",
      t.assets ? `${t.assets} asset${t.assets === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const label = el("span", { class: "tags-name" }, "#", depth ? el("span", { class: "tags-parent" }, t.display.slice(0, -name.length)) : null, name);
    const edit = !this.hooks.readOnly();
    const node = el(
      "div",
      { class: "tags-row", role: "listitem", "data-tag": t.tag, style: { "--depth": String(depth) } },
      el(
        "button",
        {
          type: "button",
          class: "tags-open",
          title: `Notes tagged #${t.display}`,
          onclick: () => this.hooks.openTag(t.display),
          onkeydown: (e: KeyboardEvent) => e.key === "F2" && edit && (e.preventDefault(), this.startRename(node, t)),
        },
        icon("hash", 14),
        label,
      ),
      el("span", { class: "tags-uses" }, unusedTag(t) ? "Not used yet" : uses.join(" · ")),
      t.tasks ? el("button", { type: "button", class: "row-act", title: `Tasks tagged #${t.display}`, onclick: () => this.hooks.openTag(t.display, "tasks") }, icon("task", 14)) : null,
      edit ? el("button", { type: "button", class: "row-act tags-rename", title: "Rename or merge (F2)", "aria-label": `Rename or merge #${t.display}`, onclick: () => this.startRename(node, t) }, icon("edit", 14)) : null,
      edit && unusedTag(t) ? el("button", { type: "button", class: "row-act", title: `Delete #${t.display}`, onclick: () => void this.hooks.deleteTag(t) }, icon("trash", 14)) : null,
    );
    return node;
  }

  private startRename(node: HTMLElement, t: TagCount) {
    const input = el("input", { class: "tag-rename", value: t.display, spellcheck: "false", "aria-label": `New name for #${t.display}` });
    node.replaceChildren(icon("hash", 14), input, el("span", { class: "tags-uses" }, "Enter to rename, Esc to cancel"));
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const typing = document.activeElement === input; // Enter or Escape, not a blur to somewhere else
      const to = cleanTag(input.value);
      let now = t.tag;
      if (commit && input.value.trim() && !to) {
        this.hooks.toast({ text: "A tag is letters, numbers, - and _, nested with /" });
      } else if (commit && to && to !== t.display) {
        if (await this.rename(t, to)) now = to.toLowerCase();
      }
      this.render();
      if (typing) this.focusTag(now); // from the keyboard, back to the tag, under its new name if it has one
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void finish(true);
      if (e.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(false));
  }

  /** Rename (or merge) a tag, with Undo (the sidebar's rename comes here too). Whether it happened. */
  async rename(t: TagCount, to: string): Promise<boolean> {
    const all = this.hooks.tags();
    const into = all.find((x) => x.tag === to.toLowerCase() && x.tag !== t.tag);
    if (into && !confirm(`#${into.display} already exists. Merge #${t.display} into it? Everything tagged #${t.display} will be tagged #${into.display}.`)) return false;
    // Tags added by name under it move with it; Undo moves them back.
    const waiting = all.filter((x) => tagMatches(x.tag, t.tag) && unusedTag(x) && !all.some((c) => c.tag.startsWith(`${x.tag}/`)));
    const movedTo = (x: TagCount) => (into?.tag ?? to.toLowerCase()) + x.tag.slice(t.tag.length);
    let r: Awaited<ReturnType<typeof api.renameTag>>;
    try {
      r = await api.renameTag(t.tag, into?.display ?? to); // a merge keeps the way the other tag is written
    } catch (e) {
      this.hooks.toast({ text: e instanceof Error ? e.message : `Couldn't rename #${t.display}` });
      return false;
    }
    await this.hooks.refresh();
    const n = r.changes.length + Object.keys(r.assets).length;
    this.hooks.toast({
      icon: "hash",
      text: `${into ? `Merged #${t.display} into` : `Renamed #${t.display} to`} #${into?.display ?? to}${n ? ` in ${n} place${n === 1 ? "" : "s"}` : ""}`,
      actionLabel: "Undo",
      action: async () => {
        // Only notes still as the rename left them: one edited since keeps its edit, and the new tag.
        let kept = 0;
        for (let i = r.changes.length - 1; i >= 0; i--) await api.restore(r.changes[i], r.versions[i]).catch(() => kept++);
        for (const [path, tags] of Object.entries(r.assets)) await api.setAssetTags(path, tags).catch(() => null);
        for (const x of waiting) {
          await api.deleteTag(movedTo(x)).catch(() => null);
          await api.addTag(x.display).catch(() => null);
        }
        await this.hooks.refresh();
        if (kept) this.hooks.toast({ text: `${kept} note${kept === 1 ? "" : "s"} changed since the rename, so ${kept === 1 ? "it keeps" : "they keep"} #${into?.display ?? to}` });
      },
    });
    return true;
  }
}
