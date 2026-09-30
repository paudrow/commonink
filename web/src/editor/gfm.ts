// GitHub-flavored markdown in live preview: alerts, footnotes, emoji shortcodes, the HTML GitHub
// allows (`<kbd>`, `<sub>`, `<sup>`, `<br>`, `<img>`, `<picture>`), and a "copy link" on each
// heading. Like the rest of live preview, markup shows as written while the cursor is on it.
// Foldable alerts fold by the same state as collapsible sections (see details.ts).
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { el, icon } from "../dom.ts";
import { inline } from "../taskRow.ts";
import { renderMarkdown } from "../render.ts";
import { alertsIn, footnotesIn, headingSlug, type AlertBlock, type Footnotes } from "../../../src/core/gfm.ts";
import { emojiFor, SHORTCODE } from "../../../src/core/emoji.ts";
import { clip } from "../../../src/core/depth.ts";
import { headingName, headingText } from "../../../src/core/prose.ts";
import { editorContext } from "./blocks.ts";
import { alertOpen, setFold } from "./details.ts";
import { touches } from "./livePreview.ts";

const hide = Decoration.replace({});

/** A document's alerts and footnotes, read once per version of it. */
const NO_NOTES: Footnotes = { defs: new Map(), refs: [], number: new Map() };
const parsed = new WeakMap<Text, { alerts: AlertBlock[]; notes: Footnotes }>();
function gfmOf(doc: Text) {
  let p = parsed.get(doc);
  if (!p) {
    const md = doc.toString();
    parsed.set(doc, (p = { alerts: md.includes("[!") ? alertsIn(md) : [], notes: md.includes("[^") ? footnotesIn(md) : NO_NOTES }));
  }
  return p;
}

/** Where markdown shows as written: code, URLs, links' targets, HTML blocks, frontmatter. */
const RAW = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "Frontmatter", "FrontmatterContent", "HTMLBlock", "CommentBlock", "URL", "Autolink", "WikiLink", "Embed"]);
function raw(state: EditorState, pos: number): boolean {
  for (let n: any = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (RAW.has(n.name)) return true;
  return false;
}

/** Sanitized HTML for a bit of a note's own HTML (an `<img>`, a `<picture>`), rendered once. */
const htmlCache = new Map<string, string>();
function htmlOf(src: string, path: string): string {
  const key = `${path}\n${src}`;
  let html = htmlCache.get(key);
  if (html === undefined) {
    if (htmlCache.size > 200) htmlCache.clear();
    htmlCache.set(key, (html = renderMarkdown(src, path)));
  }
  return html;
}

const jump = (view: EditorView, pos: number) => {
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
};

// ---------------------------------------------------------------- widgets

/** An alert's title line: its icon and title, and for a foldable one a triangle to open or close it. */
class AlertTitleWidget extends WidgetType {
  constructor(
    readonly a: AlertBlock,
    readonly open: boolean,
  ) {
    super();
  }
  eq(o: AlertTitleWidget) {
    return o.a.key === this.a.key && o.a.type === this.a.type && o.a.title === this.a.title && o.a.fold === this.a.fold && o.open === this.open;
  }
  ignoreEvent(e: Event) {
    return !!(e.target as HTMLElement).closest?.(".cm-alert-toggle");
  }
  toDOM(view: EditorView) {
    const title = el("span", { class: "cm-alert-title" }, el("span", { class: "markdown-alert-icon", "aria-hidden": "true" }), el("span", { html: inline(this.a.title) }));
    if (this.a.fold) {
      const toggle = el("button", { type: "button", class: "cm-alert-toggle", "aria-expanded": String(this.open), title: this.open ? "Fold the callout" : "Unfold the callout" }, icon("chevron", 13));
      toggle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({ effects: setFold.of({ key: this.a.key, open: !this.open }) });
      });
      title.append(toggle);
    }
    return title;
  }
}

/** A footnote reference: its number, raised, with the footnote on hover. A click goes to the footnote. */
class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly n: number,
    readonly text: string,
    readonly defLine: number,
  ) {
    super();
  }
  eq(o: FootnoteRefWidget) {
    return o.n === this.n && o.text === this.text && o.defLine === this.defLine;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const pop = el("span", { class: "cm-fn-pop", role: "tooltip" });
    const sup = el("sup", { class: "cm-fnref", "aria-label": `Footnote ${this.n}` }, String(this.n), pop);
    // The footnote's text is rendered the first time it's hovered, not for every reference drawn.
    sup.addEventListener("mouseenter", () => pop.childNodes.length || (pop.innerHTML = inline(this.text)), { once: true });
    sup.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.line(Math.min(this.defLine + 1, view.state.doc.lines));
      jump(view, line.from + (line.text.match(/^\[\^[^\]]*\]:\s*/)?.[0].length ?? 0));
    });
    return sup;
  }
}

