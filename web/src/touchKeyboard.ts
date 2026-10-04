// Typing on a phone. While the on-screen keyboard is up, the app fits the screen above it (the
// visual viewport), the bottom nav gives its row to a toolbar of the things a phone's keyboard
// makes hard to type: a task, a heading, [[ and @ and /, indent, undo. The layout is in mobile.css.
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { $, el, icon } from "./dom.ts";

const PHONE = "(max-width: 760px)";
const TOUCH = "(pointer: coarse)";
/** Shorter than any phone's keyboard, taller than a browser bar sliding away. */
const KEYBOARD = 120;

/** What a line starts with as a list item, a task or a heading: its indent, then the marker. */
const MARKER = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/**
 * Give the cursor's line (each selected line) `prefix`, in place of the marker it has; a line that
 * already starts with it loses it. A heading goes one level deeper each time, to ### and then none.
 */
export function toggleLinePrefix(view: EditorView, prefix: "- [ ] " | "- " | "# "): boolean {
  const { state } = view;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; ; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const [, indent, had = ""] = line.text.match(MARKER)!;
        let next: string = prefix;
        if (prefix === "# ") next = had.startsWith("###") ? "" : had.startsWith("#") ? `#${had.trimEnd()} ` : "# ";
        else if (prefix === "- [ ] " ? /\[[ xX]\]/.test(had) : /^[-*+]\s+$/.test(had)) next = "";
        changes.push({ from: line.from + indent.length, to: line.from + indent.length + had.length, insert: next });
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  // A cursor at the start of an empty line ends up after its new marker, ready to type.
  const set = state.changes(changes);
  view.dispatch({ changes: set, selection: state.selection.map(set, 1), userEvent: "input", scrollIntoView: true });
  return true;
}

/** Put `open` and `close` round the selection (or the cursor); round text that has them, take them off. */
export function wrapSelection(view: EditorView, open: string, close = open): boolean {
  view.dispatch(
    view.state.changeByRange((r) => {
      const before = view.state.sliceDoc(Math.max(0, r.from - open.length), r.from);
      const after = view.state.sliceDoc(r.to, r.to + close.length);
      if (before === open && after === close) {
        return {
          changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }],
          range: EditorSelection.range(r.anchor - open.length, r.head - open.length),
        };
      }
      return { changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }], range: EditorSelection.range(r.anchor + open.length, r.head + open.length) };
    }),
    { userEvent: "input", scrollIntoView: true },
  );
  return true;
}

/** Type `text` at the cursor the way a key would, so its picker opens ([[ notes, @ people, / tools). */
export function typeTrigger(view: EditorView, text: string): boolean {
  const { from, to } = view.state.selection.main;
  const before = view.state.sliceDoc(Math.max(0, from - 1), from);
  // A / tool starts a line or follows a space; @ and [[ follow a space or start the line too.
  const lead = before && !/\s/.test(before) ? " " : "";
  view.dispatch({ changes: { from, to, insert: lead + text }, selection: { anchor: from + lead.length + text.length }, userEvent: "input.type", scrollIntoView: true });
  startCompletion(view);
  return true;
}

interface Tool {
  name: string;
  /** An icon's name, or the characters the button shows. */
  icon?: string;
  text?: string;
  run(view: EditorView): unknown;
}

const TOOLS: Tool[] = [
  { name: "Task", icon: "task", run: (v) => toggleLinePrefix(v, "- [ ] ") },
  { name: "List item", icon: "list", run: (v) => toggleLinePrefix(v, "- ") },
  { name: "Heading", icon: "heading", run: (v) => toggleLinePrefix(v, "# ") },
  { name: "Link to a note", text: "[[", run: (v) => typeTrigger(v, "[[") },
  { name: "Mention a person", icon: "at", run: (v) => typeTrigger(v, "@") },
  { name: "Insert a tool or widget", text: "/", run: (v) => typeTrigger(v, "/") },
  { name: "Tag", icon: "hash", run: (v) => typeTrigger(v, "#") },
  { name: "Bold", text: "B", run: (v) => wrapSelection(v, "**") },
  { name: "Italic", text: "I", run: (v) => wrapSelection(v, "*") },
  { name: "Indent less", text: "⇤", run: indentLess },
  { name: "Indent more", text: "⇥", run: indentMore },
  { name: "Undo", text: "↶", run: undo },
  { name: "Redo", text: "↷", run: redo },
];

