// Quick open (⌘P, or ⌘K): fuzzy jump by name + full-text search (SQLite FTS5 on the server), in one
// list. A leading `>` (or ⌘⇧P, which types it) lists the app's commands instead, and a few other
// prefixes narrow it to one kind of place: `#` the open note's headings, `@` people, `tag:` tags,
// `/` (or `folder:`) folders and smart folders.
import { api, isArchived, type NoteMeta, type SearchHit, type TagCount } from "./api.ts";
import { matchCommands, type Command } from "./commands.ts";
import { $, displayName, el, icon, markTerms, searchTerms } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { agentsBadge, isAgentsNote } from "./agentsNote.ts";
import { paletteEnter } from "./panes.ts";
import { kbd, matchKeys } from "./keys.ts";
import { people, rankPeople, type Person } from "./people.ts";

/** What the prefixes list, and what picking one does. */
export interface PaletteScopes {
  /** The open note's headings (none off a markdown note). */
  headings: () => Array<{ level: number; text: string; line: number }>;
  goToHeading: (line: number) => void;
  tags: () => TagCount[];
  openTag: (tag: string) => void;
  folders: () => string[];
  smartFolders: () => Array<{ name: string; query: string }>;
  openFolder: (path: string) => void;
  openSmartFolder: (query: string) => void;
  openPerson: (person: Person) => void;
}

type Scope = "headings" | "people" | "tags" | "folders";

