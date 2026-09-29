// The link under the cursor, for following it (gd, gf) or opening it to the side (⌘⌥Enter, gs).
// Only needs the syntax tree, so it runs without a view.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { linkKind } from "../links.ts";
import { safeDecode } from "../../../src/core/uri.ts";

export function linkTargetAt(state: EditorState, pos: number): { target?: string; href?: string } | null {
  for (let node: any = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "WikiLink" || node.name === "Embed") {
      const bang = node.name === "Embed" ? 1 : 0;
      return { target: state.sliceDoc(node.from + 2 + bang, node.to - 2).split("|")[0] };
    }
    if (node.name === "Link" || node.name === "Image") {
      const url = node.getChild("URL");
      return url ? { href: state.sliceDoc(url.from, url.to) } : null;
    }
  }
  return null;
}

/**
 * The note a link at the cursor points to (a [[link]], or a markdown link to a note), with the
 * cursor on it or just after it. Null for no link, or a link that leaves the app.
 */
export function noteLinkAt(state: EditorState): string | null {
  const head = state.selection.main.head;
  for (const pos of [head, head - 1]) {
    if (pos < 0) continue;
    const link = linkTargetAt(state, pos);
    if (link?.target) return link.target;
    if (link?.href) return linkKind(link.href) === "internal" ? safeDecode(link.href) : null;
  }
  return null;
}
