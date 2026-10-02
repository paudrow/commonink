// Notes: every note as a stream of cards, newest first — the app's home. Click a card to read
// the whole note in place; Edit opens it in the editor. Filter as you type, triage from the
// keyboard (j/k, Enter to expand, o to open, e to archive, x to select, Delete to delete, n for a
// new note), and
// archive or delete in bulk. Its tabs are where notes go: Notes, Archive and Trash.
import { api, isArchived, type FeedItem, type FeedPage, type TagCount, type Task } from "./api.ts";
import type { TrashPage } from "./trash.ts";
import { $, authorAvatar, authorName, displayName, el, icon, markTerms, NOTE_DRAG, timeAgo } from "./dom.ts";
import { renderMarkdown, sandboxFrame } from "./render.ts";
import { hydrateCode } from "./code.ts";
import { hydrateMath } from "./math.ts";
import { hydrateGithubLinks } from "./github.ts";
import { followRenderedLink } from "./gfm.ts";
import { hydrateDataEmbeds } from "./textPreview.ts";
import { parseDirective } from "./widgets/args.ts";
import { WIDGETS } from "./widgets/index.ts";
import { tagChip, tagFilter } from "./tagPicker.ts";
import type { ToastSpec } from "./toast.ts";
import { formatQuery, tagList, type NoteQuery, type QuerySort } from "../../src/core/query.ts";
import { hydrateTaskChips, withTaskChips } from "./taskChips.ts";
import { openChipEditor, taskPeople } from "./taskChipEditors.ts";
import { linkClick, sideClick } from "./panes.ts";
import { calendarTarget, openCalendarLink } from "./links.ts";
import { emptyState } from "./emptyState.ts";
import { AGENTS_BLURB, agentsBadge } from "./agentsNote.ts";
import { notePath } from "../../src/core/ids.ts";

interface Hooks {
  /** `side`: to the side (a Cmd-click; Ctrl-click off a Mac). */
  open(path: string, line?: number, side?: boolean): void;
  starred(id: string): boolean;
  toggleStar(path: string): void;
  /** The filters changed (the sidebar marks the folder or smart folder being shown). */
  filtersChanged(): void;
  tags(): TagCount[];
  /** Save these filters (a query like `tag=work sort=title`) as a smart folder. */
  saveQuery(anchor: HTMLElement, query: string): void;
  /** The star (Add to / Remove from Favorites) for the tag Notes is narrowed to. */
  starButton(tag: string): HTMLElement;
  /** Show every task of this person's. */
  openPerson(name: string): void;
  /** You can only view this workspace: chips show, but don't open editors. */
  readOnly(): boolean;
  /** Shared outside the workspace (online): the card says so. */
  shared?(item: FeedItem): boolean;
  /** Send notes to Trash (asking first if other notes link to them). Resolves to the paths that went. */
  delete(paths: string[]): Promise<string[]>;
  /** Rename a note (F2 on its card), the way ⌘K's Rename does. */
  rename(path: string): void;
  toast(t: ToastSpec): void;
  changed(): void;
  /** The sidebar's New note: in the folder the page is narrowed to, if any. */
  newNote(folder: string): void;
  /** Show another tab (its address changes with it). */
  goTab(tab: NotesTab): void;
  /** The Trash tab's list, or null for someone who has no Trash (a viewer, online). */
  trash(): TrashPage | null;
}

const PAGE = 40;

/** Where a note can be: in use, archived, or deleted. */
export type NotesTab = "notes" | "archive" | "trash";
/** Each tab's name, and the one line that says what's in it. */
const TABS: Record<NotesTab, { label: string; about: string }> = {
  notes: { label: "Notes", about: "" },
  archive: { label: "Archive", about: "Out of your way but kept. Links to them still work." },
  trash: { label: "Trash", about: "Deleted notes. Each is removed for good 30 days after you delete it." },
};

