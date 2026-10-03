// Replace across notes (⌘K "Replace across notes…", /replace): find and replace plain text in every
// note, or a folder's. The list shows each note that would change and its lines, old and new, as you
// type. Replace all is one change per note, with one Undo for the lot, like renaming a tag.
import { api, type ReplacedNote } from "./api.ts";
import { el, escapeHtml, icon } from "./dom.ts";
import type { ToastSpec } from "./toast.ts";
import { findPattern, proseMatches, type ReplaceOptions } from "../../src/core/replace.ts";

interface Hooks {
  folders(): string[];
  open(path: string, line: number, side: boolean): void;
  /** Notes changed: fetch them again. */
  refresh(): Promise<void>;
  /** A viewer (online) can't change notes. */
  readOnly(): boolean;
  toast(t: ToastSpec): void;
}

export class ReplacePage {
  readonly root: HTMLElement;
  private find = el("input", { placeholder: "Find", spellcheck: "false", autocomplete: "off", "aria-label": "Find" });
  private replace = el("input", { placeholder: "Replace with", spellcheck: "false", autocomplete: "off", "aria-label": "Replace with" });
  private matchCase = el("input", { type: "checkbox" });
  private wholeWord = el("input", { type: "checkbox" });
  private folder = el("select", { "aria-label": "Where" });
  private summary = el("p", { class: "rp-summary", role: "status" });
  private apply = el("button", { type: "button", class: "qw-btn primary", disabled: true }, "Replace all");
  private list = el("div", { class: "rp-list" });
  private seq = 0;
  private timer = 0;
  private found: ReplacedNote[] = [];

