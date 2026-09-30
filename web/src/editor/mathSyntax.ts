// Math as syntax in the editor, by core/math.ts's rules: InlineMath for $…$, $`…`$, \(…\) and one-line
// $$…$$, and BlockMath for $$ or \[ blocks. The live preview draws them (livePreview.ts, blocks.ts).
import { tags as t } from "@lezer/highlight";
import type { BlockContext, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from "@lezer/markdown";
import { blockMathAt, inlineMathAt, MAX_TEX } from "../../../src/core/math.ts";

const DOLLAR = 36;
const BACKSLASH = 92;

/**
 * A paragraph that starts with $$ or \[, read as block math once its closing line arrives. If the
 * paragraph ends first (a blank line, a heading), it stays a paragraph.
 */
class MathLeaf implements LeafBlockParser {
  /** Whether the block has closed (a one-line block closes on its first line). */
  private closed: boolean;
  private failed = false;
  private readonly close: string;
  constructor(first: string) {
    this.close = first.trimStart().startsWith("$$") ? "$$" : "\\]";
    this.closed = blockMathAt([first], 0) !== null;
  }
  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (this.closed) {
      // One line of math, and this line is something else: end the block before it.
      cx.addLeafElement(leaf, cx.elt("BlockMath", leaf.start, leaf.start + leaf.content.length));
      return true;
    }
    if (this.failed) return false;
    const text = line.text.slice(line.pos);
    if (text.trimEnd().endsWith(this.close)) {
      cx.nextLine();
      cx.addLeafElement(leaf, cx.elt("BlockMath", leaf.start, cx.prevLineEnd()));
      return true;
    }
    if (leaf.content.length + text.length > MAX_TEX) this.failed = true;
    return false;
  }
  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.closed) return false;
    cx.addLeafElement(leaf, cx.elt("BlockMath", leaf.start, leaf.start + leaf.content.length));
    return true;
  }
}

export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: t.special(t.content) },
    { name: "BlockMath", block: true, style: t.special(t.content) },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Escape", // \( and \[ are ours; \$ and the rest stay escapes
      parse(cx, next, pos) {
        if (next !== DOLLAR && next !== BACKSLASH) return -1;
        if (next === DOLLAR && cx.char(pos - 1) === BACKSLASH) return -1;
        const text = cx.slice(pos, Math.min(cx.end, pos + MAX_TEX + 4));
        const m = inlineMathAt(text, 0);
        return m ? cx.addElement(cx.elt("InlineMath", pos, pos + m.end)) : -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      leaf: (_cx, leaf) => (/^\s*(\$\$|\\\[)/.test(leaf.content) ? new MathLeaf(leaf.content) : null),
    },
  ],
};
