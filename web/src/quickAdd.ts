// The quick-add bar: type a task the way you'd say it and press Enter. Phrases it reads as a date
// or a repeat light up in place, and the chips below show what will be written; click a lit phrase
// to keep it as words. `#` and `@` suggest tags and people already in use. The same parser
// (src/core/quickAdd.ts) runs here as you type and on the server when the task is written.
import { api } from "./api.ts";
import { avatar, el, icon } from "./dom.ts";
import { parseQuickAdd, type QuickAdd } from "../../src/core/quickAdd.ts";
import { endTags, metaChips, today } from "./taskChips.ts";
import { taskPeople } from "./taskChipEditors.ts";

export interface QuickAddOptions {
  /** A task was written: where it went. */
  added(r: { path: string; line: number; text: string }): void;
  /** Open a note (the "Added to …" link). */
  open(path: string, line?: number): void;
  /** Escape in an empty bar (the floating one closes). */
  escape?(): void;
}

const HINT = 'Try "Pay rent every month on the 1st #home" or "Call mom tomorrow → [[Family]]"';

/** A quick-add bar. Focus its input with `.focus()` on the returned element's `input`. */
export function quickAddBar(opts: QuickAddOptions): { root: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { class: "qa-input", placeholder: "Add a task…", "aria-label": "Add a task", spellcheck: "true", autocomplete: "off" });
  const mirror = el("div", { class: "qa-mirror", "aria-hidden": "true" });
  const preview = el("div", { class: "qa-preview", "aria-live": "polite" });
  const suggest = el("div", { class: "qa-suggest fp-list", role: "listbox", hidden: true });
  const root = el("div", { class: "qa" }, el("div", { class: "qa-field" }, icon("plus", 15), el("div", { class: "qa-box" }, mirror, input)), suggest, preview);
  /** Phrases clicked back into words. */
  const ignore = new Set<string>();
  let parsed: QuickAdd | null = null;
  let tags: string[] = [];
  let people: string[] = [];
  let picks: string[] = [];
  let active = 0;
  let status: HTMLElement | null = null;

  const render = () => {
    const text = input.value;
    parsed = text.trim() ? parseQuickAdd(text, today(), [...ignore]) : null;
    // The mirror sits under the input with the same text, transparent, so only the highlights show.
    mirror.replaceChildren();
    let at = 0;
    for (const s of parsed?.spans ?? []) {
      mirror.append(text.slice(at, s.from), el("mark", { class: `qa-hl is-${s.kind}` }, text.slice(s.from, s.to)));
      at = s.to;
    }
    mirror.append(text.slice(at) || "​");
    mirror.scrollLeft = input.scrollLeft;
    input.title = parsed?.spans.length ? "Click a highlighted phrase to keep it as words" : "";
    if (!parsed) {
      preview.replaceChildren(status ?? el("span", { class: "qa-hint" }, HINT, el("kbd", {}, "Enter"), " adds"));
      return;
    }
    status = null;
    const where = parsed.target ?? `Journal/${today()}`;
    preview.replaceChildren(
      el("span", { class: "qa-words" }, parsed.words || el("em", {}, "Say what the task is")),
      ...metaChips(parsed.meta, false, endTags(parsed.words, parsed.meta.tags)),
      el("span", { class: "qa-where", title: parsed.target ? "The note named with → [[…]]" : "Today's daily note, under Tasks" }, "→ ", where),
    );
  };

  /** The `#tag` or `@person` being typed just before the caret, if any. */
  const typing = () => {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = before.match(/(?:^|\s)([#@])([\p{L}\p{N}_/.-]*)$/u);
    return m ? { sigil: m[1], query: m[2], from: before.length - m[2].length - 1 } : null;
  };
  const drawSuggest = () => {
    const t = typing();
    const pool = !t ? [] : t.sigil === "#" ? tags : people;
    picks = t ? pool.filter((p) => p.toLowerCase().includes(t.query.toLowerCase()) && p.toLowerCase() !== t.query.toLowerCase()).slice(0, 6) : [];
    active = Math.min(active, Math.max(0, picks.length - 1));
    suggest.hidden = !picks.length;
    suggest.replaceChildren(
      ...picks.map((p, i) =>
        el(
          "button",
          { type: "button", class: `fp-item${i === active ? " is-active" : ""}`, role: "option", "aria-selected": String(i === active), onmousedown: (e: Event) => (e.preventDefault(), accept(p)) },
          t!.sigil === "#" ? icon("hash", 14) : avatar(p, 16),
          el("span", {}, `${t!.sigil}${p}`),
        ),
      ),
    );
  };
  const accept = (p: string) => {
    const t = typing();
    if (!t) return;
    const caret = input.selectionStart ?? input.value.length;
    input.value = `${input.value.slice(0, t.from)}${t.sigil}${p} ${input.value.slice(caret)}`;
    const at = t.from + p.length + 2;
    input.setSelectionRange(at, at);
    picks = [];
    suggest.hidden = true;
    render();
  };

  const submit = async () => {
    if (!parsed?.words) return;
    const text = input.value;
    try {
      const r = await api.addTask(text, [...ignore]);
      input.value = "";
      ignore.clear();
      status = el(
        "span",
        { class: "qa-done" },
        icon("check", 13),
        "Added to ",
        el("button", { type: "button", class: "qa-link", onclick: () => opts.open(r.path, r.line) }, r.path.replace(/\.md$/, "")),
      );
      render();
      opts.added(r);
    } catch (e) {
      preview.replaceChildren(el("span", { class: "qa-error" }, e instanceof Error ? e.message : "Couldn't add the task"));
    }
  };

  input.addEventListener("input", () => (render(), drawSuggest()));
  input.addEventListener("scroll", () => (mirror.scrollLeft = input.scrollLeft));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the page's own keys (j, k, /…) stay out of the bar
    if (!suggest.hidden && picks.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : picks.length - 1)) % picks.length;
        return drawSuggest();
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return accept(picks[active]);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        suggest.hidden = true;
        picks = [];
        return;
      }
    }
    if (e.key === "Enter") (e.preventDefault(), void submit());
    else if (e.key === "Escape" && !input.value) opts.escape?.();
    else if (e.key === "Escape") (e.preventDefault(), (input.value = ""), ignore.clear(), render());
  });
  // A click inside a lit phrase keeps it as words (Todoist-style); the caret stays where it landed.
  input.addEventListener("click", () => {
    const at = input.selectionStart ?? 0;
    if (input.selectionEnd !== at || !parsed) return;
    const hit = parsed.spans.find((s) => at > s.from && at < s.to);
    if (!hit) return;
    ignore.add(input.value.slice(hit.from, hit.to).toLowerCase().replace(/\s+/g, " "));
    render();
  });
  input.addEventListener("blur", () => setTimeout(() => (suggest.hidden = true), 100));
  input.addEventListener("focus", () => {
    void api.tags().then((t) => (tags = t.map((x) => x.display))).catch(() => {});
    void taskPeople().then((p) => (people = p)).catch(() => {});
  });
  render();
  return { root, input };
}

/** The quick-add bar floating over whatever's open (the `q` shortcut). Enter adds and closes it. */
export function openQuickAdd(opts: Omit<QuickAddOptions, "escape">) {
  if (document.querySelector(".qa-float")) return;
  const close = () => {
    float.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const bar = quickAddBar({ ...opts, added: (r) => (opts.added(r), close()), escape: close });
  const float = el("div", { class: "qa-float", role: "dialog", "aria-label": "Add a task" }, bar.root);
  const outside = (e: MouseEvent) => !float.contains(e.target as Node) && close();
  document.addEventListener("mousedown", outside, true);
  document.body.append(float);
  bar.input.focus();
}