  constructor(
    root: HTMLElement,
    private hooks: Hooks,
  ) {
    this.root = root;
    const option = (label: string, box: HTMLInputElement) => el("label", { class: "rp-option" }, box, label);
    root.append(
      el(
        "div",
        { class: "page" },
        el(
          "header",
          { class: "page-head" },
          el("h1", {}, "Replace across notes"),
          el("p", { class: "page-sub" }, "Find text in every note and change it. Each note that changes gets its own entry in History, and Undo puts them all back."),
        ),
        el("label", { class: "feed-search" }, icon("search", 16), this.find),
        el("label", { class: "feed-search rp-with" }, icon("edit", 16), this.replace),
        el("div", { class: "rp-options" }, option("Match case", this.matchCase), option("Whole word", this.wholeWord), this.folder, el("span", { class: "rp-grow" }), this.apply),
        this.summary,
        this.list,
      ),
    );
    for (const input of [this.find, this.replace]) input.addEventListener("input", () => this.previewSoon());
    for (const input of [this.matchCase, this.wholeWord, this.folder]) input.addEventListener("change", () => this.previewSoon());
    this.find.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), this.replace.focus()));
    this.replace.addEventListener("keydown", (e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void this.replaceAll()));
    this.apply.addEventListener("click", () => void this.replaceAll());
  }

  get visible() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
    const was = this.folder.value;
    this.folder.replaceChildren(el("option", { value: "" }, "All notes"), ...this.hooks.folders().map((f) => el("option", { value: f }, f)));
    this.folder.value = this.hooks.folders().includes(was) ? was : "";
    this.apply.hidden = this.hooks.readOnly();
    this.find.focus({ preventScroll: true });
    this.find.select();
    this.preview();
  }

  /** Notes changed elsewhere: look again, unless a replace is under way. */
  refresh() {
    if (this.visible && !this.apply.classList.contains("is-busy")) this.previewSoon();
  }

  private options(): ReplaceOptions & { folder?: string } {
    return { matchCase: this.matchCase.checked, wholeWord: this.wholeWord.checked, folder: this.folder.value || undefined };
  }

  private previewSoon() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.preview(), 200);
  }

  private async preview() {
    const seq = ++this.seq;
    const find = this.find.value;
    if (!find) {
      this.found = [];
      return this.render("");
    }
    const r = await api.replace(find, this.replace.value, { ...this.options(), dryRun: true }).catch((e: Error) => e);
    if (seq !== this.seq) return;
    if (r instanceof Error) {
      this.found = [];
      return this.render(r.message);
    }
    this.found = r.notes;
    this.render();
  }

  private render(message?: string) {
    const places = this.found.reduce((n, x) => n + x.count, 0);
    this.summary.textContent =
      message ?? (this.found.length ? `${places} place${places === 1 ? "" : "s"} in ${this.found.length} note${this.found.length === 1 ? "" : "s"}` : `No note has “${this.find.value}”.`);
    this.apply.disabled = !this.found.length;
    const re = findPattern(this.find.value, this.options());
    this.list.replaceChildren(...this.found.map((n) => this.note(n, re)));
  }

  /** A note's changed lines, each as one line with the old words struck through and the new ones after them. */
  private note(n: ReplacedNote, re: RegExp | null): HTMLElement {
    const shown = n.lines.reduce((k, l) => k + (re ? proseMatches(l.before, re).length : 0), 0);
    return el(
      "section",
      { class: "rp-note" },
      el(
        "button",
        { type: "button", class: "rp-title", title: `Open ${n.path}`, onclick: (e: MouseEvent) => this.hooks.open(n.path, n.lines[0]?.line ?? 1, e.metaKey || e.ctrlKey) },
        icon("file", 14),
        el("span", {}, n.title),
        el("span", { class: "rp-path" }, n.path),
        el("span", { class: "count" }, String(n.count)),
      ),
      ...n.lines.map((l) =>
        el(
          "button",
          { type: "button", class: "rp-line", onclick: (e: MouseEvent) => this.hooks.open(n.path, l.line, e.metaKey || e.ctrlKey) },
          el("span", { class: "rp-num" }, String(l.line)),
          el("span", { class: "rp-text", html: re ? diffLine(l.before, re, this.replace.value) : escapeHtml(l.after) }),
        ),
      ),
      n.count > shown ? el("div", { class: "rp-more" }, `and ${n.count - shown} more in this note`) : null,
    );
  }

  private async replaceAll() {
    const find = this.find.value;
    const to = this.replace.value;
    if (!find || !this.found.length || this.hooks.readOnly()) return;
    this.apply.classList.add("is-busy");
    this.apply.disabled = true;
    let r: Awaited<ReturnType<typeof api.replace>>;
    try {
      r = await api.replace(find, to, this.options());
    } catch (e) {
      this.apply.classList.remove("is-busy");
      this.hooks.toast({ text: e instanceof Error ? e.message : "Couldn't replace" });
      return void this.preview();
    }
    this.apply.classList.remove("is-busy");
    await this.hooks.refresh();
    const places = r.notes.reduce((n, x) => n + x.count, 0);
    this.hooks.toast({
      icon: "check",
      text: `Replaced ${places} place${places === 1 ? "" : "s"} in ${r.changes.length} note${r.changes.length === 1 ? "" : "s"}`,
      actionLabel: "Undo",
      action: async () => {
        // Only notes still as the replace left them: one edited since keeps its edit.
        let kept = 0;
        for (let i = r.changes.length - 1; i >= 0; i--) await api.restore(r.changes[i], r.versions[i]).catch(() => kept++);
        await this.hooks.refresh();
        this.previewSoon();
        if (kept) this.hooks.toast({ text: `${kept} note${kept === 1 ? "" : "s"} changed since, so ${kept === 1 ? "it keeps" : "they keep"} the new text` });
      },
    });
    void this.preview();
  }
}

/** `before` as HTML, each match that's replaced (prose only, as replaceIn) struck through with `replace` after it. */
function diffLine(before: string, re: RegExp, replace: string): string {
  let out = "";
  let at = 0;
  for (const m of proseMatches(before, re)) {
    out += `${escapeHtml(before.slice(at, m.index))}<del>${escapeHtml(m[0])}</del>${replace ? `<ins>${escapeHtml(replace)}</ins>` : ""}`;
    at = m.index + m[0].length;
  }
  return out + escapeHtml(before.slice(at));
}
