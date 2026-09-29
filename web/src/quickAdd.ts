// The quick-add bar: type a task the way you'd say it and press Enter. Phrases it reads as a date
// or a repeat light up in place, and the chips below show what will be written; click a lit phrase
// to keep it as words. `#` and `@` suggest tags and people already in use. The same parser
// (src/core/quickAdd.ts) runs here as you type and on the server when the task is written.
//
// With Vim on, the field is a one-line CodeMirror with Vim: it opens in insert mode, Esc goes to
// normal mode and Esc again closes, Enter adds from either mode. Opened from a note, Tab switches
// where the task goes between today's daily note and that note.
import { autocompletion, completionStatus, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, placeholder, type DecorationSet } from "@codemirror/view";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { api } from "./api.ts";
import { avatar, el, icon } from "./dom.ts";
import { parseQuickAdd, type QuickAdd, type QuickSpan } from "../../src/core/quickAdd.ts";
import { endTags, metaChips, today } from "./taskChips.ts";
import { taskPeople } from "./taskChipEditors.ts";
import { targetOf } from "./taskCommand.ts";

export interface QuickAddOptions {
  /** A task was written: where it went. */
  added(r: { path: string; line: number; text: string }): void;
  /** Open a note (the "Added to …" link). */
  open(path: string, line?: number): void;
  /** Escape out of the bar (the floating one closes). */
  escape?(): void;
  /** Vim keys in the field (the app's Vim setting). */
  vim?: boolean;
  /** The note it was opened from: Tab sends the task there instead of today's daily note. */
  note?: string;
}

/** The shortcut that opens the bar from anywhere, the editor included: ⌘⇧. (Ctrl+Shift+. elsewhere). */
export const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧." : "Ctrl+Shift+.";
export const isQuickAddKey = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "Period";

const HINT = 'Try "Pay rent every month on the 1st #home" or "Call mom tomorrow → [[Family]]"';

/** What the bar needs from its field, a plain input or a Vim CodeMirror. */
interface Field {
  dom: HTMLElement;
  value(): string;
  clear(): void;
  focus(): void;
  highlight(spans: QuickSpan[]): void;
}

