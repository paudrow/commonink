// ⌘K: fuzzy jump by name + full-text search (SQLite FTS5 on the server), in one list.
import { api, isArchived, type NoteMeta, type SearchHit } from "./api.ts";
import { $, displayName, el, escapeHtml, icon } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { MOD_ENTER, paletteEnter } from "./panes.ts";
import { matchShortcut } from "./keys.ts";

type Item =
  | { type: "note"; note: NoteMeta; archived?: boolean }
  | { type: "hit"; hit: SearchHit }
  | { type: "create"; name: string };

const kindIcon = (kind: string) => (kind === "html" ? "html" : kind === "asset" ? "image" : "file");

export class Palette {
  private root = $("#palette");
  private input = $<HTMLInputElement>("#palette-input");
  private list = $("#palette-results");
  private items: Item[] = [];
  private active = 0;
  private seq = 0;
  private timer = 0;

  constructor(
    private notes: () => NoteMeta[],
    /** `side`: open it to the side (⌘Enter). */
    private onOpen: (path: string, line?: number, side?: boolean) => void,
    private onCreate: (name: string) => void,
  ) {
    this.root.querySelector(".palette-side")!.textContent = MOD_ENTER;
    this.input.addEventListener("input", () => this.query());
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(initial = "") {
    this.root.hidden = false;
    this.input.value = initial;
    this.input.focus();
    this.input.select();
    this.query();
  }

  close() {
    this.root.hidden = true;
  }

  private query() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    const score = (note: NoteMeta) => (q ? Math.max(fuzzyScore(q, note.title), fuzzyScore(q, note.path) - 50) : note.mtime);
    const archived = q
      ? this.notes()
          .filter((n) => isArchived(n.path))
          .map((note) => ({ note, score: score(note) }))
          .filter((x) => x.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)
          .map((x) => ({ type: "note" as const, note: x.note, archived: true }))
      : [];
    const names = this.notes()
      .filter((n) => !isArchived(n.path))
      .map((note) => ({ note, score: q ? Math.max(fuzzyScore(q, note.title), fuzzyScore(q, note.path) - 50) : note.mtime }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, q ? 6 : 9)
      .map((x) => ({ type: "note" as const, note: x.note }));
    const base: Item[] = [...names, ...archived];
    const exact = this.notes().some((n) => displayName(n.path).toLowerCase() === q.toLowerCase() || n.title.toLowerCase() === q.toLowerCase());
    if (q && !exact) base.push({ type: "create", name: q });
    this.render(base, q);
    clearTimeout(this.timer);
    if (q.length < 2) return;
    this.timer = window.setTimeout(async () => {
      const hits = await api.search(q).catch(() => []);
      if (seq !== this.seq) return;
      const shown = new Set(names.map((n) => n.note.path));
      const content = hits.filter((h) => !shown.has(h.path) || h.lines.length).slice(0, 10).map((hit) => ({ type: "hit" as const, hit }));
      const create = base.filter((i) => i.type === "create");
      this.render([...names, ...content, ...archived, ...create], q);
    }, 70);
  }

  private render(items: Item[], q: string) {
    this.items = items;
    this.active = Math.min(this.active, Math.max(0, items.length - 1));
    if (!q) this.active = 0;
    const rows: HTMLElement[] = [];
    let section = "";
    items.forEach((item, i) => {
      const sec = item.type === "note" ? (item.archived ? "Archived" : q ? "Notes" : "Recent") : item.type === "hit" ? "In content" : "";
      if (sec && sec !== section) {
        rows.push(el("div", { class: "palette-section" }, sec));
        section = sec;
      }
      const row = this.row(item, q);
      row.dataset.index = String(i);
      row.addEventListener("mousemove", () => this.setActive(i));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(i);
      });
      rows.push(row);
    });
    if (!items.length) rows.push(el("div", { class: "palette-empty" }, "Nothing found"));
    this.list.replaceChildren(...rows);
    this.setActive(this.active);
  }

  private row(item: Item, q: string): HTMLElement {
    if (item.type === "create") {
      return el("div", { class: "palette-item is-create", role: "option" }, icon("plus", 15), el("span", { class: "pi-title" }, `Create “${item.name}”`), el("kbd", {}, "⇧↵"));
    }
    if (item.type === "note") {
      const n = item.note;
      return el(
        "div",
        { class: "palette-item", role: "option" },
        icon(kindIcon(n.kind), 15),
        el("span", { class: "pi-title" }, n.kind === "asset" ? displayName(n.path) : n.title),
        el("span", { class: "pi-path" }, n.path),
      );
    }
    const h = item.hit;
    const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let text = (h.lines[0]?.text ?? h.snippet.replace(/[\u0001\u0002]/g, "")).replace(/^[-*>#\s]+/, "");
    const at = terms.length ? text.search(new RegExp(terms.join("|"), "i")) : -1;
    if (at > 36) text = `…${text.slice(at - 28)}`; // keep the match in view
    const snippet = escapeHtml(text);
    const marked = terms.length ? snippet.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : snippet;
    return el(
      "div",
      { class: "palette-item is-hit", role: "option" },
      icon(kindIcon(h.kind), 15),
      el(
        "div",
        { class: "pi-stack" },
        el("div", { class: "pi-row" }, el("span", { class: "pi-title" }, h.title), el("span", { class: "pi-path" }, h.lines[0] ? `${h.path}:${h.lines[0].line}` : h.path)),
        el("div", { class: "pi-snippet", html: marked }),
      ),
    );
  }

  private setActive(i: number) {
    this.active = i;
    this.list.querySelectorAll(".palette-item").forEach((r) => r.classList.toggle("is-active", Number((r as HTMLElement).dataset.index) === i));
    this.list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  private choose(i: number, how: ReturnType<typeof paletteEnter> = "open") {
    const item = this.items[i];
    const q = this.input.value.trim();
    this.close();
    if (how === "create" || item?.type === "create") return q && this.onCreate(q);
    if (!item) return;
    if (item.type === "note") this.onOpen(item.note.path, undefined, how === "side");
    else if (item.type === "hit") this.onOpen(item.hit.path, item.hit.lines[0]?.line, how === "side");
  }

  private key(e: KeyboardEvent) {
    // Ctrl+N/J and Ctrl+P/K move too (Ctrl on a Mac as well), by the letter typed.
    const down = e.key === "ArrowDown" || matchShortcut(e, "Ctrl+n") || matchShortcut(e, "Ctrl+j");
    const up = e.key === "ArrowUp" || matchShortcut(e, "Ctrl+p") || matchShortcut(e, "Ctrl+k");
    if (down || up) {
      e.preventDefault();
      const n = this.items.length;
      if (n) this.setActive((this.active + (down ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.choose(this.active, paletteEnter(e));
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  }
}
