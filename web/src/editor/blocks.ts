// Block-level live preview: whole-line embeds, tables and frontmatter render as widgets.
// Block decorations must come from a StateField (they change vertical layout).
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Facet, StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { api, assetUrl } from "../api.ts";
import { el, icon } from "../dom.ts";
import { currentScheme, embedKindOf, renderMarkdown, sandboxFrame, sectionOf, type EmbedKind } from "../render.ts";
import DOMPurify from "dompurify";
import { providerFrame, resolveEmbed } from "../embeds/providers.ts";
import { newId, parseDirective, serializeDirective, type Directive } from "../widgets/args.ts";
import { renderWidget, type WidgetEnv } from "../widgets/core.ts";
import { pendingConfig, WIDGETS } from "../widgets/index.ts";
import type { NoteMeta, TagCount } from "../api.ts";
import { touches } from "./livePreview.ts";
import { dataEmbed, hydrateDataEmbeds } from "../textPreview.ts";
import { scanTags } from "../../../src/core/tags.ts";
import { boardsIn, setBoardArgs } from "../../../src/core/kanban.ts";
import { hydrateBoards, mountBoard, type BoardHost } from "../kanban.ts";
import { kanbanBlock } from "../widgets/kanban.ts";
import { editsBetween } from "../merge.ts";
import { redo, undo } from "@codemirror/commands";
import { safeDecode } from "../../../src/core/uri.ts";

export interface EditorContext {
  path: string;
  /** Open a note. `side`: to the side of this one (Cmd/Ctrl-click). */
  openTarget(target: string, from: string, opts?: { side?: boolean }): void;
  createNote(name: string): void;
  notes(): NoteMeta[];
  /** Upload files (or pick some, if none given); resolves to the names to embed them by. */
  upload(files?: File[]): Promise<string[]>;
  /** Tags in use, for `#` suggestions and widget settings. */
  tags(): TagCount[];
  /** Every folder, for widget settings. */
  folders(): string[];
  /** Show what carries a tag: notes, or (from a task) tasks. */
  openTag(tag: string, where?: "notes" | "tasks"): void;
  /** Offer to keep a note query as a smart folder (from a ::query widget's settings). */
  saveSmartFolder(query: string, name: string, anchor: HTMLElement): void;
  /** Show a person's tasks. */
  openPerson(name: string): void;
}
export const editorContext = Facet.define<EditorContext, EditorContext>({ combine: (v) => v[0] });

/** Dispatch to re-render embeds (e.g. an embedded note changed on disk). */
export const refreshEmbeds = StateEffect.define<null>();
let embedRev = 0;
export function bumpEmbeds(view: EditorView) {
  embedRev++;
  view.dispatch({ effects: refreshEmbeds.of(null) });
}

const heights = new Map<string, number>();

/** The markdown line a rendered card belongs to (cards hang off the start of the following line). */
function sourceLine(view: EditorView, dom: HTMLElement) {
  const pos = view.posAtDOM(dom);
  const line = view.state.doc.lineAt(pos);
  return pos === line.from && line.number > 1 ? view.state.doc.line(line.number - 1) : line;
}

function reveal(view: EditorView, dom: HTMLElement) {
  view.dispatch({ selection: { anchor: sourceLine(view, dom).to }, scrollIntoView: false });
  view.focus();
}

