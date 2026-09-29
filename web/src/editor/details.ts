// Collapsible sections in the editor: a `<details>` block (see src/core/details.ts) draws as a fold
// with a triangle and its summary. Opening and closing one (the triangle, Space on its summary line,
// vim's z commands) is how you look at the note, kept per note in this browser, and never an edit:
// only `<details open>` in the file sets how it starts. The cursor stops on the summary line, which
// shows its tags while it's there; a jump into a closed section (search, a link to a line) opens it.
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type Command } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { el, icon } from "../dom.ts";
import { isShortcut } from "../typedKey.ts";
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

/** A section's triangle: opens or closes it. */
function toggleButton(view: EditorView, key: string, open: boolean): HTMLElement {
  const toggle = el("button", { type: "button", class: "cm-details-toggle", "aria-expanded": String(open), title: open ? "Close the section (Space)" : "Open the section (Space)" }, icon("chevron", 14));
  toggle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    view.dispatch({ effects: setFold.of({ key, open: !open }) });
  });
  return toggle;
}

/** The triangle alone, in front of a summary line that shows as written. */
class ToggleWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly open: boolean,
  ) {
    super();
  }
  eq(o: ToggleWidget) {
    return o.key === this.key && o.open === this.open;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    return toggleButton(view, this.key, this.open);
  }
}

/** The summary line as it reads: the triangle and the summary's markdown (sanitized), tags hidden. */
class SummaryWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly open: boolean,
    readonly summary: string,
  ) {
    super();
  }
  eq(o: SummaryWidget) {
    return o.key === this.key && o.open === this.open && o.summary === this.summary;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const text = el("span", { html: inline(this.summary), title: "Click to edit the summary" });
    // A click on the summary puts the cursor at the end of its text, to edit it (the line then shows as written).
    text.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(text));
      const end = line.text.search(/<\/summary\s*>/i);
      view.dispatch({ selection: { anchor: end >= 0 ? line.from + end : line.to } });
      view.focus();
    });
    return el("span", { class: "cm-details-summary" }, toggleButton(view, this.key, this.open), text);
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

const TAGS = /<\/?(?:details|summary)\b[^>]*>/gi;

/**
 * How the sections draw, for this state: decorations, the ranges closed ones hide, and the ranges
 * the cursor steps over. The summary line is always a line the cursor can stop on (j/k, arrows,
 * a click); its tags show as written only while the cursor is on it, like any other markdown. The
 * `<details>` and `</details>` lines are out of the way unless the cursor is put on one (a
 * search, a line number), and a closed section's content is hidden and stepped over.
 */
interface Layout {
  decorations: Range<Decoration>[];
  hidden: Array<{ from: number; to: number }>;
  atoms: Array<{ from: number; to: number }>;
}
const layouts = new WeakMap<EditorState, Layout>();
export function foldLayout(state: EditorState): Layout {
  let l = layouts.get(state);
  if (l) return l;
  l = { decorations: [], hidden: [], atoms: [] };
  layouts.set(state, l);
  const text = state.doc.toString();
  if (!/<details/i.test(text)) return l;
  const { decorations: out, hidden, atoms } = l;
  const doc = state.doc;
  const on = (line: { from: number; to: number }) => touches(state, line.from, line.to);
  const end = (pos: number) => Math.min(pos, doc.length);
  for (const d of detailsIn(text)) {
    const first = doc.line(d.from + 1);
    if (hidden.some((r) => first.from >= r.from && first.from <= r.to)) continue;
    const head = doc.line((d.summaryLine ?? d.from) + 1);
    const close = doc.line(d.close + 1);
    const open = isOpen(state, d);
    const raw = on(head);
    if (head.number > first.number && !on(first)) {
      out.push(Decoration.replace({ block: true, fold: true }).range(first.from, first.to));
      atoms.push({ from: Math.max(0, first.from - 1), to: head.from });
    }
    out.push(Decoration.line({ class: `cm-details-head${open ? " is-open" : ""}${raw ? " is-raw" : ""}`, fold: true }).range(head.from));
    const tags = [...head.text.matchAll(TAGS)];
    if (raw || !tags.length) out.push(Decoration.widget({ widget: new ToggleWidget(d.key, open), side: -1, fold: true }).range(head.from));
    else {
      const last = tags[tags.length - 1];
      out.push(Decoration.replace({ widget: new SummaryWidget(d.key, open, d.summary), fold: true }).range(head.from + tags[0].index!, head.from + last.index! + last[0].length));
    }
    if (close.number <= head.number) continue;
    const body = doc.line(head.number + 1);
    if (!open) {
      if (touches(state, body.from, close.to)) continue; // the cursor's in it: a jump there opens it (see openOnJump)
      hidden.push({ from: body.from, to: close.to });
      out.push(Decoration.replace({ block: true, fold: true }).range(body.from, close.to));
      atoms.push({ from: head.to, to: end(close.to + 1) });
    } else if (!on(close)) {
      out.push(Decoration.replace({ block: true, widget: new EndWidget(), fold: true }).range(close.from, close.to));
      atoms.push({ from: close.from - 1, to: end(close.to + 1) });
    }
  }
  return l;
}

