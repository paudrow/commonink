// A quiet hint on the cursor's empty line, "Type / for tools, @ to link a note", until the person
// has picked something from the / menu once. It's drawn, not written: never part of the note, and
// hidden from screen readers (the menu itself is the accessible way in).
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { getCM } from "@replit/codemirror-vim";
import { store } from "../store.ts";

let learned = store.get("slashUsed", false);
/** The / menu was used: the hint has done its job, in every note from now on. */
export function slashUsed() {
  if (learned) return;
  learned = true;
  store.set("slashUsed", true);
}

/** Blocks where / and @ don't open anything, or an empty line means something else. */
const NOT_PROSE = new Set(["FencedCode", "CodeBlock", "Frontmatter", "BulletList", "OrderedList", "HTMLBlock", "CommentBlock"]);

/** Where the hint goes: the start of the cursor's line, when that line is empty prose in a note that has something in it. */
export function lineHintAt(state: EditorState): number | null {
  const { main, ranges } = state.selection;
  if (state.readOnly || ranges.length > 1 || !main.empty || !state.doc.length) return null;
  const line = state.doc.lineAt(main.head);
  if (line.length) return null;
  // The blocks that carry on past this line; at the very end, the one this line ends (an unclosed code block).
  const side = line.from === state.doc.length ? -1 : 1;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, side); n; n = n.parent) if (NOT_PROSE.has(n.name)) return null;
  return line.from;
}

class LineHint extends WidgetType {
  eq() {
    return true;
  }
  ignoreEvent() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-line-hint";
    s.setAttribute("aria-hidden", "true");
    s.textContent = "Type / for tools, @ to link a note";
    return s;
  }
}
const hint = Decoration.widget({ widget: new LineHint(), side: 1 });

const vimNormal = (view: EditorView) => {
  const vim = getCM(view)?.state.vim as { insertMode?: boolean } | undefined;
  return !!vim && !vim.insertMode;
};

export const lineHint = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    watching: object | null = null;
    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }
    update(_u: ViewUpdate) {
      this.decorations = this.build();
    }
    build(): DecorationSet {
      this.watchVim();
      if (learned || !this.view.hasFocus || vimNormal(this.view)) return Decoration.none;
      const at = lineHintAt(this.view.state);
      return at === null ? Decoration.none : Decoration.set(hint.range(at));
    }
    /** Vim switching modes isn't a transaction; redraw on its event. */
    watchVim() {
      const cm = getCM(this.view);
      if (!cm || cm === this.watching) return;
      this.watching = cm;
      cm.on("vim-mode-change", () => queueMicrotask(() => this.watching === cm && this.view.dispatch({})));
    }
    destroy() {
      this.watching = null;
    }
  },
  { decorations: (v) => v.decorations },
);
