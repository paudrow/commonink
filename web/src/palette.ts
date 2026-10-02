// Quick open (⌘P, or ⌘K): fuzzy jump by name + full-text search (SQLite FTS5 on the server), in one
// list. A leading `>` (or ⌘⇧P, which types it) lists the app's commands instead, and a few other
// prefixes narrow it to one kind of place: `#` the open note's headings, `@` people, `tag:` tags,
// `/` (or `folder:`) folders and smart folders. A command that needs something typed (a name, a
// folder, a tag) asks for it here, as a step in the same field, so you never leave the palette.
import { api, isArchived, type NoteMeta, type SearchHit, type TagCount } from "./api.ts";
import { matchCommands, type Command, type PaletteChoice, type PaletteStep } from "./commands.ts";
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
  | { type: "smart"; name: string; query: string }
  | { type: "choice"; choice: PaletteChoice }
  | { type: "enter"; label: string };

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

/** A step the palette is on: its question, its choices once loaded, and how to get back to what was before it. */
interface OnStep {
  step: PaletteStep;
  choices: PaletteChoice[] | null;
  /** What the field held before this step: the command query, or the last step's answer. */
  back: string;
}

export class Palette {
  private root = $("#palette");
  private input = $<HTMLInputElement>("#palette-input");
  private list = $("#palette-results");
  private hint = $("#palette-hint");
  /** The step's name before the field (a chip), while a command asks for something. */
  private chip = el("span", { class: "palette-step", hidden: "" });
  /** The keys a step takes, in place of quick open's. */
  private stepFoot = el("div", { class: "palette-foot palette-step-foot", hidden: "" }, el("span", {}, kbd("Enter"), " choose"), el("span", {}, kbd("Escape"), " or ", kbd("Backspace"), " back"));
  private placeholder = this.input.placeholder;
  private hintHtml = this.hint.innerHTML;
  /** The steps taken, the current one last; empty when the palette is searching. */
  private steps: OnStep[] = [];
  /** A step's submit is running: Enter waits for it. */
  private busy = false;
  private items: Item[] = [];
  private active = 0;
  private seq = 0;
  private timer = 0;
  /** Where the focus goes back to when the palette closes. */
  private returnTo: HTMLElement | null = null;

  constructor(
    private notes: () => NoteMeta[],
    /** `side`: open it to the side (⌘Enter). */
    private onOpen: (path: string, line?: number, side?: boolean) => void,
    private onCreate: (name: string) => void,
    private commands: () => Command[],
    private scopes: PaletteScopes,
  ) {
    document.querySelectorAll<HTMLElement>("kbd[data-keys]").forEach((k) => k.replaceChildren(...kbd(k.dataset.keys!).childNodes));
    this.input.before(this.chip);
    (this.root.querySelector(".palette-foot") ?? this.hint).after(this.stepFoot);
    this.hintHtml = this.hint.innerHTML;
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
    this.leaveSteps();
    this.root.hidden = false;
    this.input.value = initial;
    this.input.focus();
    this.input.setSelectionRange(initial.length, initial.length); // after a `>`, typing adds to it
    this.query();
  }