/** The prefix `q` starts with, if any, and what's typed after it. */
export function scopeOf(q: string): { scope: Scope; rest: string } | null {
  const m = q.match(/^(#|@|tag:|folder:|\/)\s*/i);
  if (!m) return null;
  const p = m[1].toLowerCase();
  const scope: Scope = p === "#" ? "headings" : p === "@" ? "people" : p === "tag:" ? "tags" : "folders";
  const rest = q.slice(m[0].length).trim();
  return { scope, rest: scope === "tags" ? rest.replace(/^#/, "") : rest };
}

type Item =
  | { type: "note"; note: NoteMeta; archived?: boolean }
  | { type: "hit"; hit: SearchHit }
  | { type: "command"; command: Command }
  | { type: "create"; name: string }
  | { type: "heading"; text: string; level: number; line: number }
  | { type: "person"; person: Person }
  | { type: "tag"; tag: TagCount }
  | { type: "folder"; path: string }
  | { type: "smart"; name: string; query: string };

const SECTION: Partial<Record<Item["type"], string>> = { heading: "Headings in this note", person: "People", tag: "Tags", folder: "Folders", smart: "Smart folders" };

const kindIcon = (kind: string) => (kind === "html" ? "html" : kind === "asset" ? "image" : "file");

const sectionOf = (item: Item, q: string) =>
  SECTION[item.type] ??
  (item.type === "note" ? (item.archived ? "Archived" : q ? "Notes" : "Recent") : item.type === "hit" ? "In content" : item.type === "command" ? "Commands" : "");

/** Best match first, dropping what doesn't match; with nothing typed, all of them in their order. */
function ranked<T>(rest: string, items: T[], ...names: Array<(t: T) => string>): T[] {
  if (!rest) return items;
  return items
    .map((item) => ({ item, s: Math.max(...names.map((name) => fuzzyScore(rest, name(item)))) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

export class Palette {
  private root = $("#palette");
  private input = $<HTMLInputElement>("#palette-input");
  private list = $("#palette-results");
  private hint = $("#palette-hint");
  private items: Item[] = [];
  private active = 0;
  private seq = 0;
  private timer = 0;
  /** Where the focus goes back to when the palette closes. */
  private returnTo: HTMLElement | null = null;

  constructor(
    private notes: () => NoteMeta[],
    /** `how`: in place, to the side (⌘Enter), or in a new tab (⌥Enter). */
    private onOpen: (path: string, line: number | undefined, how: "open" | "side" | "tab") => void,
    private onCreate: (name: string) => void,
    private commands: () => Command[],
    private scopes: PaletteScopes,
  ) {
    document.querySelectorAll<HTMLElement>("kbd[data-keys]").forEach((k) => k.replaceChildren(...kbd(k.dataset.keys!).childNodes));
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
    if (this.root.hidden) this.returnTo = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.input.value = initial;
    this.input.focus();
    this.input.setSelectionRange(initial.length, initial.length); // after a `>`, typing adds to it
    this.query();
  }

  /** ⌘P / ⌘K (`initial` ""), ⌘⇧P (">"): open it that way, switch to it, or close it if it's already that way. */
  toggle(initial: "" | ">") {
    const commands = this.input.value.trim().startsWith(">");
    if (this.isOpen && commands === (initial === ">")) this.close();
    else this.open(initial);
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.input.removeAttribute("aria-activedescendant");
    if (this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    this.returnTo = null;
  }

  private query() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    clearTimeout(this.timer);
    if (q.startsWith(">")) {
      return this.render(
        matchCommands(q.slice(1), this.commands()).map((command) => ({ type: "command", command })),
        q,
      );
    }
    const scoped = scopeOf(q);
    if (scoped) return this.scoped(scoped.scope, scoped.rest, q, seq);
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
    const exact = this.notes().some((n) => displayName(n.path).toLowerCase() === q.toLowerCase() || n.title.toLowerCase() === q.toLowerCase());
    const create: Item[] = q && !exact ? [{ type: "create", name: q }] : [];
    this.render([...names, ...archived, ...create], q);
    if (q.length < 2) return;
    this.timer = window.setTimeout(async () => {
      const hits = await api.search(q).catch(() => []);
      if (seq !== this.seq) return;
      const shown = new Set(names.map((n) => n.note.path));
      const content = hits.filter((h) => !shown.has(h.path) || h.lines.length).slice(0, 10).map((hit) => ({ type: "hit" as const, hit }));
      this.render([...names, ...content, ...archived, ...create], q);
    }, 70);
  }

  /** A prefix's list: one kind of place, matched by name. */
  private scoped(scope: Scope, rest: string, q: string, seq: number) {
    const s = this.scopes;
    if (scope === "headings") {
      const items = ranked(rest, s.headings(), (h) => h.text).map((h): Item => ({ type: "heading", ...h }));
      return this.render(items, q);
    }
    if (scope === "tags") {
      const tags = ranked(rest, s.tags(), (t) => t.display).slice(0, 30);
      return this.render(tags.map((tag): Item => ({ type: "tag", tag })), q);
    }
    if (scope === "folders") {
      const smart = ranked(rest, s.smartFolders(), (f) => f.name).slice(0, 6).map((f): Item => ({ type: "smart", ...f }));
      const folders = ranked(rest, s.folders(), (f) => f.slice(f.lastIndexOf("/") + 1), (f) => f).slice(0, 30);
      return this.render([...folders.map((path): Item => ({ type: "folder", path })), ...smart], q);
    }
    this.render(this.items.filter((i) => i.type === "person"), q); // the last list while people load
    void people().then(({ contacts, members }) => {
      if (seq !== this.seq) return;
      this.render(rankPeople(rest, contacts, members, { contacts: 20, members: 8 }).map((person): Item => ({ type: "person", person })), q);
    });
  }

  private render(items: Item[], q: string) {
    this.hint.hidden = q !== "";
    this.items = items;
    this.active = Math.min(this.active, Math.max(0, items.length - 1));
    if (!q || q === ">") this.active = 0;
    const rows: HTMLElement[] = [];
    let section = "";
    let group: HTMLElement | null = null;
    items.forEach((item, i) => {
      const sec = sectionOf(item, q);
      if (sec !== section) {
        const id = `palette-sec-${rows.length}`;
        group = sec ? el("div", { role: "group", "aria-labelledby": id }, el("div", { class: "palette-section", id, role: "presentation" }, sec)) : null;
        if (group) rows.push(group);
        section = sec;
      }
      const row = this.row(item, q);
      row.dataset.index = String(i);
      row.id = `palette-opt-${i}`;
      row.addEventListener("mousemove", () => this.setActive(i));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(i);
      });
      if (group) group.append(row);
      else rows.push(row);
    });
    if (!items.length) rows.push(el("div", { class: "palette-empty" }, q.startsWith(">") ? "No command matches" : emptyText(q)));
    this.list.replaceChildren(...rows);
    this.setActive(this.active);
  }

  private row(item: Item, q: string): HTMLElement {
    const place = (ico: string, title: string, detail = "") =>
      el("div", { class: "palette-item", role: "option" }, icon(ico, 15), el("span", { class: "pi-title" }, title), detail ? el("span", { class: "pi-path" }, detail) : null);
    if (item.type === "heading") return place("heading", item.text, "#".repeat(item.level));
    if (item.type === "person") return place("user", item.person.name, item.person.kind === "member" ? `${item.person.detail} · no contact yet` : item.person.detail);
    if (item.type === "tag") return place("hash", item.tag.display, String(item.tag.notes || item.tag.tasks || ""));
    if (item.type === "folder") return place("folder", item.path.slice(item.path.lastIndexOf("/") + 1), item.path.includes("/") ? item.path : "");
    if (item.type === "smart") return place("folderSearch", item.name, item.query);
    if (item.type === "command") {
      const c = item.command;
      return el(
        "div",
        { class: "palette-item is-command", role: "option" },
        icon(c.icon ?? "spark", 15),
        el("span", { class: "pi-title" }, c.title),
        c.keys ? kbd(c.keys[0]) : null,
      );
    }
    if (item.type === "create") {
      return el("div", { class: "palette-item is-create", role: "option" }, icon("plus", 15), el("span", { class: "pi-title" }, `Create “${item.name}”`), kbd("Shift-Enter"));
    }
    if (item.type === "note") {
      const n = item.note;
      return el(
        "div",
        { class: "palette-item", role: "option" },
        icon(kindIcon(n.kind), 15),
        el("span", { class: "pi-title" }, n.kind === "asset" ? displayName(n.path) : n.title),
        isAgentsNote(n.path) ? agentsBadge() : null,
        el("span", { class: "pi-path" }, n.path),
      );
    }
    const h = item.hit;
    const terms = searchTerms(q);
    let text = (h.lines[0]?.text ?? h.snippet.replace(/[\u0001\u0002]/g, "")).replace(/^[-*>#\s]+/, "");
    const at = terms ? text.search(new RegExp(terms, "i")) : -1;
    if (at > 36) text = `…${text.slice(at - 28)}`; // keep the match in view
    const marked = markTerms(text, q);
    return el(
      "div",
      { class: "palette-item is-hit", role: "option" },
      icon(kindIcon(h.kind), 15),
      el(
        "div",
        { class: "pi-stack" },
        el("div", { class: "pi-row" }, el("span", { class: "pi-title" }, h.title), isAgentsNote(h.path) ? agentsBadge() : null, el("span", { class: "pi-path" }, h.lines[0] ? `${h.path}:${h.lines[0].line}` : h.path)),
        el("div", { class: "pi-snippet", html: marked }),
      ),
    );
  }

  private setActive(i: number) {
    this.active = i;
    this.list.querySelectorAll<HTMLElement>(".palette-item").forEach((r) => {
      const on = Number(r.dataset.index) === i;
      r.classList.toggle("is-active", on);
      r.setAttribute("aria-selected", String(on));
    });
    const row = this.list.querySelector<HTMLElement>(".is-active");
    if (row) this.input.setAttribute("aria-activedescendant", row.id);
    else this.input.removeAttribute("aria-activedescendant");
    row?.scrollIntoView?.({ block: "nearest" });
  }

  private choose(i: number, how: ReturnType<typeof paletteEnter> = "open") {
    const item = this.items[i];
    const q = this.input.value.trim();
    this.close();
    if (item?.type === "command") return void item.command.run();
    if (q.startsWith(">")) return;
    const s = this.scopes;
    if (item?.type === "heading") return s.goToHeading(item.line);
    if (item?.type === "person") return s.openPerson(item.person);
    if (item?.type === "tag") return s.openTag(item.tag.display);
    if (item?.type === "folder") return s.openFolder(item.path);
    if (item?.type === "smart") return s.openSmartFolder(item.query);
    if (scopeOf(q)) return; // Shift-Enter doesn't make a note called "#…" or "@…"
    if (how === "create" || item?.type === "create") return q && this.onCreate(q);
    if (!item) return;
    if (item.type === "note") this.onOpen(item.note.path, undefined, how);
    else if (item.type === "hit") this.onOpen(item.hit.path, item.hit.lines[0]?.line, how);
  }

  private key(e: KeyboardEvent) {
    // Ctrl+N/J and Ctrl+P/K move too (Ctrl on a Mac as well), by the letter typed.
    const down = e.key === "ArrowDown" || matchKeys(e, "Ctrl-n") || matchKeys(e, "Ctrl-j");
    const up = e.key === "ArrowUp" || matchKeys(e, "Ctrl-p") || matchKeys(e, "Ctrl-k");
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
    } else if (e.key === "Tab") {
      e.preventDefault(); // the field is all there is to focus in here
    }
  }
}

/** What an empty list says, by prefix. */
function emptyText(q: string): string {
  const scope = scopeOf(q)?.scope;
  if (scope === "headings") return "No headings match in this note";
  if (scope === "people") return "No one matches";
  if (scope === "tags") return "No tag matches";
  if (scope === "folders") return "No folder matches";
  return "Nothing found";
}