/** The tallest the window has been at this width: its height with no keyboard up. */
let tallest = { width: 0, height: 0 };

/**
 * How much of the screen the keyboard has, either way a browser makes room for it: the page keeps
 * its height and the visual viewport shrinks (iOS), or the window itself gets shorter (Android,
 * with interactive-widget=resizes-content). `behind` is the part the page is still laid out under.
 */
export function keyboard(win: Pick<Window, "innerWidth" | "innerHeight" | "visualViewport"> = window): { height: number; behind: number } {
  if (win.innerWidth !== tallest.width) tallest = { width: win.innerWidth, height: 0 };
  tallest.height = Math.max(tallest.height, win.innerHeight);
  const behind = win.visualViewport ? Math.max(0, Math.round(win.innerHeight - win.visualViewport.height)) : 0;
  return { height: behind + (tallest.height - win.innerHeight), behind };
}

/**
 * Follow the on-screen keyboard: `--kb` on the page is its height (where the browser lays the page
 * out behind it, as iOS does), and the body is `kb-open` while a phone is typing, `kb-note` when
 * it's typing in a note. `editor` is the note being typed in.
 */
export function setupTouchKeyboard(editor: () => EditorView | undefined) {
  const bar = el("div", { id: "kb-bar", role: "toolbar", "aria-label": "Formatting", hidden: true });
  const tools = el("div", { class: "kb-tools" });
  for (const t of TOOLS) {
    const b = el("button", { type: "button", class: `kb-tool${t.text ? ` is-text is-${t.name.toLowerCase().split(" ")[0]}` : ""}`, title: t.name, "aria-label": t.name, tabindex: "-1" }, t.icon ? icon(t.icon, 20) : t.text!);
    // The tap is the toolbar's; the cursor and the keyboard stay the note's.
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const view = editor();
      if (!view) return;
      t.run(view);
      view.focus();
    });
    tools.append(b);
  }
  const done = el("button", { type: "button", class: "kb-tool kb-done", title: "Hide the keyboard", "aria-label": "Hide the keyboard", tabindex: "-1", onclick: () => (document.activeElement as HTMLElement | null)?.blur() }, icon("check", 20));
  bar.append(tools, done);
  $("#stage").after(bar);

  const typing = () => {
    const at = document.activeElement as HTMLElement | null;
    return !!at && (at.isContentEditable || at.matches("textarea, input:not([type=checkbox], [type=radio], [type=button], [type=file], [type=range], [type=color])"));
  };
  const update = () => {
    const phone = matchMedia(PHONE).matches && matchMedia(TOUCH).matches;
    const kb = keyboard();
    // A note takes the focus as it opens, with no keyboard: the keyboard is up once it has taken its room.
    const open = phone && typing() && kb.height > KEYBOARD;
    const inNote = open && !!document.activeElement?.closest("#editor-host, #side-host");
    document.documentElement.style.setProperty("--kb", `${open ? kb.behind : 0}px`);
    document.body.classList.toggle("kb-open", open);
    document.body.classList.toggle("kb-note", inNote);
    bar.hidden = !inNote;
    // iOS scrolls the page up to show the cursor, with the app's top bar off the screen; the app
    // already fits above the keyboard, so the page stays where it is.
    if (open && kb.behind && (window.scrollY || document.documentElement.scrollTop)) window.scrollTo(0, 0);
  };
  document.addEventListener("focusin", update);
  // Focus leaves one field for the next in the same tick: look once it has landed.
  document.addEventListener("focusout", () => setTimeout(update));
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
}
