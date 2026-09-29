// Math wherever markdown shows: the editor's widgets and rendered markdown (embeds, Notes cards) both
// draw a formula with drawMath, which loads KaTeX (mathRender.ts) the first time one is on screen.
// Rendered markdown carries each formula as a placeholder showing its source (see mathMarked), and
// hydrateMath draws it; the delimiters are read by core/math.ts, the same rules as the editor's.
import type { MarkedExtension, Tokens } from "marked";
import { el, escapeHtml, icon } from "./dom.ts";
import { copyCode } from "./code.ts";
import { blockMathAt, inlineMathAt, MAX_TEX } from "../../src/core/math.ts";

let katex: Promise<typeof import("./mathRender.ts")> | null = null;

/**
 * Draw a formula into `node`: its source at first, then KaTeX's rendering, or, if the TeX doesn't
 * parse, the source in red with KaTeX's message on hover. Display math gets a copy-LaTeX button.
 */
export function drawMath(node: HTMLElement, tex: string, display: boolean, onDrawn?: () => void) {
  node.classList.add("math", display ? "math-display" : "math-inline");
  node.textContent = display ? tex : `$${tex}$`;
  katex ??= import("katex/dist/katex.min.css").then(() => import("./mathRender.ts"));
  void katex.then(({ renderTex }) => {
    const out = renderTex(tex, display);
    if ("html" in out) {
      node.innerHTML = out.html; // sanitized last, in renderTex
      node.classList.remove("math-error");
      for (const a of ["data-error", "aria-description", "tabindex"]) node.removeAttribute(a);
    } else {
      // The source in red, with KaTeX's message in a tooltip on hover and on keyboard focus (styles.css).
      // A native title waits a second and doesn't show over the editor, so it isn't enough.
      node.classList.add("math-error");
      node.textContent = display ? tex : `$${tex}$`;
      node.dataset.error = out.error;
      node.setAttribute("aria-description", `Can't draw this formula: ${out.error}`);
      node.tabIndex = 0;
    }
    if (display) node.append(copyButton(tex));
    onDrawn?.();
  });
}

function copyButton(tex: string): HTMLElement {
  const b = el("button", { type: "button", class: "cb-btn math-copy", title: "Copy LaTeX", "aria-label": "Copy LaTeX" }, icon("copy", 14));
  b.addEventListener("mousedown", (e) => (e.preventDefault(), e.stopPropagation()));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    void copyCode(tex, b);
  });
  return b;
}

/** Draw rendered markdown's formulas (the placeholders mathMarked writes). */
export function hydrateMath(root: ParentNode) {
  for (const node of root.querySelectorAll<HTMLElement>("[data-tex]")) {
    drawMath(node, node.dataset.tex ?? "", node.dataset.display !== undefined);
    node.removeAttribute("data-tex");
  }
}

/** A formula's placeholder in rendered markdown: its source, escaped, until hydrateMath draws it. */
export function mathPlaceholder(tex: string, display: boolean, block = false): string {
  const t = escapeHtml(tex);
  const tag = block ? "div" : "span";
  return `<${tag} class="math" data-tex="${t}"${display ? " data-display" : ""}>${display ? t : `$${t}$`}</${tag}>${block ? "\n" : ""}`;
}

interface MathToken extends Tokens.Generic {
  tex: string;
  display: boolean;
}

/** marked's reading of math, by core/math.ts's rules: inline $…$, $`…`$, \(…\), and display $$…$$, \[…\]. */
export const mathMarked: MarkedExtension = {
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      // No `start`: finding the next block in the rest of the note on every paragraph is quadratic.
      // A $$ line straight after a paragraph's text is still math, drawn by the inline rule below.
      tokenizer(src: string) {
        if (!/^[ \t]*(\$\$|\\\[)/.test(src)) return;
        // Only as much as one formula can be, so no call reads the whole note.
        const lines = src.slice(0, MAX_TEX + 400).split("\n");
        const m = blockMathAt(lines, 0);
        if (!m) return;
        const raw = lines.slice(0, m.endLine + 1).join("\n");
        return { type: "mathBlock", raw: src.startsWith(`${raw}\n`) ? `${raw}\n` : raw, tex: m.tex, display: true };
      },
      renderer: (t) => mathPlaceholder((t as MathToken).tex, true, true),
    },
    {
      name: "math",
      level: "inline",
      // Where text might stop for math. Looking only a little way ahead keeps each call cheap: past
      // the window, the text just ends early and the next call looks further.
      start: (src: string) => {
        const i = src.slice(0, 256).search(/\$|\\[([]/);
        return i < 0 ? Math.min(src.length, 255) : i;
      },
      tokenizer(src: string) {
        if (src[0] !== "$" && !/^\\[([]/.test(src)) return;
        const m = inlineMathAt(src, 0);
        if (!m) return;
        return { type: "math", raw: src.slice(0, m.end), tex: m.tex, display: m.display };
      },
      renderer: (t) => mathPlaceholder((t as MathToken).tex, (t as MathToken).display),
    },
  ],
};
