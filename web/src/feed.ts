// The feed: every note as a stream of cards, newest first. Filter as you type, triage from the
// keyboard (j/k, Enter, e to archive, x to select), and archive in bulk.
import { api, type FeedItem, type FeedPage, type Scope } from "./api.ts";
import { $, avatar, displayName, el, escapeHtml, icon, timeAgo } from "./dom.ts";
import { renderMarkdown } from "./render.ts";
import { parseDirective } from "./widgets/args.ts";
import { WIDGETS } from "./widgets/index.ts";

interface Hooks {
  open(path: string, line?: number): void;
  toast(t: { text: string; icon?: string; actionLabel?: string; action?: () => void }): void;
  changed(): void;
}

const PAGE = 40;

export class Feed {
  readonly root = $("#feed-view");
  private input: HTMLInputElement;
  private list: HTMLElement;
  private scopeBar: HTMLElement;
  private folderBar: HTMLElement;
  private bulk: HTMLElement;
  private more: HTMLElement;
  private scope: Scope = "active";
  private folder = "";
  private items: FeedItem[] = [];
  private page: FeedPage | null = null;
  private focus = 0;
  private selected = new Set<string>();
  private seq = 0;
  private timer = 0;

  constructor(private hooks: Hooks) {
    this.input = el("input", { placeholder: "Filter notes…", spellcheck: "false", autocomplete: "off" });
    this.scopeBar = el("div", { class: "seg feed-scope" });
    this.folderBar = el("div", { class: "feed-folders" });
    this.bulk = el("div", { class: "feed-bulk", hidden: true });
    this.list = el("div", { class: "feed-list", role: "list" });
    this.more = el("div", { class: "feed-more" });
    this.root.append(
      el(
        "div",
        { class: "feed" },
        el(
          "header",
          { class: "feed-head" },
          el("h1", {}, "Feed"),
          el("label", { class: "feed-search" }, icon("search", 16), this.input, el("kbd", {}, "/")),
          el("div", { class: "feed-filters" }, this.scopeBar, this.folderBar),
        ),
        this.bulk,
        this.list,
        this.more,
        el("footer", { class: "feed-keys" }, ...[["j k", "move"], ["↵", "open"], ["e", "archive"], ["x", "select"], ["/", "filter"]].map(([k, t]) => el("span", {}, el("kbd", {}, k), t))),
      ),
    );
    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.reload(), 90);
    });
    this.root.addEventListener("keydown", (e) => this.key(e));
    this.root.addEventListener("scroll", () => {
      if (this.root.scrollTop + this.root.clientHeight > this.root.scrollHeight - 600) void this.loadMore();
    });
  }

  get visible() {
    return !this.root.hidden;
  }

  show(opts: { scope?: Scope; filter?: boolean } = {}) {
    if (opts.scope) this.scope = opts.scope;
    this.root.hidden = false;
    void this.reload();
    (opts.filter ? this.input : this.root).focus({ preventScroll: true });
  }

  hide() {
    this.root.hidden = true;
  }

  /** Re-query, keeping the focused note in place if it's still listed. */
  async reload() {
    const seq = ++this.seq;
    const keep = this.items[this.focus]?.path;
    const page = await api.feed({ q: this.input.value.trim(), scope: this.scope, folder: this.folder, limit: Math.max(PAGE, this.items.length) }).catch(() => null);
    if (!page || seq !== this.seq) return;
    this.page = page;
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
    const page = await api.feed({ q: this.input.value.trim(), scope: this.scope, folder: this.folder, offset: this.items.length, limit: PAGE }).catch(() => null);
    delete this.more.dataset.loading;
    if (!page) return;
    this.items.push(...page.items);
    this.render();
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    const page = this.page!;
    const scopes: Array<[Scope, string, number | null]> = [
      ["active", "Active", page.counts.active],
      ["archived", "Archived", page.counts.archived],
      ["all", "All", null],
    ];
    this.scopeBar.replaceChildren(
      ...scopes.map(([s, label, n]) =>
        el(
          "button",
          { type: "button", class: s === this.scope ? "is-on" : "", onclick: () => ((this.scope = s), (this.focus = 0), this.reload()) },
          label,
          n !== null ? el("span", { class: "n" }, String(n)) : null,
        ),
      ),
    );
    this.folderBar.replaceChildren(
      ...["", ...page.folders].map((f) =>
        el("button", { type: "button", class: `chip${f === this.folder ? " is-on" : ""}`, onclick: () => ((this.folder = f), (this.focus = 0), this.reload()) }, f || "All folders"),
      ),
    );
    const q = this.input.value.trim();
    this.list.replaceChildren(
      ...(this.items.length
        ? this.items.map((item, i) => this.card(item, i, q))
        : [el("div", { class: "feed-empty" }, q ? `No ${this.scope === "all" ? "" : this.scope + " "}notes match “${q}”.` : this.scope === "archived" ? "Nothing archived yet. Press e on a note to archive it." : "No notes yet.")]),
    );
    this.more.textContent = this.items.length < page.total ? `Showing ${this.items.length} of ${page.total}` : "";
    this.renderBulk();
  }

  private card(item: FeedItem, i: number, q: string): HTMLElement {
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
    const check = el("button", { type: "button", class: "fc-check", title: "Select (x)" }, icon("check", 12));
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(item.path);
    });
    const body =
      q && item.lines.length
        ? el("div", { class: "fc-hits" }, ...item.lines.map((l) => el("div", { class: "fc-hit", html: highlight(l.text, q), onclick: (e: Event) => (e.stopPropagation(), this.hooks.open(item.path, l.line)) })))
        : item.kind === "html"
          ? el("div", { class: "fc-body is-muted" }, "HTML note")
          : el("div", { class: "fc-body", html: renderMarkdown(forPreview(item.excerpt), item.path) });
    body.querySelectorAll("input").forEach((b) => (b.disabled = true));
    const node = el(
      "article",
      {
        class: `feed-card${i === this.focus ? " is-focused" : ""}${this.selected.has(item.path) ? " is-selected" : ""}${item.archived ? " is-archived" : ""}`,
        role: "listitem",
        "data-index": String(i),
      },
      check,
      el(
        "div",
        { class: "fc-main" },
        el("div", { class: "fc-head" }, el("span", { class: "fc-title" }, item.title), item.archived ? el("span", { class: "fc-badge" }, "Archived") : null, el("span", { class: "spacer" }), archiveBtn),
        el(
          "div",
          { class: "fc-meta" },
          folder ? el("span", {}, folder) : null,
          item.lastSource ? el("span", { class: "fc-who" }, avatar(item.lastSource, 16), item.lastSource) : null,
          el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime)),
        ),
        body,
        item.tags.length ? el("div", { class: "fc-tags" }, ...item.tags.map((t) => el("span", { class: "tag" }, `#${t}`))) : null,
      ),
    );
    node.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a");
      if (a) {
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
        else if (href.startsWith("quire:")) void api.resolve(decodeURIComponent(href.slice(6)), item.path).then((p) => p && this.hooks.open(p));
        return;
      }
      this.hooks.open(item.path);
    });
    node.addEventListener("mousemove", () => this.setFocus(i, false));
    return node;
  }

  private renderBulk() {
    const n = this.selected.size;
    this.bulk.hidden = n === 0;
    if (!n) return;
    const allArchived = [...this.selected].every((p) => p.startsWith("Archive/"));
    this.bulk.replaceChildren(
      el("span", {}, `${n} selected`),
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "qw-btn primary", onclick: () => this.archive([...this.selected]) }, icon(allArchived ? "unarchive" : "archive", 14), allArchived ? "Unarchive" : "Archive"),
      el("button", { type: "button", class: "qw-btn", onclick: () => (this.selected.clear(), this.render()) }, "Clear"),
    );
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
    const restore = paths.every((p) => p.startsWith("Archive/"));
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

  // ---------------------------------------------------------------- keyboard

  private key(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inInput = e.target === this.input;
    if (inInput) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        this.root.focus({ preventScroll: true });
        if (e.key === "Enter" && this.items[0]) this.hooks.open(this.items[0].path);
        else this.setFocus(0);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (this.input.value) {
          this.input.value = "";
          void this.reload();
        } else this.root.focus({ preventScroll: true });
      }
      return;
    }
    const item = this.items[this.focus];
    const act: Record<string, () => void> = {
      j: () => this.setFocus(this.focus + 1),
      ArrowDown: () => this.setFocus(this.focus + 1),
      k: () => this.setFocus(this.focus - 1),
      ArrowUp: () => this.setFocus(this.focus - 1),
      g: () => this.setFocus(0),
      G: () => this.setFocus(this.items.length - 1),
      Enter: () => item && this.hooks.open(item.path),
      o: () => item && this.hooks.open(item.path),
      e: () => void this.archive(this.selected.size ? [...this.selected] : item ? [item.path] : []),
      x: () => item && this.toggle(item.path),
      "/": () => this.input.focus(),
      Escape: () => (this.selected.clear(), this.render()),
    };
    const fn = act[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }
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

function highlight(text: string, q: string): string {
  const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const safe = escapeHtml(text);
  return terms.length ? safe.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}

function debounce(fn: () => unknown, ms: number) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}