function lastLine(doc: Text, from: number, to: number) {
  return doc.lineAt(to > from && doc.sliceString(to - 1, to) === "\n" ? to - 1 : to);
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly kind: EmbedKind,
    readonly from: string,
    readonly rev: number,
  ) {
    super();
  }
  get key() {
    return `${this.from}|${this.target}`;
  }
  eq(o: EmbedWidget) {
    return o.target === this.target && o.kind === this.kind && o.from === this.from && o.rev === this.rev;
  }
  get estimatedHeight() {
    return heights.get(this.key) ?? { image: 260, video: 320, social: 420, bookmark: 112, html: 340, note: 180, data: 240 }[this.kind];
  }
  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const outer = el("div", { class: "cm-embed-block", contenteditable: "false" });
    const card = this.card(view, outer);
    outer.append(card);
    return outer;
  }

  private card(view: EditorView, outer: HTMLElement): HTMLElement {
    const ctx = view.state.facet(editorContext);
    const wrap = el("div", { class: `cm-embed is-${this.kind}` });
    const settle = () => {
      requestAnimationFrame(() => {
        if (outer.isConnected) heights.set(this.key, outer.offsetHeight);
        view.requestMeasure();
      });
    };
    const [name, heading] = this.target.split("#");

    if (this.kind === "image" || this.kind === "video") {
      const src = assetUrl(this.target, this.from);
      const media =
        this.kind === "image"
          ? el("img", { src, alt: this.target, draggable: "false", onload: settle, onerror: () => missing() })
          : el("video", { src, controls: true, preload: "metadata", onloadedmetadata: settle });
      wrap.append(el("figure", {}, media));
      wrap.addEventListener("mousedown", (e) => {
        if (this.kind === "image") {
          e.preventDefault();
          reveal(view, wrap);
        }
      });
      const missing = () => {
        wrap.replaceChildren(el("div", { class: "embed-missing" }, icon("image", 15), `Can't find ${this.target}`));
        settle();
      };
      return wrap;
    }

    if (this.kind === "social") {
      const box = el("div", { class: "embed-social is-loading" });
      wrap.append(box);
      resolveEmbed(this.target)
        .then((info) => {
          if (!info) return bookmark(view, wrap, this.target, settle);
          const frame = providerFrame(info);
          box.classList.remove("is-loading");
          // Video players get our frame; post cards (X, Bluesky, …) already draw their own.
          box.classList.add(info.aspect ? "is-video" : "is-card");
          box.dataset.provider = info.provider;
          box.style.maxWidth = info.maxWidth ? `${info.maxWidth}px` : "";
          box.append(
            el("div", { class: "embed-frame", style: { aspectRatio: info.aspect ?? "" } }, frame),
            sourceBar(view, wrap, info.label, info.url),
          );
          frame.addEventListener("load", settle);
          wrap.addEventListener("quire-resize", settle);
          settle();
        })
        .catch(() => bookmark(view, wrap, this.target, settle));
      return wrap;
    }

    if (this.kind === "bookmark") {
      bookmark(view, wrap, this.target, settle);
      return wrap;
    }

    if (this.kind === "data") {
      return dataEmbed(this.target, this.from, {
        settle,
        actions: [
          el("button", { class: "embed-btn", title: "Edit the embed line", type: "button", onmousedown: (e: Event) => (e.preventDefault(), reveal(view, outer)) }, icon("code", 14)),
          el("button", { class: "embed-btn", title: "Open in Assets", type: "button", onmousedown: (e: Event) => (e.preventDefault(), ctx.openTarget(this.target, this.from)) }, icon("open", 14)),
        ],
      });
    }

    // note / html: a card with a header
    const title = el("span", { class: "embed-title" }, name.replace(/\.(md|html?)$/i, ""));
    const body = el("div", { class: "embed-body is-loading" }, el("div", { class: "skeleton" }), el("div", { class: "skeleton short" }));
    const head = el(
      "div",
      { class: "embed-head" },
      icon(this.kind === "html" ? "html" : "file", 14),
      title,
      heading ? el("span", { class: "embed-heading" }, icon("hash", 12), heading) : null,
      el("span", { class: "spacer" }),
      el("button", { class: "embed-btn", title: "Edit the embed line", type: "button", onmousedown: (e: Event) => (e.preventDefault(), reveal(view, wrap)) }, icon("code", 14)),
      el("button", { class: "embed-btn", title: "Open note", type: "button", onmousedown: (e: Event) => (e.preventDefault(), ctx.openTarget(this.target, this.from)) }, icon("open", 14)),
    );
    wrap.append(head, body);

    (async () => {
      const path = await api.resolve(name, this.from);
      body.classList.remove("is-loading");
      if (!path) {
        body.replaceChildren(
          el(
            "div",
            { class: "embed-missing" },
            `No note named “${name}”.`,
            el("button", { class: "link-btn", type: "button", onmousedown: (e: Event) => (e.preventDefault(), ctx.createNote(name)) }, "Create it"),
          ),
        );
        return settle();
      }
      const note = await api.note(path);
      title.textContent = note.title;
      if (this.kind === "html") {
        const frame = sandboxFrame(note.content, { autoHeight: true, title: note.title });
        frame.addEventListener("load", settle);
        wrap.addEventListener("quire-resize", settle);
        body.replaceChildren(frame);
      } else {
        const md = heading ? sectionOf(note.content, heading) : note.content;
        body.innerHTML = renderMarkdown(md, path, { boards: !heading });
        hydrateDataEmbeds(body, path, settle);
        body.querySelectorAll("input").forEach((i) => (i.disabled = true));
        (outer as any).stopBoards = hydrateBoards(body, path, { ctx, readOnly: view.state.readOnly, resized: settle });
        body.querySelectorAll("img").forEach((img) => img.addEventListener("load", settle));
        body.addEventListener("mousedown", (e) => {
          const a = (e.target as HTMLElement).closest("a");
          if (!a) return;
          e.preventDefault();
          const href = a.getAttribute("href") ?? "";
          if (href.startsWith("quire:")) ctx.openTarget(safeDecode(href.slice(6)), path);
          else if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
        });
        body.addEventListener("click", (e) => (e.target as HTMLElement).closest("a") && e.preventDefault()); // opened on mousedown
      }
      settle();
    })().catch(() => {
      body.classList.remove("is-loading");
      body.replaceChildren(el("div", { class: "embed-missing" }, `Couldn't load ${name}.`));
      settle();
    });
    return wrap;
  }

  destroy(dom: HTMLElement) {
    for (const stop of (dom as any).stopBoards ?? []) stop();
  }
}