/**
 * The folds' decorations, outer sections first, and the ranges closed ones hide (so nothing inside
 * renders on its own). Called from the editor's block decorations (see blocks.ts).
 */
export function foldDecorations(state: EditorState, _text: string, out: Range<Decoration>[], hidden: Array<{ from: number; to: number }>) {
  const l = foldLayout(state);
  out.push(...l.decorations);
  hidden.push(...l.hidden);
}

/** The section whose summary line the cursor is on, if any. */
function headAt(state: EditorState): Details | null {
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  const text = state.doc.toString();
  if (!/<details/i.test(text)) return null;
  return detailsIn(text).find((d) => (d.summaryLine ?? d.from) === line) ?? null;
}

/**
 * Space on a section's summary line opens or closes it: anywhere on the line in vim's normal mode,
 * and otherwise at the line's start or end (not while typing in the summary). True if it did.
 */
export function spaceToggles(view: EditorView, anywhere: boolean): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const d = headAt(state);
  if (!d) return false;
  const line = state.doc.lineAt(sel.head);
  if (!anywhere && sel.head !== line.from && sel.head !== line.to) return false;
  view.dispatch({ effects: setFold.of({ key: d.key, open: !isOpen(state, d) }) });
  return true;
}

/** Vim's normal mode? (Space there is a motion, which a summary line takes over.) */
const vimNormal = (view: EditorView) => {
  const vim = (getCM(view) as { state?: { vim?: { insertMode?: boolean; visualMode?: boolean } } } | null)?.state?.vim;
  return !!vim && !vim.insertMode && !vim.visualMode;
};
const keys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(e, view) {
      if (view.state.readOnly) return false;
      // ⌘⌥S (Ctrl+Alt+S off a Mac) wraps the selection, by the letter the key types: on a Mac ⌥S
      // types "ß", and on Dvorak S is the physical ; key, which a CodeMirror keymap can mistake.
      if (isShortcut(e, "Mod-Alt-s")) {
        e.preventDefault();
        return wrapSection(view);
      }
      if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
      if (!spaceToggles(view, vimNormal(view))) return false;
      e.preventDefault();
      return true;
    },
  }),
);

/** A jump into a closed section (search, a link to a line, goToLine) opens it, and the ones around it. */
const openOnJump = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection) return null;
  const text = tr.newDoc.toString();
  if (!/<details/i.test(text)) return null;
  const line = tr.newDoc.lineAt(tr.newSelection.main.head).number - 1;
  const inside = detailsIn(text).filter((d) => line > (d.summaryLine ?? d.from) && line <= d.close && !isOpen(tr.startState, d));
  return inside.length ? { effects: inside.map((d) => setFold.of({ key: d.key, open: true })) } : null;
});

/** The cursor steps over what a section keeps out of the way (see foldLayout). */
const atomic = EditorView.atomicRanges.of((view) => {
  const atoms = foldLayout(view.state).atoms.filter((a) => a.to > a.from);
  return atoms.length ? Decoration.set(atoms.map((a) => Decoration.mark({}).range(a.from, a.to)), true) : Decoration.none;
});

export const details = [foldState, remember, openOnJump, atomic, keys];

/** The innermost section the cursor is in (its tags included). */
function sectionAt(state: EditorState): Details | null {
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  const all = detailsIn(state.doc.toString()).filter((d) => line >= d.from && line <= d.close);
  return all.sort((a, b) => b.depth - a.depth)[0] ?? null;
}

/**
 * Open, close or toggle the section the cursor is in (vim `zo`, `zc`, `za`). Closing it puts the
 * cursor on its summary line.
 */
export const foldAt =
  (how: "open" | "close" | "toggle"): Command =>
  (view) => {
    const d = sectionAt(view.state);
    if (!d) return false;
    const open = how === "toggle" ? !isOpen(view.state, d) : how === "open";
    const at = view.state.doc.line((d.summaryLine ?? d.from) + 1).to;
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
    view.dispatch({ effects: setFold.of({ all: open, keys: all.map((d) => d.key) }), ...(top ? { selection: { anchor: view.state.doc.line((top.summaryLine ?? top.from) + 1).to } } : {}) });
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
