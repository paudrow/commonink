// Collapsible sections in the editor: a `<details>` block (see src/core/details.ts) draws as a fold
// with a triangle and its summary. Opening and closing one is how you look at the note, kept per
// note in this browser, and never an edit: only `<details open>` in the file sets how it starts.
// With the cursor on its tags they show as written; a jump into a closed section (search, a link to
// a line) opens it.
import { EditorSelection, EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type Command } from "@codemirror/view";
import { el, icon } from "../dom.ts";
import { inline } from "../taskRow.ts";
import { detailsIn, wrapInDetails, type Details } from "../../../src/core/details.ts";
import { editorContext } from "./blocks.ts";
import { touches } from "./livePreview.ts";

/** Open or close sections: by key, or all of them. */
export const setFold = StateEffect.define<{ key: string; open: boolean } | { all: boolean; keys: string[] }>();

const STORE = (path: string) => `quire.details:${path}`;
function load(path: string | undefined): Record<string, boolean> {
  if (!path) return {};
  try {
    return JSON.parse(localStorage.getItem(STORE(path)) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Which sections the person opened or closed in this note (section key → open). */
export const foldState = StateField.define<Record<string, boolean>>({
  create: (s) => load(s.facet(editorContext)?.path),
  update(v, tr) {
    let out = v;
    for (const e of tr.effects) {
      if (!e.is(setFold)) continue;
      out = { ...out, ...("all" in e.value ? Object.fromEntries(e.value.keys.map((k) => [k, (e.value as { all: boolean }).all])) : { [e.value.key]: e.value.open }) };
    }
    return out;
  },
});

/** Keep what was opened and closed, per note in this browser. */
const remember = EditorView.updateListener.of((u) => {
  if (!u.transactions.some((t) => t.effects.some((e) => e.is(setFold)))) return;
  const path = u.state.facet(editorContext)?.path;
  try {
    if (path) localStorage.setItem(STORE(path), JSON.stringify(u.state.field(foldState)));
  } catch {}
});

const isOpen = (state: EditorState, d: Details) => state.field(foldState, false)?.[d.key] ?? d.open;

/** The fold's header: a triangle, and the summary (its markdown, sanitized). */
class HeaderWidget extends WidgetType {
  constructor(
    readonly d: Details,
    readonly open: boolean,
  ) {
    super();
  }
  eq(o: HeaderWidget) {
    return o.d.key === this.d.key && o.d.summary === this.d.summary && o.open === this.open;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const toggle = el("button", { type: "button", class: "cm-details-toggle", "aria-expanded": String(this.open), title: this.open ? "Close the section" : "Open the section" }, icon("chevron", 14));
    const summary = el("span", { class: "cm-details-summary", html: inline(this.d.summary), title: "Click to edit the summary" });
    const node = el("div", { class: `cm-details-head${this.open ? " is-open" : ""}`, "data-key": this.d.key }, toggle, summary);
    toggle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: setFold.of({ key: this.d.key, open: !this.open }) });
    });
    summary.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.line((this.d.summaryLine ?? this.d.from) + 1);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });
    return node;
  }
}

/** What a closed section hides, under its raw tags while the cursor is on them. */
class BodyWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly lines: number,
  ) {
    super();
  }
  eq(o: BodyWidget) {
    return o.key === this.key && o.lines === this.lines;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const node = el("button", { type: "button", class: "cm-details-body", title: "Open the section" }, `${this.lines} line${this.lines === 1 ? "" : "s"} folded`);
    node.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: setFold.of({ key: this.key, open: true }) });
    });
    return node;
  }
}

/** Where an open section ends. */
class EndWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return el("div", { class: "cm-details-end", "aria-hidden": "true" });
  }
}

/**
 * The folds' decorations, outer sections first, and the ranges closed ones hide (so nothing inside
 * renders on its own). Called from the editor's block decorations (see blocks.ts).
 */