export class NotesPage {
  readonly root = $("#notes-view");
  private input: HTMLInputElement;
  private list: HTMLElement;
  private scopeBar: HTMLElement;
  private folderSel: HTMLSelectElement;
  private tagBar: HTMLElement;
  private sortSel: HTMLSelectElement;
  private saveBtn: HTMLButtonElement;
  private heading = el("h1", {}, "Notes");
  private bulk: HTMLElement;
  private more: HTMLElement;
  private search: HTMLElement;
  private filters: HTMLElement;
  private keys: HTMLElement;
  /** The tab's one line under the filters. */
  private about: HTMLElement;
  /** "Also 2 in Archive": the filter's matches in the other tabs. */
  private elsewhere: HTMLElement;
  private trashHost: HTMLElement;
  tab: NotesTab = "notes";
  /** How many notes the words match in Trash, for `elsewhere`. */
  private inTrash = 0;
  private folder = "";
  /** The tag Notes is narrowed to ("" for any); its children count too. */
  private tag = "";
  private sort: QuerySort = "modified";
  private items: FeedItem[] = [];
  private page: FeedPage | null = null;
  private focus = 0;
  private selected = new Set<string>();
  /** Cards open to the whole note, and the text they show (kept so re-renders don't flash). */
  private expanded = new Set<string>();
  private full = new Map<string, { mtime: number; content: string }>();
  private scrollTop = 0;
  private seq = 0;
  private timer = 0;

