// Formulas drawn in the editor while the cursor is elsewhere (see mathSyntax.ts for what counts as math).
import { WidgetType, type EditorView } from "@codemirror/view";
import { inlineMathAt, blockMathAt } from "../../../src/core/math.ts";
import { drawMath } from "../math.ts";

/** The TeX of an InlineMath node's text ($…$, \(…\) and the rest), and whether it's display math. */
export function inlineTex(source: string): { tex: string; display: boolean } | null {
  const m = inlineMathAt(source, 0);
  return m && m.end === source.length ? { tex: m.tex, display: m.display } : null;
}

/** The TeX of a BlockMath node's lines, or a ```math block's code. */
export const blockTex = (source: string) => blockMathAt(source.split("\n"), 0)?.tex ?? null;

const heights = new Map<string, number>();

/** A formula in place of its source: inline in its line, or (display) as a block of its own. */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    /** Drawn under its source while that's being edited, rather than in its place. */
    readonly preview = false,
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display && o.preview === this.preview;
  }
  get estimatedHeight() {
    return this.display ? (heights.get(this.tex) ?? 56) : -1;
  }
  toDOM(view: EditorView) {
    const node = document.createElement(this.display ? "div" : "span");
    if (this.preview) node.classList.add("is-preview");
    drawMath(node, this.tex, this.display, () => {
      if (!this.display) return;
      requestAnimationFrame(() => {
        if (node.isConnected) heights.set(this.tex, node.offsetHeight);
        view.requestMeasure();
      });
    });
    if (this.display && !this.preview) {
      // A click on a drawn block puts the cursor in its source, which shows it for editing.
      node.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        const line = view.state.doc.lineAt(view.posAtDOM(node));
        const target = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines));
        view.dispatch({ selection: { anchor: line.text.trim().length > 2 && !/^\s*```/.test(line.text) ? line.from + line.text.indexOf(line.text.trim()) + 2 : target.to } });
        view.focus();
      });
    }
    return node;
  }
  ignoreEvent() {
    return this.display;
  }
}
