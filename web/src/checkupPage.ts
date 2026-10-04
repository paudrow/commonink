// Check up on this workspace (⌘⇧P): what may need tending, each with its fix a click away. Dead
// links open where they are; duplicate contacts go to Contacts, whose banner merges them; empty
// notes can be deleted (with Undo); notes nothing links to can be archived, as a suggestion; and
// long-overdue tasks open where they are. A section shows only when it has something. The findings
// come from src/core/checkup.ts (GET /api/checkup, `commonink checkup`).
import { api } from "./api.ts";
import { displayName, el, icon } from "./dom.ts";
import { pageHeader } from "./pageHeader.ts";
import { emptyState } from "./emptyState.ts";
import { STALE_DAYS, findings, type Checkup } from "../../src/core/checkup.ts";

interface Hooks {
  open(path: string, line?: number): void;
  contacts(): void;
  /** Delete a note (to Trash, with Undo); resolves once it's done or refused. */
  delete(path: string): Promise<unknown>;
  archive(path: string): Promise<unknown>;
  /** A viewer (online) can't change anything: no Delete or Archive. */
  readOnly(): boolean;
}

export class CheckupPage {
  private body = el("div", { class: "cu-body" }, el("div", { class: "qt-empty" }, "Looking…"));
  private seq = 0;

  constructor(
    readonly root: HTMLElement,
    private hooks: Hooks,
  ) {
    root.append(
      el(
        "div",
        { class: "page" },
        pageHeader({ title: "Check-up", sub: "Things in this workspace that may need tending. Each one has its fix right beside it." }),
        this.body,
      ),
    );
  }

  get visible() {
    return !this.root.hidden;
  }

  async show() {
    this.root.hidden = false;
    await this.load();
  }

  /** Look again: on show, and after a fix here. */
  async load() {
    const seq = ++this.seq;
    const c = await api.checkup().catch(() => null);
    if (seq !== this.seq) return;
    if (!c) return this.body.replaceChildren(el("div", { class: "qt-empty" }, "Couldn't run the check-up. Try again in a moment."));
    this.render(c);
  }

  private render(c: Checkup) {
    if (!findings(c)) {
      this.body.replaceChildren(
        emptyState({ icon: "check", title: "All clear", text: ["No dead links, duplicate contacts, empty notes, unlinked notes or long-overdue tasks."] }),
      );
      return;
    }
    const edit = !this.hooks.readOnly();
    const fix = (label: string, run: () => unknown, title?: string) =>
      el("button", { type: "button", class: "qw-btn", title, onclick: async (e: Event) => ((e.currentTarget as HTMLButtonElement).disabled = true, await run(), void this.load()) }, label);
    const open = (label: string, path: string, line?: number) => el("button", { type: "button", class: "qw-btn", onclick: () => this.hooks.open(path, line) }, label);
    this.body.replaceChildren(
      ...[
        this.section(
          "link",
          "Dead links",
          "Links to notes that aren't here. Open each to fix the link, or click it there to make the note.",
          c.deadLinks.flatMap((m) =>
            m.from.map((f) => this.row(el("span", {}, el("b", {}, `[[${m.target}]]`), ` in ${displayName(f.path)}`), f.text, open("Open", f.path, f.line))),
          ),
        ),
        this.section(
          "user",
          "Duplicate contacts",
          "The same person with more than one contact note. Contacts merges them.",
          c.duplicateContacts.map((g) => this.row(el("b", {}, g.names.join(" and ")), g.paths.join(" · "), el("button", { type: "button", class: "qw-btn", onclick: () => this.hooks.contacts() }, "Go to Contacts"))),
        ),
        this.section(
          "file",
          "Empty notes",
          "Notes with nothing in them but a title.",
          c.emptyNotes.map((n) => this.row(el("b", {}, n.title || displayName(n.path)), n.path, open("Open", n.path), edit ? fix("Delete", () => this.hooks.delete(n.path), "Move it to Trash (Undo in the toast)") : null)),
        ),
        this.section(
          "archive",
          "Notes nothing links to",
          "Loose notes at the top level with no links to them, no tag and no star. Only a suggestion: archive what you're done with.",
          c.unlinkedNotes.map((n) => this.row(el("b", {}, n.title || displayName(n.path)), n.path, open("Open", n.path), edit ? fix("Archive", () => this.hooks.archive(n.path)) : null)),
        ),
        this.section(
          "clock",
          "Long-overdue tasks",
          `Open tasks due more than ${STALE_DAYS} days ago that don't repeat. Do them, give them a new date, or take them out.`,
          c.staleTasks.map((t) => this.row(el("b", {}, t.summary), `${displayName(t.path)} · due ${t.due}`, open("Open", t.path, t.line))),
        ),
      ].filter((s): s is HTMLElement => !!s),
    );
  }

  private section(ico: string, title: string, about: string, rows: HTMLElement[]): HTMLElement | null {
    if (!rows.length) return null;
    return el(
      "section",
      { class: "cu-section", "aria-label": title },
      el("h2", { class: "cu-title" }, icon(ico, 15), title, el("span", { class: "cu-count" }, String(rows.length))),
      el("p", { class: "cu-about" }, about),
      el("div", { class: "cu-rows", role: "list" }, ...rows),
    );
  }

  private row(what: HTMLElement, detail: string, ...actions: Array<HTMLElement | null>): HTMLElement {
    return el("div", { class: "cu-row", role: "listitem" }, el("div", { class: "cu-what" }, what, el("div", { class: "cu-detail" }, detail)), ...actions.filter((a): a is HTMLElement => !!a));
  }
}