function sourceBar(view: EditorView, wrap: HTMLElement, label: string, url: string): HTMLElement {
  const u = new URL(url);
  return el(
    "div",
    { class: "embed-source" },
    el("span", { class: "embed-provider" }, label),
    el("span", { class: "embed-url" }, u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")),
    el("span", { class: "spacer" }),
    el("button", { class: "embed-btn", title: "Edit the link", type: "button", onmousedown: (e: Event) => (e.preventDefault(), reveal(view, wrap)) }, icon("code", 14)),
    el("button", { class: "embed-btn", title: "Open in browser", type: "button", onmousedown: (e: Event) => (e.preventDefault(), window.open(url, "_blank", "noopener")) }, icon("open", 14)),
  );
}

/** A link card for any other pasted URL: title, description, site and image from the page's OpenGraph tags. */
function bookmark(view: EditorView, wrap: HTMLElement, url: string, settle: () => void) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  wrap.className = "cm-embed is-bookmark";
  const card = el("div", { class: "bookmark", title: url }, el("div", { class: "bm-text" }, el("div", { class: "bm-title" }, host), el("div", { class: "bm-site" }, url)));
  const edit = el("button", { class: "embed-btn bm-edit", title: "Edit the link", type: "button" }, icon("code", 14));
  edit.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    reveal(view, wrap);
  });
  card.addEventListener("mousedown", (e) => e.preventDefault());
  card.addEventListener("click", () => window.open(url, "_blank", "noopener"));
  wrap.replaceChildren(card, edit);
  settle();
  fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
    .then((r) => r.json())
    .then((meta: { title: string | null; description: string | null; image: string | null; siteName: string | null; favicon: string | null }) => {
      const favicon = meta.favicon ? el("img", { class: "bm-favicon", src: meta.favicon, alt: "", referrerpolicy: "no-referrer" }) : null;
      favicon?.addEventListener("error", () => favicon.remove());
      const thumb = meta.image ? el("div", { class: "bm-thumb" }, el("img", { src: meta.image, alt: "", referrerpolicy: "no-referrer", onload: settle })) : null;
      thumb?.querySelector("img")?.addEventListener("error", () => (thumb.remove(), settle()));
      card.replaceChildren(
        el(
          "div",
          { class: "bm-text" },
          el("div", { class: "bm-title" }, meta.title ?? host),
          meta.description ? el("div", { class: "bm-desc" }, meta.description) : null,
          el("div", { class: "bm-site" }, favicon, meta.siteName ?? host),
        ),
        ...(thumb ? [thumb] : []),
      );
      settle();
    })
    .catch(() => {});
}