export function foldDecorations(state: EditorState, text: string, out: Range<Decoration>[], hidden: Array<{ from: number; to: number }>) {
  if (!/<details/i.test(text)) return;
  const doc = state.doc;
  for (const d of detailsIn(text)) {
    const first = doc.line(d.from + 1);
    if (hidden.some((r) => first.from >= r.from && first.from <= r.to)) continue;
    const head = doc.line((d.summaryLine ?? d.from) + 1);
    const close = doc.line(d.close + 1);
    const raw = touches(state, first.from, head.to);
    if (!isOpen(state, d)) {
      const from = raw ? Math.min(head.to + 1, close.from) : first.from;
      if (raw && head.number >= close.number) continue;
      hidden.push({ from, to: close.to });
      const widget = raw ? new BodyWidget(d.key, close.number - head.number) : new HeaderWidget(d, false);
      out.push(Decoration.replace({ block: true, widget, fold: true }).range(from, close.to));
      continue;
    }
    if (!raw) out.push(Decoration.replace({ block: true, widget: new HeaderWidget(d, true), fold: true }).range(first.from, head.to));
    if (!touches(state, close.from, close.to) && close.number > head.number) out.push(Decoration.replace({ block: true, widget: new EndWidget(), fold: true }).range(close.from, close.to));
  }
}

/** A jump into a closed section (search, a link to a line, goToLine) opens it, and the ones around it. */
const openOnJump = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection) return null;
  const text = tr.newDoc.toString();
  if (!/<details/i.test(text)) return null;
  const line = tr.newDoc.lineAt(tr.newSelection.main.head).number - 1;
  const inside = detailsIn(text).filter((d) => line > (d.summaryLine ?? d.from) && line <= d.close && !isOpen(tr.startState, d));
  return inside.length ? { effects: inside.map((d) => setFold.of({ key: d.key, open: true })) } : null;
});

/** Closed sections are one step for the cursor: arrows move past them rather than into them. */
const atomic = EditorView.atomicRanges.of((view) => {
  const text = view.state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  if (!/<details/i.test(text)) return Decoration.none;
  for (const d of detailsIn(text)) {
    if (isOpen(view.state, d)) continue;
    const first = view.state.doc.line(d.from + 1);
    const head = view.state.doc.line((d.summaryLine ?? d.from) + 1);
    if (touches(view.state, first.from, head.to)) continue;
    ranges.push(Decoration.mark({}).range(first.from, view.state.doc.line(d.close + 1).to));
  }
  return Decoration.set(ranges, true);
});

export const details = [foldState, remember, openOnJump, atomic];

/** The innermost section the cursor is in (its tags included). */
function sectionAt(state: EditorState): Details | null {
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  const all = detailsIn(state.doc.toString()).filter((d) => line >= d.from && line <= d.close);
  return all.sort((a, b) => b.depth - a.depth)[0] ?? null;
}

/**
 * Open, close or toggle the section the cursor is in (vim `zo`, `zc`, `za`). Closing it puts the
 * cursor on its `<details>` line, so the section stays folded under its tags.
 */
export const foldAt =
  (how: "open" | "close" | "toggle"): Command =>
  (view) => {
    const d = sectionAt(view.state);
    if (!d) return false;
    const open = how === "toggle" ? !isOpen(view.state, d) : how === "open";
    const at = view.state.doc.line(d.from + 1).from;
    view.dispatch({ effects: setFold.of({ key: d.key, open }), ...(open ? {} : { selection: { anchor: at } }) });
    return true;
  };

/** Open or close every section in the note (vim `zR`, `zM`). */
export const foldAll =
  (open: boolean): Command =>
  (view) => {
    const all = detailsIn(view.state.doc.toString());
    if (!all.length) return false;
    const inside = sectionAt(view.state);
    const top = inside && !open ? all.find((d) => d.depth === 0 && d.from <= inside.from && inside.close <= d.close) : null;
    view.dispatch({ effects: setFold.of({ all: open, keys: all.map((d) => d.key) }), ...(top ? { selection: { anchor: view.state.doc.line(top.from + 1).from } } : {}) });
    return true;
  };

/** Wrap the selected lines in a collapsible section, or insert an empty one; the summary is selected, to name it. */
export const wrapSection: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const from = state.doc.lineAt(sel.from);
  const to = state.doc.lineAt(sel.to);
  const text = sel.empty ? "" : state.sliceDoc(from.from, to.to);
  const block = wrapInDetails(text);
  const start = sel.empty && from.text.trim() ? to.to : from.from;
  const insert = sel.empty && from.text.trim() ? `\n\n${block}` : block;
  const summaryAt = start + insert.indexOf("<summary>") + "<summary>".length;
  view.dispatch({
    changes: { from: start, to: sel.empty ? start : to.to, insert },
    selection: EditorSelection.single(summaryAt, summaryAt + "Details".length),
    userEvent: "input.details",
  });
  return true;
};