/** A footnote's `[^id]:`, as its number and a way back to where it's referenced. */
class FootnoteDefWidget extends WidgetType {
  constructor(
    readonly n: number | null,
    readonly ref: number | null,
  ) {
    super();
  }
  eq(o: FootnoteDefWidget) {
    return o.n === this.n && o.ref === this.ref;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const label = el("span", { class: "cm-fn-label" }, this.n === null ? "Unused footnote" : `${this.n}.`);
    if (this.ref === null) return label;
    const back = el("button", { type: "button", class: "cm-fn-back", title: "Back to the reference", "aria-label": "Back to the reference" }, "↩");
    back.addEventListener("mousedown", (e) => {
      e.preventDefault();
      jump(view, Math.min(this.ref!, view.state.doc.length));
    });
    return el("span", { class: "cm-fn-def-head" }, label, back);
  }
}

class EmojiWidget extends WidgetType {
  constructor(
    readonly emoji: string,
    readonly name: string,
  ) {
    super();
  }
  eq(o: EmojiWidget) {
    return o.emoji === this.emoji;
  }
  toDOM() {
    return el("span", { class: "cm-emoji", title: `:${this.name}:` }, this.emoji);
  }
}

/** A note's own HTML, sanitized: an inline `<img>`, or a block of them (`<picture>`, `<p align>`). */
class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly at: number,
    readonly block: boolean,
  ) {
    super();
  }
  eq(o: HtmlWidget) {
    return o.html === this.html && o.at === this.at && o.block === this.block;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const node = el(this.block ? "div" : "span", { class: this.block ? "cm-html-block" : "cm-html-inline", html: this.html, title: "Click to edit the HTML" });
    node.querySelectorAll("img").forEach((img) => img.addEventListener("load", () => view.requestMeasure()));
    node.addEventListener("mousedown", (e) => {
      e.preventDefault();
      jump(view, this.at);
    });
    return node;
  }
}

class BreakWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return el("span", { class: "cm-br", "aria-hidden": "true" });
  }
}

/** On a heading, on hover: copy a link that opens the note scrolled to it. */
class HeadingLinkWidget extends WidgetType {
  constructor(readonly slug: string) {
    super();
  }
  eq(o: HeadingLinkWidget) {
    return o.slug === this.slug;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const button = el("button", { type: "button", class: "cm-heading-link", title: "Copy link to heading", "aria-label": "Copy link to heading" }, icon("link", 14));
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const note = view.state.facet(editorContext)?.noteUrl?.();
      if (!note) return;
      const done = (text: string) => {
        button.dataset.said = text;
        setTimeout(() => delete button.dataset.said, 1400);
      };
      navigator.clipboard.writeText(`${location.origin}${note}#${this.slug}`).then(
        () => done("Copied"),
        () => done("Couldn't copy"),
      );
    });
    return button;
  }
}

// ---------------------------------------------------------------- live preview