/** A quick-add bar; focus it with the returned `focus`. */
export function quickAddBar(opts: QuickAddOptions): { root: HTMLElement; focus(): void } {
  const preview = el("div", { class: "qa-preview", "aria-live": "polite" });
  /** Phrases clicked back into words. */
  const ignore = new Set<string>();
  let parsed: QuickAdd | null = null;
  let tags: string[] = [];
  let people: string[] = [];
  let status: HTMLElement | null = null;
  let toNote = false;
  const loadPools = () => {
    void api.tags().then((t) => (tags = t.map((x) => x.display))).catch(() => {});
    void taskPeople().then((p) => (people = p)).catch(() => {});
  };

  const where = () => targetOf(parsed?.target ?? null, toNote, opts.note, today());
  const targetChip = opts.note
    ? el("button", { type: "button", class: "qa-target", title: "Where it goes (Tab switches)", onmousedown: (e: Event) => e.preventDefault(), onclick: () => toggleTarget() })
    : null;
  const toggleTarget = () => {
    if (!opts.note) return false;
    toNote = !toNote;
    render();
    return true;
  };

  const render = () => {
    const text = field.value();
    parsed = text.trim() ? parseQuickAdd(text, today(), [...ignore]) : null;
    field.highlight(parsed?.spans ?? []);
    targetChip?.replaceChildren(icon(toNote && !parsed?.target ? "file" : "calendar", 12), where().label);
    if (!parsed) {
      preview.replaceChildren(status ?? el("span", { class: "qa-hint" }, HINT, el("kbd", {}, "Enter"), " adds · ", el("kbd", {}, SHORTCUT), " opens this anywhere"));
      return;
    }
    status = null;
    preview.replaceChildren(
      el("span", { class: "qa-words" }, parsed.words || el("em", {}, "Say what the task is")),
      ...metaChips(parsed.meta, false, endTags(parsed.words, parsed.meta.tags)),
      el("span", { class: "qa-where", title: parsed.target ? "The note named with → [[…]]" : toNote ? "The note you opened this from" : "Today's daily note, under Tasks" }, "→ ", where().label),
    );
  };

  const submit = async () => {
    if (!parsed?.words) return;
    try {
      const r = await api.addTask(field.value(), [...ignore], where().to);
      field.clear();
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

  /** A click inside a lit phrase keeps it as words (Todoist-style); the caret stays where it landed. */
  const clickedAt = (at: number) => {
    const hit = parsed?.spans.find((s) => at > s.from && at < s.to);
    if (!hit) return;
    ignore.add(field.value().slice(hit.from, hit.to).toLowerCase().replace(/\s+/g, " "));
    render();
  };

  const bar = { render, submit, clickedAt, toggleTarget, escape: () => opts.escape?.(), loadPools, pools: () => ({ tags, people }) };
  const field = opts.vim ? vimField(bar) : plainField(bar);
  const root = el("div", { class: "qa" }, el("div", { class: "qa-field" }, icon("plus", 15), field.dom, targetChip), preview);
  render();
  return { root, focus: () => field.focus() };
}

type Bar = {
  render(): void;
  submit(): Promise<void>;
  clickedAt(at: number): void;
  toggleTarget(): boolean;
  escape(): void;
  loadPools(): void;
  pools(): { tags: string[]; people: string[] };
};

/** The field without Vim: an input over a mirror that draws the highlights, and its own suggestion list. */
function plainField(bar: Bar): Field {
  const input = el("input", { class: "qa-input", placeholder: "Add a task…", "aria-label": "Add a task", spellcheck: "true", autocomplete: "off" });
  const mirror = el("div", { class: "qa-mirror", "aria-hidden": "true" });
  const suggest = el("div", { class: "qa-suggest fp-list", role: "listbox", hidden: true });
  let picks: string[] = [];
  let active = 0;

  /** The `#tag` or `@person` being typed just before the caret, if any. */
  const typing = () => {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = before.match(/(?:^|\s)([#@])([\p{L}\p{N}_/.-]*)$/u);
    return m ? { sigil: m[1], query: m[2], from: before.length - m[2].length - 1 } : null;
  };
  const drawSuggest = () => {
    const t = typing();
    const { tags, people } = bar.pools();
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
    bar.render();
  };

  input.addEventListener("input", () => (bar.render(), drawSuggest()));
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
    if (e.key === "Enter") (e.preventDefault(), void bar.submit());
    else if (e.key === "Tab" && !e.shiftKey && bar.toggleTarget()) e.preventDefault();
    else if (e.key === "Escape" && !input.value) bar.escape();
    else if (e.key === "Escape") (e.preventDefault(), (input.value = ""), bar.render());
  });
  input.addEventListener("click", () => input.selectionEnd === input.selectionStart && bar.clickedAt(input.selectionStart ?? 0));
  input.addEventListener("blur", () => setTimeout(() => (suggest.hidden = true), 100));
  input.addEventListener("focus", bar.loadPools);

  return {
    dom: el("div", { class: "qa-box" }, mirror, input, suggest),
    value: () => input.value,
    clear: () => void (input.value = ""),
    focus: () => input.focus(),
    highlight(spans) {
      // The mirror sits under the input with the same text, transparent, so only the highlights show.
      const text = input.value;
      mirror.replaceChildren();
      let at = 0;
      for (const s of spans) {
        mirror.append(text.slice(at, s.from), el("mark", { class: `qa-hl is-${s.kind}` }, text.slice(s.from, s.to)));
        at = s.to;
      }
      mirror.append(text.slice(at) || "​");
      mirror.scrollLeft = input.scrollLeft;
      input.title = spans.length ? "Click a highlighted phrase to keep it as words" : "";
    },
  };
}

const setSpans = StateEffect.define<QuickSpan[]>();
/** The lit phrases, as decorations: drawn by the bar, never part of what's typed. */
const spansField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setSpans)) return Decoration.set(e.value.map((s) => Decoration.mark({ class: `qa-hl is-${s.kind}` }).range(s.from, s.to)));
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The field with Vim: a one-line CodeMirror, `#` and `@` completed from the tags and people in use. */
function vimField(bar: Bar): Field {
  const inNormal = (view: EditorView) => {
    const state = getCM(view)?.state.vim as { insertMode?: boolean; visualMode?: boolean } | undefined;
    return !!state && !state.insertMode && !state.visualMode;
  };
  const suggest = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?:^|\s)[#@][\p{L}\p{N}_/.-]*$/u);
    if (!m) return null;
    const at = m.from + m.text.search(/[#@]/);
    const sigil = ctx.state.sliceDoc(at, at + 1);
    const { tags, people } = bar.pools();
    const pool = sigil === "#" ? tags : people;
    return { from: at + 1, options: pool.map((p, i) => ({ label: p, detail: sigil === "#" ? "tag" : "person", boost: -i, apply: `${p} ` })) };
  };
  const view = new EditorView({
    doc: "",
    extensions: [
      vim(),
      EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)), // one line: Enter adds, it never breaks the line
      Prec.highest(
        EditorView.domEventHandlers({
          // Ahead of Vim's own keys: Enter adds from any mode, Tab (typing) switches the target, and Esc
          // in normal mode closes the bar (in insert mode it's Vim's, back to normal mode).
          keydown: (e, v) => {
            e.stopPropagation(); // the page's own keys stay out of the bar
            if (completionStatus(v.state) === "active") return false; // Enter, Tab and Esc are the suggestions' then
            const take = () => (e.preventDefault(), true);
            if (e.key === "Enter") return void bar.submit(), take();
            if (e.key === "Tab" && !e.shiftKey && !inNormal(v) && bar.toggleTarget()) return take();
            if (e.key === "Escape" && inNormal(v)) return bar.escape(), take();
            return false;
          },
          click: (_e, v) => (v.state.selection.main.empty && bar.clickedAt(v.state.selection.main.head), false),
          focus: (_e, v) => {
            bar.loadPools();
            // An empty bar is for typing: it takes focus in insert mode (the Tasks page's, clicked into, too).
            const cm = getCM(v);
            if (cm && !v.state.doc.length && inNormal(v)) setTimeout(() => Vim.handleKey(cm, "i", "mapping"));
            return false;
          },
        }),
      ),
      autocompletion({ override: [suggest], icons: false }),
      spansField,
      placeholder("Add a task…"),
      EditorView.updateListener.of((u) => u.docChanged && bar.render()),
      EditorView.contentAttributes.of({ "aria-label": "Add a task", spellcheck: "true" }),
    ],
  });
  return {
    dom: el("div", { class: "qa-box qa-cm" }, view.dom),
    value: () => view.state.doc.toString(),
    clear: () => view.dispatch({ changes: { from: 0, to: view.state.doc.length } }),
    focus() {
      view.focus();
      const cm = getCM(view);
      if (cm && inNormal(view)) Vim.handleKey(cm, "i", "mapping"); // it opens ready to type
    },
    highlight: (spans) => view.dispatch({ effects: setSpans.of(spans) }),
  };
}

/** The quick-add bar floating over whatever's open. Enter adds and closes it. */
export function openQuickAdd(opts: Omit<QuickAddOptions, "escape">) {
  if (document.querySelector(".qa-float")) return;
  const back = document.activeElement as HTMLElement | null;
  const close = () => {
    float.remove();
    document.removeEventListener("mousedown", outside, true);
    back?.focus?.(); // back to the note (and its Vim mode) or wherever it was opened from
  };
  const bar = quickAddBar({ ...opts, added: (r) => (opts.added(r), close()), escape: close });
  const float = el("div", { class: "qa-float", role: "dialog", "aria-label": "Add a task" }, bar.root);
  const outside = (e: MouseEvent) => !float.contains(e.target as Node) && close();
  document.addEventListener("mousedown", outside, true);
  document.body.append(float);
  bar.focus();
}