/** `::timer{…}`, `::stopwatch{…}` and friends: interactive widgets whose config lives in the markdown line. */
class DirectiveWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly directive: Directive,
    readonly note: string,
  ) {
    super();
  }
  eq(o: DirectiveWidget) {
    return o.source === this.source && o.note === this.note;
  }
  get estimatedHeight() {
    return heights.get(`w|${this.source}`) ?? 120;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const { name, args } = this.directive;
    const root = el("div", { class: "cm-widget", contenteditable: "false" });
    const env: WidgetEnv = {
      args,
      note: this.note,
      openConfig: !!args.id && pendingConfig.delete(args.id),
      update: (next) => {
        const line = sourceLine(view, root);
        const indent = line.text.match(/^\s*/)![0];
        view.dispatch({ changes: { from: line.from, to: line.to, insert: indent + serializeDirective({ name, args: next }) } });
      },
      withId: (fn) => {
        if (args.id) return fn(args.id);
        const id = newId();
        fn(id); // save state under the new id first, so the re-rendered widget picks it up
        env.update({ ...args, id });
      },
      focusEditor: () => view.focus(),
      open: (target, line, side) => view.state.facet(editorContext).openTarget(line ? `${target}#L${line}` : target, this.note, { side }),
      openTag: (tag) => view.state.facet(editorContext).openTag(tag, "tasks"),
      saveSmartFolder: (query, name, anchor) => view.state.facet(editorContext).saveSmartFolder(query, name, anchor),
      sources: { tags: () => view.state.facet(editorContext).tags(), folders: () => view.state.facet(editorContext).folders() },
      openPerson: (name) => view.state.facet(editorContext).openPerson(name),
      editor: view.state.facet(editorContext),
      readOnly: view.state.readOnly,
      remeasure: () =>
        requestAnimationFrame(() => {
          if (root.isConnected) heights.set(`w|${this.source}`, root.offsetHeight);
          view.requestMeasure();
        }),
    };
    const { dom, destroy } = renderWidget(WIDGETS[name], env);
    root.append(dom);
    (root as any).destroyWidget = destroy;
    env.remeasure();
    return root;
  }
  destroy(dom: HTMLElement) {
    (dom as any).destroyWidget?.();
  }
}

/**
 * A `:::kanban` block drawn as its board, while the cursor is outside it. Each board change is a
 * transaction on the note, so it saves and undoes like typing. A change to the block's text redraws
 * the same board in place; new settings build it again.
 */
class BoardWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly index: number,
    readonly opening: string,
  ) {
    super();
  }
  eq(o: BoardWidget) {
    return o.source === this.source && o.index === this.index;
  }
  get estimatedHeight() {
    return heights.get(`k|${this.index}|${this.opening}`) ?? 320;
  }
  ignoreEvent() {
    return true;
  }
  updateDOM(dom: HTMLElement) {
    const board = (dom as any).board as ReturnType<typeof mountBoard> | undefined;
    if (!board || dom.dataset.opening !== this.opening) return false;
    (dom as any).at.index = this.index;
    board.update(this.index);
    return true;
  }
  toDOM(view: EditorView) {
    const root = el("div", { class: "cm-widget cm-board", contenteditable: "false", "data-opening": this.opening });
    const at = ((root as any).at = { index: this.index });
    const ctx = () => view.state.facet(editorContext);
    const resized = () =>
      requestAnimationFrame(() => {
        if (root.isConnected) heights.set(`k|${this.index}|${this.opening}`, root.offsetHeight);
        view.requestMeasure();
      });
    const board = () => boardsIn(view.state.doc.toString())[at.index];
    const host: BoardHost = {
      ctx: ctx(),
      get path() {
        return ctx().path;
      },
      text: () => view.state.doc.toString(),
      write: (next) => view.dispatch({ changes: editsBetween(view.state.doc.toString(), next).changes, userEvent: "input.board" }),
      undo: () => undo(view),
      redo: () => redo(view),
      readOnly: view.state.readOnly,
      editText: () => {
        const b = board();
        if (b) view.dispatch({ selection: { anchor: view.state.doc.line(b.from + 1).to }, scrollIntoView: true });
        view.focus();
      },
      resized,
    };
    const env: WidgetEnv = {
      args: board()?.args ?? {},
      note: ctx().path,
      openConfig: false,
      update: (args) => view.dispatch({ changes: editsBetween(view.state.doc.toString(), setBoardArgs(view.state.doc.toString(), at.index, args)).changes }),
      withId: (fn) => fn(""),
      focusEditor: () => view.focus(),
      remeasure: resized,
      open: (target) => ctx().openTarget(target, ctx().path),
      openTag: (tag) => ctx().openTag(tag, "tasks"),
      openPerson: (name) => ctx().openPerson(name),
      saveSmartFolder: () => {}, // a board's settings have no query to save
      sources: { tags: () => ctx().tags(), folders: () => ctx().folders() },
      editor: ctx(),
      readOnly: view.state.readOnly,
    };
    const spec = kanbanBlock((body, _env, card) => {
      const edit = el("button", { class: "qw-icon", type: "button", title: "Edit as text", "aria-label": "Edit as text", onclick: host.editText }, icon("code", 15));
      card.querySelector(".qw-head")!.insertBefore(edit, card.querySelector(".qw-head .qw-icon"));
      const b = mountBoard(body, host, this.index);
      (root as any).board = b;
      return b.destroy;
    });
    const { dom, destroy } = renderWidget(spec, env);
    root.append(dom);
    (root as any).destroyWidget = destroy;
    return root;
  }
  destroy(dom: HTMLElement) {
    (dom as any).destroyWidget?.();
  }
}