// Bounded, so a line of thousands of unclosed tags is one pass, not a scan to its end per tag.
const TAG = /<(kbd|sub|sup)>([^<\n]{1,500})<\/\1>|<br\s*\/?>|<img\b[^<>\n]{0,2000}>/gi;
const HEADING = /^#{1,6}[ \t]+(.+)$/;

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const path = state.facet(editorContext)?.path ?? "";
  const { alerts, notes } = gfmOf(doc);
  const out: Range<Decoration>[] = [];
  const refsByLine = new Map<number, Footnotes["refs"]>();
  for (const r of notes.refs) refsByLine.set(r.line, [...(refsByLine.get(r.line) ?? []), r]);
  const defAt = new Map([...notes.defs].map(([id, d]) => [d.line, id]));
  const firstRef = new Map<string, number>();
  for (const r of notes.refs) if (!firstRef.has(r.id)) firstRef.set(r.id, doc.line(r.line + 1).from + r.from);

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      const n = line.number - 1;
      const text = line.text;
      const onLine = touches(state, line.from, line.to);

      // Footnotes: a reference as its number, a definition's `[^id]:` as its number and a way back.
      for (const r of refsByLine.get(n) ?? []) {
        const def = notes.defs.get(r.id);
        const a = line.from + r.from;
        const b = line.from + r.to;
        if (!def || touches(state, a, b) || raw(state, a)) continue;
        out.push(Decoration.replace({ widget: new FootnoteRefWidget(notes.number.get(r.id)!, clip(def.text), def.line) }).range(a, b));
      }
      const defId = defAt.get(n);
      if (defId !== undefined) {
        out.push(Decoration.line({ class: "cm-fn-def" }).range(line.from));
        const head = text.match(/^\[\^[^\]]*\]:[ \t]*/)![0];
        if (!onLine) out.push(Decoration.replace({ widget: new FootnoteDefWidget(notes.number.get(defId) ?? null, firstRef.get(defId) ?? null) }).range(line.from, line.from + head.length));
      }

      // Emoji shortcodes where a word starts (not in 10:30 or a URL), outside code.
      if (text.includes(":")) {
        for (const m of text.matchAll(SHORTCODE)) {
          const emoji = emojiFor(m[2]);
          const a = line.from + m.index!;
          const b = a + m[1].length;
          if (!emoji || touches(state, a, b) || raw(state, a)) continue;
          out.push(Decoration.replace({ widget: new EmojiWidget(emoji, m[2]) }).range(a, b));
        }
      }

      // GitHub's inline HTML: keys, sub- and superscript, line breaks, images.
      if (text.includes("<")) {
        for (const m of text.matchAll(TAG)) {
          const a = line.from + m.index!;
          const b = a + m[0].length;
          if (touches(state, a, b) || raw(state, a)) continue;
          if (m[1]) {
            const open = m[1].length + 2;
            out.push(hide.range(a, a + open), Decoration.mark({ class: `cm-${m[1].toLowerCase()}` }).range(a + open, b - open - 1), hide.range(b - open - 1, b));
          } else if (/^<br/i.test(m[0])) out.push(Decoration.replace({ widget: new BreakWidget() }).range(a, b));
          else out.push(Decoration.replace({ widget: new HtmlWidget(htmlOf(m[0], path), a, false) }).range(a, b));
        }
      }

      // Headings: "Copy link to heading", on hover. Not on the title, which is the note itself.
      const h = !onLine && text.startsWith("#") ? text.match(HEADING) : null;
      if (h && !(line.number === 1 && text.startsWith("# ")) && !raw(state, line.from)) {
        const slug = headingSlug(headingName(headingText(h[1])) || headingText(h[1]));
        if (slug) out.push(Decoration.widget({ widget: new HeadingLinkWidget(slug), side: 1 }).range(line.to));
      }
    }
  }

  // Alerts: a callout's colour down its lines, and its marker drawn as the title.
  const top = doc.lineAt(view.viewport.from).number - 1;
  const bottom = doc.lineAt(view.viewport.to).number - 1;
  for (const a of alerts) {
    if (a.to < top || a.from > bottom) continue;
    const open = !a.fold || alertOpen(state, a);
    for (let l = a.from; l <= a.to; l++) {
      const cls = `cm-alert cm-alert-${a.type}${l === a.from ? " is-first" : ""}${l === a.to || (!open && l === a.from) ? " is-last" : ""}`;
      out.push(Decoration.line({ class: cls }).range(doc.line(l + 1).from));
    }
    const first = doc.line(a.from + 1);
    const marker = first.text.indexOf("[!");
    if (!touches(state, first.from, first.to)) out.push(Decoration.replace({ widget: new AlertTitleWidget(a, open) }).range(first.from + marker, first.to));
  }
  return Decoration.set(out, true);
}

export const gfmPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(setFold)))) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * An HTML block with images in it (`<picture>` with a dark-mode source, `<p align="center"><img>`),
 * drawn as it renders; while the cursor is in it, the HTML shows with the picture under it. Called
 * from the editor's block decorations (see blocks.ts).
 */
export function htmlImageBlock(state: EditorState, from: number, to: number, out: Range<Decoration>[]) {
  const doc = state.doc;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to > from && doc.sliceString(to - 1, to) === "\n" ? to - 1 : to);
  const src = doc.sliceString(first.from, last.to);
  if (!/<(img|picture)\b/i.test(src) || /<\/?(details|summary)\b/i.test(src)) return;
  const widget = new HtmlWidget(htmlOf(src, state.facet(editorContext)?.path ?? ""), first.from, true);
  if (touches(state, first.from, last.to)) out.push(Decoration.widget({ block: true, side: 1, widget }).range(last.to));
  else out.push(Decoration.replace({ block: true, widget }).range(first.from, last.to));
}