  constructor(private hooks: Hooks) {
    this.input = el("input", { placeholder: "Filter notes…", spellcheck: "false", autocomplete: "off" });
    this.scopeBar = el("div", { class: "seg feed-scope", role: "group", "aria-label": "Notes, Archive or Trash" });
    this.about = el("p", { class: "feed-about" });
    this.elsewhere = el("div", { class: "feed-elsewhere" });
    this.trashHost = el("div", { class: "feed-trash" });
    this.folderSel = el("select", { class: "qt-select feed-folder", "aria-label": "Folder" });
    this.folderSel.addEventListener("change", () => ((this.folder = this.folderSel.value), (this.focus = 0), this.reload()));
    this.tagBar = el("div", { class: "feed-folders" });
    this.sortSel = el("select", { class: "qt-select feed-sort", "aria-label": "Sort" }, el("option", { value: "modified" }, "Recently changed"), el("option", { value: "date" }, "Newest by date"), el("option", { value: "oldest" }, "Oldest by date"), el("option", { value: "title" }, "By title"));
    this.sortSel.addEventListener("change", () => ((this.sort = this.sortSel.value as QuerySort), (this.focus = 0), this.reload()));
    this.saveBtn = el(
      "button",
      { type: "button", class: "chip tag-filter", title: "Keep these filters in the sidebar", onclick: () => this.hooks.saveQuery(this.saveBtn, formatQuery(this.query)) },
      icon("folderSearch", 13),
      "Save as smart folder",
    );
    this.bulk = el("div", { class: "feed-bulk", hidden: true });
    this.list = el("div", { class: "feed-list", role: "list" });
    this.more = el("div", { class: "feed-more" });
    // The sort sits in the search box, so the filters fit on one row.
    this.search = el("label", { class: "feed-search" }, icon("search", 16), this.input, this.sortSel, el("kbd", {}, "/"));
    this.filters = el("div", { class: "feed-filters" }, this.scopeBar, this.tagBar, this.folderSel, this.saveBtn);
    this.keys = el(
      "footer",
      { class: "feed-keys" },
      ...[["j k", "move"], ["n", "new"], ["↵", "expand"], ["o", "open"], ["s", "star"], ["e", "archive"], ["⌫", "delete"], ["x", "select"], ["/", "filter"]].map(([k, t]) => el("span", {}, el("kbd", {}, k), t)),
    );
    // The heading scrolls away; the search and filters stay at the top, and the list scrolls clear of them.
    const head = el("header", { class: "feed-head" }, this.search, this.filters, this.about);
    this.root.append(
      el("div", { class: "feed" }, this.heading, head, this.bulk, this.list, this.elsewhere, this.more, this.trashHost, this.keys),
    );
    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.reload(), 90);
    });
    this.root.addEventListener("keydown", (e) => this.key(e));
    // j and k scroll a card into view below the sticky header (and the bulk bar, when it shows), not under it.
    const clear = () => {
      const bar = this.bulk.hidden ? 0 : this.bulk.offsetHeight + 10;
      this.root.style.setProperty("--feed-head", `${head.offsetHeight}px`);
      this.root.style.scrollPaddingTop = `${head.offsetHeight + bar + 8}px`;
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(clear);
      ro.observe(head);
      ro.observe(this.bulk);
    }
    this.root.addEventListener("scroll", () => {
      if (!this.root.hidden) this.scrollTop = this.root.scrollTop;
      if (this.root.scrollTop + this.root.clientHeight > this.root.scrollHeight - 600) void this.loadMore();
    });
  }

  get visible() {
    return !this.root.hidden;
  }
  /** Which notes the feed lists for the tab. */
  private get scope() {
    return this.tab === "archive" ? "archived" : "active";
  }
  /** What Notes shows, as a note query: the same thing a ::query widget or a smart folder holds. */
  get query(): NoteQuery {
    const q = this.input.value.trim();
    return { ...(q && { q }), ...(this.folder && { folder: this.folder }), ...(this.tag && { tag: this.tag }), ...(this.sort !== "modified" && { sort: this.sort }) };
  }

  /** Offer to keep the filters as a smart folder, under the page's own Save button (what ⌘⇧P's command does). */
  saveFilters() {
    this.hooks.saveQuery(this.saveBtn, formatQuery(this.query));
  }

  /**
   * `name`: the smart folder whose query Notes shows exactly, or null. Its name heads the page, and
   * there's nothing to save.
   */
  named(name: string | null) {
    this.heading.textContent = name ?? "Notes";
    this.saveBtn.hidden = !!name || !formatQuery(this.query);
    if (this.visible) document.title = `${name ?? "Notes"} · Common Ink`;
  }

  /** Show the list where the reader left it: same scroll position, same cards open. */
  /** `query` replaces all the filters (a smart folder); `folder` and `tag` change just those. */
  show(opts: { tab?: NotesTab; filter?: boolean; folder?: string; tag?: string; query?: NoteQuery } = {}) {
    if (opts.query) {
      this.input.value = opts.query.q ?? "";
      this.sort = opts.query.sort ?? "modified";
      opts = { ...opts, folder: opts.query.folder ?? "", tag: opts.query.tag ?? "" };
      this.focus = 0;
      this.scrollTop = 0;
    }
    const tab = opts.tab === "trash" && !this.hooks.trash() ? "notes" : opts.tab;
    if (tab && tab !== this.tab) {
      this.tab = tab;
      this.focus = 0;
      this.scrollTop = 0;
    }
    if (opts.folder !== undefined && opts.folder !== this.folder) {
      this.folder = opts.folder;
      this.focus = 0;
      this.scrollTop = 0;
    }
    if (opts.tag !== undefined && opts.tag !== this.tag) {
      this.tag = opts.tag;
      this.focus = 0;
      this.scrollTop = 0;
    }
    this.root.hidden = false;
    this.root.scrollTop = this.scrollTop;
    void this.reload();
    (opts.filter ? this.input : this.root).focus({ preventScroll: true });
  }

  /** Re-query, keeping the focused note in place if it's still listed. */
  async reload() {
    const seq = ++this.seq;
    this.renderTabs();
    const q = this.input.value.trim();
    const trash = this.hooks.trash();
    if (this.tab === "trash") {
      this.hooks.filtersChanged();
      this.trashHost.replaceChildren(trash!.root);
      return trash!.show(q);
    }
    const keep = this.items[this.focus]?.path;
    const [page, inTrash] = await Promise.all([
      api.feed({ ...this.query, scope: this.scope, limit: Math.max(PAGE, this.items.length) }).catch(() => null),
      q && trash ? trash.count(q) : 0,
    ]);
    if (!page || seq !== this.seq) return;
    this.page = page;
    this.inTrash = inTrash;
    this.items = page.items;
    const i = keep ? this.items.findIndex((x) => x.path === keep) : -1;
    this.focus = i >= 0 ? i : Math.min(this.focus, Math.max(0, this.items.length - 1));
    for (const p of [...this.selected]) if (!this.items.some((x) => x.path === p)) this.selected.delete(p);
    this.render();
  }

  refreshSoon = debounce(() => this.visible && this.reload(), 250);

  private async loadMore() {
    if (!this.page || this.items.length >= this.page.total || this.more.dataset.loading) return;
    this.more.dataset.loading = "1";
    const page = await api.feed({ ...this.query, scope: this.scope, offset: this.items.length, limit: PAGE }).catch(() => null);
    delete this.more.dataset.loading;
    if (!page) return;
    // Draw just the new cards: the ones above stay as they are.
    const from = this.items.length;
    const q = this.input.value.trim();
    this.items.push(...page.items);
    this.list.append(...page.items.map((item, k) => this.card(item, from + k, q)));
    const { total } = this.page!;
    this.more.textContent = this.items.length < total ? `Showing ${this.items.length} of ${total}` : "";
  }

  // ---------------------------------------------------------------- rendering

  /** The tabs, the tab's line, and which half of the page shows: the cards, or Trash. */
  private renderTabs() {
    const tabs = (Object.keys(TABS) as NotesTab[]).filter((t) => t !== "trash" || this.hooks.trash());
    this.scopeBar.replaceChildren(
      ...tabs.map((t) =>
        el("button", { type: "button", class: t === this.tab ? "is-on" : "", "aria-pressed": String(t === this.tab), onclick: () => t !== this.tab && this.hooks.goTab(t) }, TABS[t].label),
      ),
    );
    this.about.textContent = TABS[this.tab].about;
    this.about.hidden = !TABS[this.tab].about;
    this.root.dataset.tab = this.tab;
    if (this.tab === "trash") this.search.hidden = false;
  }

  private render() {
    const page = this.page!;
    this.folderSel.replaceChildren(
      // A subfolder picked in the sidebar is listed too, so it shows as the filter in use.
      ...["", ...page.folders, ...(this.folder && !page.folders.includes(this.folder) ? [this.folder] : [])].map((f) => el("option", { value: f }, f || "All folders")),
    );
    this.folderSel.value = this.folder;
    this.folderSel.classList.toggle("is-on", !!this.folder);
    this.tagBar.replaceChildren(tagFilter({ current: this.tag, tags: this.hooks.tags, count: (t) => t.notes, onChange: (tag) => this.setTag(tag) }), tagList(this.tag).length === 1 ? this.hooks.starButton(this.tag) : "");
    this.sortSel.value = this.sort;
    this.saveBtn.hidden = !formatQuery(this.query);
    this.hooks.filtersChanged();
    const q = this.input.value.trim();
    const top = this.root.scrollTop;
    // With no notes at all there's nothing to filter, and with none listed nothing to move through.
    // The tabs stay: Trash may still hold something.
    const filtered = Boolean(q || this.folder || this.tag);
    const bare = !filtered && page.counts.active + page.counts.archived === 0;
    this.search.hidden = this.tagBar.hidden = this.sortSel.hidden = bare;
    this.folderSel.hidden = bare || (!page.folders.length && !this.folder);
    this.keys.hidden = !this.items.length;
    this.list.replaceChildren(...(this.items.length ? this.items.map((item, i) => this.card(item, i, q)) : [this.empty(q, filtered)]));
    this.renderElsewhere(page, filtered);
    this.root.scrollTop = top;
    this.more.textContent = this.items.length < page.total ? `Showing ${this.items.length} of ${page.total}` : "";
    this.renderBulk();
  }

  private empty(q: string, filtered: boolean): HTMLElement {
    if (filtered) {
      const which = this.tab === "archive" ? "archived " : "";
      const where = `${this.tag ? ` tagged ${tagList(this.tag).map((t) => `#${t}`).join(" and ")}` : ""}${this.folder ? ` in ${this.folder}` : ""}`;
      return emptyState({
        icon: "search",
        title: q ? `No ${which}notes${where} match “${q}”` : `No ${which}notes${where}`,
        text: ["Try other words, or clear the filters."],
        action: { label: "Clear filters", icon: "close", run: () => this.clearFilters() },
      });
    }
    if (this.tab === "archive") {
      return emptyState({
        icon: "archive",
        title: "Nothing archived",
        text: ["Archive a note you're done with: ", el("kbd", {}, "e"), " on its card, or Archive in its top bar."],
        action: { label: "Show notes", run: () => this.hooks.goTab("notes") },
      });
    }
    return emptyState({
      icon: "file",
      title: "No notes yet",
      text: ["Notes are plain markdown that you and your agents can both read and edit."],
      action: this.hooks.readOnly() ? null : { label: "New note", icon: "plus", run: () => this.hooks.newNote(this.folder ?? "") },
    });
  }

  /** What the filters find in the other tabs, one click from each: the search reaches every note, wherever it is. */
  private renderElsewhere(page: FeedPage, filtered: boolean) {
    const other: NotesTab = this.tab === "notes" ? "archive" : "notes";
    const found = ([[other, other === "archive" ? page.counts.archived : page.counts.active], ["trash", this.inTrash]] as Array<[NotesTab, number]>).filter(([, n]) => filtered && n);
    this.elsewhere.hidden = !found.length;
    this.elsewhere.replaceChildren(
      ...(found.length
        ? [
            "Also ",
            ...found.flatMap(([t, n], i) => [i ? " and " : "", el("button", { type: "button", class: "link-btn", onclick: () => this.hooks.goTab(t) }, `${n} in ${TABS[t].label}`)]),
            ".",
          ]
        : []),
    );
  }

  private clearFilters() {
    this.input.value = "";
    this.folder = this.tag = "";
    this.focus = 0;
    this.root.scrollTop = this.scrollTop = 0;
    void this.reload();
  }

  private rerender(path: string) {
    const i = this.items.findIndex((x) => x.path === path);
    const old = this.list.querySelector(`.feed-card[data-index="${i}"]`);
    if (i < 0 || !old) return;
    // The card is drawn anew; the keyboard stays on the same control in it.
    const controls = (card: Element) => [...card.querySelectorAll<HTMLElement>("a[href], button, input")];
    const at = controls(old).indexOf(document.activeElement as HTMLElement);
    const card = this.card(this.items[i], i, this.input.value.trim());
    old.replaceWith(card);
    if (at >= 0) controls(card)[at]?.focus({ preventScroll: true });
  }

  private card(item: FeedItem, i: number, q: string): HTMLElement {
    const open = this.expanded.has(item.path);
    const folder = item.path.replace(/^Archive\//, "").split("/").slice(0, -1).join("/");
    const archiveBtn = el(
      "button",
      { type: "button", class: "fc-action", title: item.archived ? "Unarchive (e)" : "Archive (e)" },
      icon(item.archived ? "unarchive" : "archive", 15),
    );
    archiveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.archive([item.path]);
    });
    const deleteBtn = this.hooks.readOnly() ? null : el("button", { type: "button", class: "fc-action", title: "Delete (⌫)" }, icon("trash", 15));
    deleteBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.delete([item.path]);
    });
    const starred = this.hooks.starred(item.id);
    const starBtn = el("button", { type: "button", class: `fc-action${starred ? " is-starred" : ""}`, title: starred ? "Unstar (s)" : "Star (s)" }, icon(starred ? "starred" : "star", 15));
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.toggleStar(item.path);
    });
    const editBtn = el("button", { type: "button", class: "fc-action", title: "Edit (o)" }, icon("edit", 15));
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.open(item.path);
    });
    const check = el("button", { type: "button", class: "fc-check", title: "Select (x)", "aria-pressed": String(this.selected.has(item.path)) }, icon("check", 12));
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(item.path);
    });
    const title = el("a", { class: "fc-title", href: notePath(item.title, item.id) }, item.title);
    title.addEventListener("click", (e) => {
      e.stopPropagation();
      const how = linkClick(e);
      if (how === "browser") return;
      e.preventDefault();
      this.hooks.open(item.path, undefined, how === "side");
    });
    const expandBtn = el("button", { type: "button", class: "fc-action fc-expand", title: open ? "Collapse (↵)" : "Expand (↵)", "aria-label": "Show the whole note", "aria-expanded": String(open) }, icon("chevron", 15));
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleExpand(i);
    });
    let body: HTMLElement;
    if (open) body = this.fullBody(item);
    else if (q && item.lines.length) {
      body = el("div", { class: "fc-hits" }, ...item.lines.map((l) => el("div", { class: "fc-hit", html: markTerms(l.text, q), onclick: (e: Event) => (e.stopPropagation(), this.hooks.open(item.path, l.line)) })));
    } else if (item.kind === "html") body = el("div", { class: "fc-body is-muted" }, "HTML note · click to preview");
    else if (item.role === "agents") body = el("div", { class: "fc-body is-muted" }, AGENTS_BLURB);
    else {
      body = this.markdown(forPreview(item.excerpt), item, "fc-body");
      body.querySelectorAll("input").forEach((b) => (b.disabled = true));
    }
    const node = el(
      "article",
      {
        class: `feed-card${open ? " is-expanded" : ""}${i === this.focus ? " is-focused" : ""}${this.selected.has(item.path) ? " is-selected" : ""}${item.archived ? " is-archived" : ""}`,
        role: "listitem",
        "data-index": String(i),
        // Drag a card to a folder in the sidebar to move it, or onto Favorites to star it.
        // Not an open card (its text is there to select) or an archived one (a folder would unarchive it).
        draggable: open || item.archived ? "false" : "true",
        ondragstart: (e: DragEvent) => {
          e.dataTransfer!.setData(NOTE_DRAG, item.path);
          e.dataTransfer!.effectAllowed = "move";
          document.body.classList.add("is-dragging");
        },
      },
      check,
      el(
        "div",
        { class: "fc-main" },
        el("div", { class: "fc-head" }, title, item.archived ? el("span", { class: "fc-badge" }, "Archived") : null, roleBadge(item), this.hooks.shared?.(item) ? el("span", { class: "fc-badge is-shared", title: "Shared outside the workspace" }, icon("share", 11), "Shared") : null, el("span", { class: "spacer" }), starBtn, editBtn, archiveBtn, deleteBtn, expandBtn),
        el(
          "div",
          { class: "fc-meta" },
          folder ? el("span", {}, folder) : null,
          item.lastSource ? el("span", { class: "fc-who" }, authorAvatar({ source: item.lastSource, ...item.lastBy }, 16), authorName({ source: item.lastSource, ...item.lastBy })) : null,
          el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime)),
        ),
        body,
        item.tags.length ? el("div", { class: "fc-tags" }, ...item.tags.map((t) => tagChip(t, () => this.setTag(t)))) : null,
        open
          ? el(
              "div",
              { class: "fc-foot" },
              el("button", { type: "button", class: "qw-btn primary", onclick: (e: Event) => (e.stopPropagation(), this.hooks.open(item.path)) }, icon("edit", 14), "Edit"),
              el("button", { type: "button", class: "qw-btn", onclick: (e: Event) => (e.stopPropagation(), this.toggleExpand(i)) }, "Collapse"),
            )
          : null,
      ),
    );
    node.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest<HTMLElement>(".tk[data-field]");
      if (chip) {
        // A task's chip: a tag narrows Notes to it; the rest open the same editor they do in Tasks.
        e.stopPropagation();
        if (chip.dataset.field === "tags") this.setTag(chip.dataset.value!);
        else void this.editChip(item, chip);
        return;
      }
      const a = t.closest("a");
      const side = sideClick(e);
      if (a) {
        const open = (target: string) =>
          calendarTarget(target) !== null ? openCalendarLink(target) : void api.resolve(target, item.path).then((p) => p && this.hooks.open(p, undefined, side));
        if (followRenderedLink(a.getAttribute("href") ?? "", node, open)) e.preventDefault();
        return;
      }
      if (side && !t.closest("button, input")) return this.hooks.open(item.path, undefined, true);
      // Reading an open card (selecting text, ticking tasks) shouldn't fold it back up.
      if (t.closest("input, .fc-full") || String(getSelection() ?? "")) return;
      this.toggleExpand(i);
    });
    node.addEventListener("mousemove", () => this.setFocus(i, false));
    node.addEventListener("focusin", () => this.setFocus(i, false));
    return node;
  }

  /** The whole note, for an expanded card. Shows the last text it had while fetching the latest. */
  private fullBody(item: FeedItem): HTMLElement {
    const cached = this.full.get(item.path);
    if (!cached || cached.mtime !== item.mtime) {
      void api
        .note(item.path)
        .then((n) => {
          this.full.set(item.path, { mtime: item.mtime, content: n.content });
          if (this.expanded.has(item.path)) this.rerender(item.path);
        })
        .catch(() => {});
    }
    if (!cached) return el("div", { class: "fc-body is-muted" }, "Loading…");
    if (item.kind === "html") {
      const frame = sandboxFrame(cached.content, { autoHeight: true, title: item.title });
      return el("div", { class: "fc-full is-html" }, frame);
    }
    const body = cached.content.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)?\s*#\s+(.+)\n/, (m, fm = "", h: string) => (h.trim() === item.title ? fm : m));
    const node = this.markdown(forPreview(body), item, "fc-body fc-full");
    hydrateDataEmbeds(node, item.path);
    node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      // Its task is the one whose chips sit in the same list item. A checkbox that isn't a task line the core reads (a numbered or quoted item) can't be ticked from here.
      const li = box.closest("li");
      const run = [...(li?.querySelectorAll<HTMLElement>(".tk-run") ?? [])].find((r) => r.closest("li") === li);
      box.disabled = item.archived || !run;
      if (run) box.addEventListener("change", () => void this.setTask(item, run, box));
    });
    return node;
  }

  /** A card's markdown, with each task's tokens drawn as chips after its words, as in Tasks. */
  private markdown(md: string, item: FeedItem, cls: string): HTMLElement {
    const { md: marked, tasks } = withTaskChips(md);
    const node = el("div", { class: `${cls}${this.hooks.readOnly() || item.archived ? " is-readonly" : ""}`, html: renderMarkdown(marked, item.path) });
    hydrateTaskChips(node, tasks);
    hydrateCode(node);
    hydrateMath(node);
    hydrateGithubLinks(node);
    // A note can write its own <span class="tk-run">, so only the ones that name a real task count.
    node.querySelectorAll<HTMLElement>(".tk-run").forEach((run) => {
      const task = tasks[+run.dataset.task!];
      if (task) run.dataset.text = task.text;
    });
    // A card's checkbox is named by its task, so a screen reader says what ticking it does.
    node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      const own = [...(box.closest("li")?.childNodes ?? [])].filter((n) => !(n instanceof HTMLElement && /^[UO]L$/.test(n.tagName)));
      const text = own.map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
      if (text) box.setAttribute("aria-label", text);
    });
    return node;
  }

  /** The task in the note that a card's task line (its `.tk-run`) shows: found by its text, the nth with that text if there are several. */
  private async taskOf(item: FeedItem, run: HTMLElement): Promise<Task | undefined> {
    const text = run.dataset.text!;
    const same = [...(run.closest(".fc-body")?.querySelectorAll<HTMLElement>(".tk-run") ?? [])].filter((r) => r.dataset.text === text);
    const tasks = await api.tasks({ note: item.path }).catch(() => []);
    return tasks.filter((t) => t.text === text)[same.indexOf(run)];
  }

  /** Open a chip's editor on its task in the note. */
  private async editChip(item: FeedItem, chip: HTMLElement) {
    if (this.hooks.readOnly() || item.archived || chip.dataset.field === "done") return;
    const task = await this.taskOf(item, chip.closest<HTMLElement>(".tk-run")!);
    if (!task) return this.hooks.toast({ text: "That task changed. Open the note to edit it." });
    openChipEditor(chip, {
      task,
      save: async (patch) => {
        await api.updateTask(task, patch);
        this.full.delete(item.path); // an open card shows the note as it is now
        this.refreshSoon();
      },
      people: taskPeople,
      showPerson: (name) => this.hooks.openPerson(name),
    });
  }

  /** Tick a task from its note's expanded card. */
  private async setTask(item: FeedItem, run: HTMLElement, box: HTMLInputElement) {
    const t = await this.taskOf(item, run);
    try {
      if (!t) throw new Error("no such task");
      await api.setTask(t, box.checked);
    } catch {
      box.checked = !box.checked;
      this.hooks.toast({ text: "Couldn't update that task. Open the note to change it." });
    }
  }

  /** Narrow Notes to a tag (and the tags under it), or "" for every note. */
  setTag(tag: string) {
    this.tag = tag;
    this.focus = 0;
    this.root.scrollTop = this.scrollTop = 0;
    void this.reload();
  }

  private toggleExpand(i: number) {
    const item = this.items[i];
    if (!item) return;
    if (this.expanded.has(item.path)) this.expanded.delete(item.path);
    else this.expanded.add(item.path);
    this.focus = i;
    this.rerender(item.path);
    this.list.querySelector(`.feed-card[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private renderBulk() {
    const n = this.selected.size;
    this.bulk.hidden = n === 0;
    if (!n) return;
    const allArchived = [...this.selected].every(isArchived);
    this.bulk.replaceChildren(
      el("span", {}, `${n} selected`),
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "qw-btn primary", onclick: () => this.archive([...this.selected]) }, icon(allArchived ? "unarchive" : "archive", 14), allArchived ? "Unarchive" : "Archive"),
      el("button", { type: "button", class: "qw-btn", title: "Download the selected notes and their files as a .zip", onclick: () => void this.exportSelected() }, icon("download", 14), "Export"),
      ...(this.hooks.readOnly() ? [] : [el("button", { type: "button", class: "qw-btn danger", onclick: () => void this.delete([...this.selected]) }, icon("trash", 14), "Delete")]),
      el("button", { type: "button", class: "qw-btn", onclick: () => (this.selected.clear(), this.render()) }, "Clear"),
    );
  }

  /** The selected notes as a .zip, with the files they use. */
  private async exportSelected() {
    try {
      const name = await (await import("./export/files.ts")).exportZip({ paths: [...this.selected] });
      this.hooks.toast({ icon: "check", text: `Exported ${name}` });
    } catch (e) {
      this.hooks.toast({ text: `Couldn't export: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private setFocus(i: number, scroll = true) {
    if (!this.items.length) return;
    this.focus = Math.max(0, Math.min(this.items.length - 1, i));
    this.list.querySelectorAll(".feed-card").forEach((c) => c.classList.toggle("is-focused", Number((c as HTMLElement).dataset.index) === this.focus));
    if (scroll) this.list.querySelector(".feed-card.is-focused")?.scrollIntoView({ block: "nearest" });
    if (this.focus >= this.items.length - 5) void this.loadMore();
  }

  private toggle(path: string) {
    if (this.selected.has(path)) this.selected.delete(path);
    else this.selected.add(path);
    this.render();
  }

  // ---------------------------------------------------------------- archiving

  /** Archive (or unarchive, if they're all archived) — with Undo. */
  async archive(paths: string[]) {
    if (!paths.length) return;
    const restore = paths.every(isArchived);
    const r = await (restore ? api.unarchive(paths) : api.archive(paths)).catch(() => null);
    if (!r) return this.hooks.toast({ text: "Couldn't archive that" });
    this.selected.clear();
    const n = r.moved.length;
    this.hooks.toast({
      icon: restore ? "unarchive" : "archive",
      text: `${restore ? "Unarchived" : "Archived"} ${n === 1 ? displayName(r.moved[0].from) : `${n} notes`}`,
      actionLabel: "Undo",
      action: async () => {
        await (restore ? api.archive : api.unarchive)(r.moved.map((m) => m.to));
        this.hooks.changed();
        await this.reload();
      },
    });
    this.hooks.changed();
    await this.reload();
  }

  /** Send notes to Trash; Undo is in the toast. */
  private async delete(paths: string[]) {
    if (!paths.length || this.hooks.readOnly()) return;
    const went = await this.hooks.delete(paths);
    for (const p of went) this.selected.delete(p);
    if (went.length) await this.reload();
  }

  // ---------------------------------------------------------------- keyboard

  private key(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inInput = e.target === this.input;
    if (inInput) {
      if ((e.key === "ArrowDown" || e.key === "Enter") && this.tab !== "trash") {
        e.preventDefault();
        this.root.focus({ preventScroll: true });
        this.setFocus(0);
        if (e.key === "Enter" && this.items[0] && !this.expanded.has(this.items[0].path)) this.toggleExpand(0);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (this.input.value) {
          this.input.value = "";
          void this.reload();
        } else this.root.focus({ preventScroll: true });
      }
      return;
    }
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    // Trash has its own buttons and no cards: of the card keys, only / (to filter) applies.
    if (this.tab === "trash") {
      if (e.key === "/") (e.preventDefault(), this.input.focus());
      return;
    }
    // Enter and Space on a link or button do what it says, not the card's shortcut.
    if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).closest("a, button, select")) return;
    const item = this.items[this.focus];
    const act: Record<string, () => void> = {
      j: () => this.setFocus(this.focus + 1),
      ArrowDown: () => this.setFocus(this.focus + 1),
      k: () => this.setFocus(this.focus - 1),
      ArrowUp: () => this.setFocus(this.focus - 1),
      g: () => this.setFocus(0),
      G: () => this.setFocus(this.items.length - 1),
      Enter: () => this.toggleExpand(this.focus),
      o: () => item && this.hooks.open(item.path),
      s: () => item && this.hooks.toggleStar(item.path),
      F2: () => item && !this.hooks.readOnly() && this.hooks.rename(item.path),
      e: () => void this.archive(this.selected.size ? [...this.selected] : item ? [item.path] : []),
      x: () => item && this.toggle(item.path),
      n: () => !this.hooks.readOnly() && this.hooks.newNote(this.folder ?? ""),
      Delete: () => void this.delete(this.selected.size ? [...this.selected] : item ? [item.path] : []),
      Backspace: () => void this.delete(this.selected.size ? [...this.selected] : item ? [item.path] : []),
      "/": () => this.input.focus(),
      Escape: () => {
        this.selected.clear();
        this.expanded.clear();
        this.render();
      },
    };
    const fn = act[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }
}

/** Why a card sits where it does: the note to start with, or the agents' instructions. */
function roleBadge(item: FeedItem): HTMLElement | null {
  if (item.role === "start") return el("span", { class: "fc-badge is-start", title: "Notes tagged start stay at the top until you archive them or remove the tag." }, "Start here");
  if (item.role === "agents") return agentsBadge();
  return null;
}

/** Widgets and bare links read better as one-line summaries in a preview. */
function forPreview(md: string): string {
  return md
    .replace(/```mermaid\n[\s\S]*?(```|$)/g, "*Diagram*")
    .split("\n")
    .map((line) => {
      const d = parseDirective(line);
      if (d && WIDGETS[d.name]) return `*${WIDGETS[d.name].title}${d.args.label ? ` · ${d.args.label}` : ""}${d.args.duration ? ` · ${d.args.duration}` : ""}*`;
      return line;
    })
    .join("\n");
}

function debounce(fn: () => unknown, ms: number) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}