let mermaid: Promise<(typeof import("mermaid"))["default"]> | null = null;
let diagramSeq = 0;

/** ```mermaid code blocks render as diagrams (loaded on first use; strict mode, no HTML labels). */
class DiagramWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly rev: number,
  ) {
    super();
  }
  eq(o: DiagramWidget) {
    return o.code === this.code && o.rev === this.rev;
  }
  get estimatedHeight() {
    return heights.get(`d|${this.code}`) ?? 260;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const card = el("div", { class: "cm-diagram is-loading" });
    const outer = el("div", { class: "cm-diagram-block" }, card);
    outer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const doc = view.state.doc;
      const line = doc.lineAt(view.posAtDOM(outer));
      // Collapsed, the widget sits on the opening fence: put the cursor on the first line of code.
      // Expanded, it hangs below the closing fence, which is already inside the block.
      const fence = /^\s*(```|~~~)\s*mermaid/i.test(line.text);
      const target = fence ? doc.line(Math.min(line.number + 1, doc.lines)) : doc.line(Math.max(1, line.number - 1));
      view.dispatch({ selection: { anchor: target.to } });
      view.focus();
    });
    mermaid ??= import("mermaid").then((m) => m.default);
    mermaid
      .then(async (m) => {
        const css = getComputedStyle(document.documentElement);
        const v = (name: string) => css.getPropertyValue(name).trim();
        m.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false, curve: "basis" },
          // Drawn in the app's own palette, so diagrams look native in light and dark.
          theme: "base",
          darkMode: currentScheme() === "dark",
          fontFamily: getComputedStyle(document.body).fontFamily,
          themeVariables: {
            fontSize: "14px",
            background: v("--bg-elev"),
            primaryColor: v("--bg"),
            primaryBorderColor: v("--accent"),
            primaryTextColor: v("--ink-strong"),
            secondaryColor: v("--code-bg"),
            tertiaryColor: v("--bg-side"),
            lineColor: v("--muted"),
            textColor: v("--ink-2"),
            edgeLabelBackground: v("--bg-elev"),
            clusterBkg: v("--bg-side"),
            clusterBorder: v("--line-strong"),
            noteBkgColor: v("--code-bg"),
            noteTextColor: v("--ink"),
            actorBkg: v("--bg"),
            actorBorder: v("--accent"),
            actorTextColor: v("--ink-strong"),
            signalColor: v("--ink-2"),
          },
        });
        const { svg } = await m.render(`qd-${++diagramSeq}`, this.code);
        card.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      })
      .catch((err) => {
        card.replaceChildren(el("div", { class: "cm-diagram-error" }, `Diagram error: ${String(err?.message ?? err).split("\n")[0]}`));
      })
      .finally(() => {
        card.classList.remove("is-loading");
        requestAnimationFrame(() => {
          if (outer.isConnected) heights.set(`d|${this.code}`, outer.offsetHeight);
          view.requestMeasure();
        });
      });
    return outer;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: string,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.source === this.source;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const wrap = el("div", { class: "cm-table-block" }, el("div", { class: "cm-table-widget", html: renderMarkdown(this.source, this.from) }));
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      reveal(view, wrap);
    });
    return wrap;
  }
}

class PropertiesWidget extends WidgetType {
  constructor(readonly yaml: string) {
    super();
  }
  eq(o: PropertiesWidget) {
    return o.yaml === this.yaml;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    // Tags come from the index's own parser (so a block list works too) and filter Notes when clicked.
    const tags = scanTags(`---\n${this.yaml}\n---\n`).filter((t) => t.frontmatter);
    const tagChip = (display: string) => {
      const chip = el("span", { class: "tag is-link", title: `Notes tagged #${display}` }, `#${display}`);
      chip.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.state.facet(editorContext).openTag(display);
      });
      return chip;
    };
    const rows = this.yaml
      .split("\n")
      .map((l) => l.match(/^([\w-]+):\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map(([, k, v]) => {
        const list = v.match(/^\[(.*)\]$/);
        const values = list ? list[1].split(",").map((s) => s.trim()).filter(Boolean) : [v.replace(/^["']|["']$/g, "")];
        return el(
          "div",
          { class: "prop" },
          el("span", { class: "prop-key" }, k),
          k === "tags"
            ? el("span", { class: "prop-val" }, ...tags.map((t) => tagChip(t.display)))
            : el("span", { class: "prop-val" }, ...values.map((x) => el("span", { class: list ? "prop-item" : "" }, x))),
        );
      });
    const wrap = el("div", { class: "cm-properties-block" }, el("div", { class: "cm-properties" }, ...rows));
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      reveal(view, wrap);
    });
    return wrap;
  }
}

const EMBED_LINE = /^\s*!\[\[([^\]]+?)\]\]\s*$/;
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)\s*$/;
/** A URL alone on its line (what you get by pasting a link). `<url>` opts out and stays a plain link. */
const BARE_URL = /^\s*(https?:\/\/[^\s<>]+)\s*$/;

