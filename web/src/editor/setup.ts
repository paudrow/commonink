import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, indentUnit } from "@codemirror/language";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { vim } from "@replit/codemirror-vim";
import { markdownWithFrontmatter, quireHighlight } from "./language.ts";
import { livePreview } from "./livePreview.ts";
import { blockWidgets, editorContext, stepIntoBlocks, type EditorContext } from "./blocks.ts";
import { agentFlash } from "./agentFlash.ts";
import { typingHelpers } from "./complete.ts";
import { IS_MAC, sideClick } from "../panes.ts";
import { linkKind } from "../links.ts";
import { LINK_DRAG, type LinkDrag } from "../dom.ts";
import { noteLinkAt } from "./linkAt.ts";
import { linkSideButton } from "./sideButton.ts";
import { details, wrapSection } from "./details.ts";
import { gfmPreview } from "./gfm.ts";
import { taskLineTools } from "./taskTools.ts";
import { safeDecode } from "../../../src/core/uri.ts";

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

const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (IS_MAC && e.ctrlKey) return false; // a Mac's Ctrl-click is the right-click menu: leave it be
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
    // ⌘-click (Ctrl-click off a Mac) on a rendered link to a note opens it to the side; on a raw one
    // (cursor on it) it follows it. A link that leaves the app opens in the browser either way.
    const side = !t.classList.contains("is-raw") && sideClick(e);
    const open = () => {
      if (t.dataset.target !== undefined) ctx.openTarget(t.dataset.target, ctx.path, { side });
      else if (t.dataset.href) {
        const href = t.dataset.href;
        if (linkKind(href) === "external") window.open(href, "_blank", "noopener");
        else ctx.openTarget(safeDecode(href), ctx.path, { side });
      }
    };
    // A rendered [[link]] can also be dragged to the right edge of the window, to open it there.
    if (t.dataset.target !== undefined && !t.classList.contains("is-raw")) dragLink(e, t.dataset.target, ctx.path, open);
    else open();
    return true;
  },
});

/**
 * Follow a press on a [[link]]: released where it started, it opens the link; moved, it's a drag,
 * which the app shell shows and takes at the window's right edge (see LinkDrag in dom.ts). A
 * pointer drag rather than HTML drag and drop, since the link is text in an editable page.
 */
function dragLink(e: MouseEvent, target: string, from: string, open: () => void) {
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;
  const send = (phase: LinkDrag["phase"], ev: MouseEvent) => window.dispatchEvent(new CustomEvent<LinkDrag>(LINK_DRAG, { detail: { phase, x: ev.clientX, y: ev.clientY, target, from } }));
  const move = (ev: MouseEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
    if (!moved) document.body.classList.add("is-link-dragging");
    moved = true;
    send("move", ev);
  };
  const up = (ev: MouseEvent) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.classList.remove("is-link-dragging");
    if (moved) send("drop", ev);
    else open();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** Open the note linked under the cursor to the side: ⌘⌥Enter (Ctrl+Alt+Enter off a Mac), and `gs` in vim. */
export function openLinkToSide(view: EditorView): boolean {
  const target = noteLinkAt(view.state);
  if (target === null) return false;
  const ctx = view.state.facet(editorContext);
  ctx.openTarget(target, ctx.path, { side: true });
  return true;
}

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
      ? [markdownWithFrontmatter(), keymap.of(markdownKeymap), gfmPreview, livePreview, linkSideButton, keymap.of([{ key: "Mod-Alt-Enter", run: openLinkToSide }, { key: "Mod-Alt-s", run: wrapSection }]), details, taskLineTools, blockWidgets, stepIntoBlocks, linkClicks, typingHelpers()]
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