  /** ⌘P / ⌘K (`initial` ""), ⌘⇧P (">"): open it that way, switch to it, or close it if it's already that way. */
  toggle(initial: "" | ">") {
    const commands = !this.steps.length && this.input.value.trim().startsWith(">");
    if (this.isOpen && commands === (initial === ">")) this.close();
    else this.open(initial);
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.leaveSteps();
    this.input.removeAttribute("aria-activedescendant");
    if (this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    this.returnTo = null;
  }

  /** The step it's on, or null. */
  private get onStep(): OnStep | null {
    return this.steps[this.steps.length - 1] ?? null;
  }

  /** Ask `step` in the field, after whatever it's on now. */
  private enterStep(step: PaletteStep) {
    this.steps.push({ step, choices: null, back: this.input.value });
    this.showStep();
  }

  /** Back a step: to the one before, or to the commands it came from. */
  private stepBack() {
    const was = this.steps.pop();
    if (!was) return;
    if (this.steps.length) this.showStep(was.back);
    else {
      this.drawStep();
      this.input.value = was.back;
      this.query();
    }
  }

  private leaveSteps() {
    this.steps = [];
    this.busy = false;
    this.drawStep();
  }

  /** The chip, the placeholder and the hint for the step it's on (or for searching, with none). */
  private drawStep(error = "") {
    const on = this.onStep;
    this.chip.hidden = !on;
    this.stepFoot.hidden = !on;
    this.root.classList.toggle("is-step", !!on);
    this.chip.replaceChildren(...(on ? [icon(on.step.icon ?? "spark", 13), el("span", {}, on.step.title)] : []));
    this.input.placeholder = on ? on.step.placeholder : this.placeholder;
    this.input.setAttribute("aria-label", on ? `${on.step.title}: ${on.step.placeholder}` : "Search notes and commands");
    this.hint.classList.toggle("is-error", !!error);
    if (error) this.hint.textContent = error;
    else if (on) this.hint.textContent = on.step.hint ?? "";
    else this.hint.innerHTML = this.hintHtml;
  }

  /** Show the step it's on: its field (`value`, or the step's own start), and its choices once they load. */
  private showStep(value?: string) {
    const on = this.onStep!;
    this.drawStep();
    this.input.value = value ?? on.step.value ?? "";
    this.input.focus();
    this.input.select();
    this.active = 0;
    this.query();
    if (on.step.choices && !on.choices) {
      void Promise.resolve(on.step.choices()).then((choices) => {
        on.choices = choices;
        if (this.onStep === on) this.query();
      });
    }
  }

  /** The step's rows for what's typed: the choices it matches, then the row for the typed text. */
  private stepItems(on: OnStep, q: string): Item[] {
    const choices = ranked(q, on.choices ?? [], (c) => c.label, (c) => c.detail ?? "").slice(0, 50);
    const exact = choices.some((c) => c.label.toLowerCase() === q.toLowerCase() || c.value.toLowerCase() === q.toLowerCase());
    const label = !exact && on.step.enter?.(q);
    return [...choices.map((choice): Item => ({ type: "choice", choice })), ...(label ? [{ type: "enter" as const, label }] : [])];
  }

  /** Answer the step: the next step, an error (it stays), or done (it closes). */
  private async answer(value: string, picked: boolean) {
    const on = this.onStep;
    if (!on || this.busy) return;
    this.busy = true;
    let next: Awaited<ReturnType<PaletteStep["submit"]>>;
    try {
      next = await on.step.submit(value, picked);
    } catch (e) {
      next = { error: e instanceof Error ? e.message : "That didn't work" };
    }
    this.busy = false;
    if (this.onStep !== on) return; // closed, or moved on, meanwhile
    if (!next) return this.close();
    if ("error" in next) {
      this.hint.hidden = false;
      return this.drawStep(next.error);
    }
    this.enterStep(next);
  }

  private query() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    clearTimeout(this.timer);
    const on = this.onStep;
    if (on) {
      this.drawStep();
      this.render(this.stepItems(on, q), q);
      this.hint.hidden = !this.hint.textContent;
      return;
    }
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
    if (!items.length) {
      const on = this.onStep;
      const empty = on ? stepEmpty(on) : q.startsWith(">") ? "No command matches" : emptyText(q);
      if (empty) rows.push(el("div", { class: "palette-empty" }, empty));
    }
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
    if (item.type === "choice") return place(item.choice.icon ?? "chevron", item.choice.label, item.choice.detail);
    if (item.type === "enter") {
      return el("div", { class: "palette-item is-create", role: "option" }, icon(this.onStep?.step.icon ?? "plus", 15), el("span", { class: "pi-title" }, item.label), kbd("Enter"));
    }
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
    if (this.steps.length) {
      if (item?.type === "choice") void this.answer(item.choice.value, true);
      else if (item?.type === "enter") void this.answer(q, false);
      return;
    }
    if (item?.type === "command" && item.command.ask) {
      const step = item.command.ask();
      return step ? this.enterStep(step) : this.close();
    }
    this.close();
    if (item?.type === "command") return void item.command.run?.();
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
    if (item.type === "note") this.onOpen(item.note.path, undefined, how === "side");
    else if (item.type === "hit") this.onOpen(item.hit.path, item.hit.lines[0]?.line, how === "side");
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
      if (this.steps.length) this.stepBack();
      else this.close();
    } else if (e.key === "Backspace" && this.steps.length && !this.input.value) {
      e.preventDefault();
      this.stepBack();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the field is all there is to focus in here
    }
  }
}

/** What a step's empty list says: still loading, nothing to pick at all, or nothing matching what's typed. */
function stepEmpty(on: OnStep): string {
  if (!on.step.choices) return "";
  if (!on.choices) return "Loading…";
  return on.choices.length ? "Nothing matches" : (on.step.empty ?? "Nothing to pick");
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