function buildBlocks(state: EditorState): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 150) ?? syntaxTree(state);
  const ctx = state.facet(editorContext);
  const from = ctx?.path ?? "";
  const doc = state.doc;
  const out: Range<Decoration>[] = [];

  // Boards drawn in place of their block; nothing inside one renders on its own.
  const drawn: Array<{ from: number; to: number }> = [];
  const text = doc.toString();
  if (text.includes(":::kanban")) {
    boardsIn(text).forEach((b, i) => {
      const first = doc.line(b.from + 1);
      const last = doc.line(b.close + 1);
      if (touches(state, first.from, last.to)) return;
      drawn.push({ from: first.from, to: last.to });
      out.push(Decoration.replace({ block: true, widget: new BoardWidget(doc.sliceString(first.from, last.to), i, first.text.trim()) }).range(first.from, last.to));
    });
  }
  const hidden = (pos: number) => drawn.some((r) => pos >= r.from && pos <= r.to);

  tree.iterate({
    enter(ref) {
      if (hidden(ref.from)) return false;
      if (ref.name === "Frontmatter") {
        const first = doc.lineAt(ref.from);
        const last = lastLine(doc, ref.from, ref.to);
        if (!touches(state, first.from, last.to)) {
          const yaml = doc.sliceString(first.to + 1, Math.max(first.to + 1, last.from - 1));
          out.push(Decoration.replace({ block: true, widget: new PropertiesWidget(yaml) }).range(first.from, last.to));
        }
        return false;
      }
      if (ref.name === "FencedCode") {
        const info = ref.node.getChild("CodeInfo");
        if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") return false;
        const first = doc.lineAt(ref.from);
        const last = lastLine(doc, ref.from, ref.to);
        if (last.number === first.number) return false;
        const closed = /^\s*(```|~~~)/.test(last.text);
        const code = doc.sliceString(first.to + 1, closed ? Math.max(first.to + 1, last.from - 1) : last.to);
        const widget = new DiagramWidget(code, embedRev);
        if (touches(state, first.from, last.to)) {
          // Editing: the code stays visible with the live diagram under it.
          out.push(
            last.number < doc.lines
              ? Decoration.widget({ block: true, side: -1, widget }).range(last.to + 1)
              : Decoration.widget({ block: true, side: 1, widget }).range(last.to),
          );
        } else {
          out.push(Decoration.replace({ block: true, widget }).range(first.from, last.to));
        }
        return false;
      }
      if (ref.name === "Table") {
        const first = doc.lineAt(ref.from);
        const last = lastLine(doc, ref.from, ref.to);
        if (!touches(state, first.from, last.to)) {
          const src = doc.sliceString(first.from, last.to);
          out.push(Decoration.replace({ block: true, widget: new TableWidget(src, from) }).range(first.from, last.to));
        }
        return false;
      }
      if (ref.name === "Paragraph") {
        const first = doc.lineAt(ref.from).number;
        const last = lastLine(doc, ref.from, ref.to).number;
        for (let l = first; l <= last; l++) {
          const line = doc.line(l);
          if (hidden(line.from)) continue;
          // The markdown line stays visible (as a quiet caption) above what it renders, so the
          // cursor can move onto it and edit it like any other line.
          const place = (widget: WidgetType) => {
            const active = touches(state, line.from, line.to);
            out.push(Decoration.line({ class: active ? "cm-embed-src is-active" : "cm-embed-src" }).range(line.from));
            // Hang the card off the start of the *next* line: attached to the end of the source
            // line, the two form one tall block that vertical cursor motion jumps over.
            out.push(
              line.number < doc.lines
                ? Decoration.widget({ block: true, side: -1, widget }).range(line.to + 1)
                : Decoration.widget({ block: true, side: 1, widget }).range(line.to),
            );
          };
          const directive = parseDirective(line.text);
          if (directive && WIDGETS[directive.name]) {
            place(new DirectiveWidget(line.text.trim(), directive, from));
            continue;
          }
          const wiki = line.text.match(EMBED_LINE);
          const img = wiki ? null : line.text.match(IMAGE_LINE);
          const bare = wiki || img ? null : line.text.match(BARE_URL);
          if (!wiki && !img && !bare) continue;
          const target = wiki ? wiki[1].split("|")[0].trim() : img ? safeDecode(img[2]) : bare![1];
          const kind = wiki ? embedKindOf(target) : img ? (embedKindOf(target) === "note" ? "image" : embedKindOf(target)) : embedKindOf(target, true);
          place(new EmbedWidget(target, kind, from, embedRev));
        }
        return false;
      }
    },
  });
  return Decoration.set(out, true);
}

export const blockWidgets = StateField.define<DecorationSet>({
  create: (s) => buildBlocks(s),
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshEmbeds)) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildBlocks(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Tables and frontmatter collapse into rendered cards, and vertical cursor motion (j/k, arrows)
 * would step straight over them. When a one-step move jumps a collapsed block, land inside it
 * instead, which expands it for editing.
 */
export const stepIntoBlocks = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.selection.ranges.length > 1) return tr;
  const start = tr.startState;
  const deco = start.field(blockWidgets, false);
  if (!deco) return tr;
  const doc = start.doc;
  const a = doc.lineAt(start.selection.main.head).number;
  const b = doc.lineAt(tr.selection.main.head).number;
  if (Math.abs(b - a) < 2) return tr;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let hidden = 0;
  let target: number | null = null;
  deco.between(doc.line(lo).to, doc.line(hi).from, (from, to, d) => {
    if (!d.spec.block || from === to) return;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    if (first <= lo || last >= hi) return;
    hidden += last - first + 1;
    if (b > a) target ??= doc.line(first).from;
    else target = doc.line(last).from;
  });
  if (target === null || Math.abs(b - a) - hidden !== 1) return tr;
  return [tr, { selection: EditorSelection.single(tr.selection.main.empty ? target : tr.selection.main.anchor, target), sequential: true }];
});
