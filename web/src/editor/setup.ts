import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, syntaxTree, indentUnit } from "@codemirror/language";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { vim } from "@replit/codemirror-vim";
import { markdownWithFrontmatter, quireHighlight } from "./language.ts";
import { livePreview } from "./livePreview.ts";
import { blockWidgets, editorContext, stepIntoBlocks, type EditorContext } from "./blocks.ts";
import { agentFlash } from "./agentFlash.ts";
import { typingHelpers } from "./complete.ts";

/** Marks transactions that came from disk (agents), so they don't trigger a save of their own. */
export const remote = Annotation.define<boolean>();
export const vimSlot = new Compartment();

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--prose)", lineHeight: "1.72", overflow: "auto" },
  ".cm-content": { maxWidth: "var(--measure)", margin: "0 auto", padding: "56px 40px 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
  ".cm-placeholder": { color: "var(--faint)", fontStyle: "italic" },
  ".cm-panels": { backgroundColor: "var(--bg-elev)", color: "var(--ink)", borderTop: "1px solid var(--line)" },
});

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

const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const tag = (e.target as HTMLElement).closest<HTMLElement>(".cm-tag");
    if (tag && e.button === 0 && (!tag.classList.contains("is-raw") || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      view.state.facet(editorContext).openTag(tag.dataset.tag!);
      return true;
    }
    const t = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink, .cm-md-link");
    if (!t || e.button !== 0) return false;
    if (t.classList.contains("is-raw") && !(e.metaKey || e.ctrlKey)) return false;
    e.preventDefault();
    const ctx = view.state.facet(editorContext);
    if (t.dataset.target !== undefined) ctx.openTarget(t.dataset.target, ctx.path);
    else if (t.dataset.href) {
      const href = t.dataset.href;
      if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
      else ctx.openTarget(decodeURIComponent(href), ctx.path);
    }
    return true;
  },
});

export function createState(opts: {
  doc: string;
  kind: "md" | "html";
  vim: boolean;
  /** A viewer's workspace: the note shows, and boards and chips don't change it. */
  readOnly?: boolean;
  context: EditorContext;
  onUpdate: (docChanged: boolean, fromRemote: boolean, state: EditorState) => void;
}): EditorState {
  const lang: Extension =
    opts.kind === "md"
      ? [markdownWithFrontmatter(), keymap.of(markdownKeymap), livePreview, blockWidgets, stepIntoBlocks, linkClicks, typingHelpers()]
      : [html(), indentUnit.of("  ")];
  return EditorState.create({
    doc: opts.doc,
    extensions: [
      vimSlot.of(opts.vim ? vim() : []), // must precede other keymaps
      editorContext.of(opts.context),
      EditorState.readOnly.of(!!opts.readOnly),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      lang,
      syntaxHighlighting(quireHighlight),
      agentFlash,
      theme,
      placeholder(opts.kind === "md" ? "Start writing…" : "<!doctype html>"),
      EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet) {
          const fromRemote = u.transactions.some((t) => t.annotation(remote));
          opts.onUpdate(u.docChanged, fromRemote, u.state);
        }
      }),
    ],
  });
}
