// Inline live preview: markup hides itself unless the selection touches it (Obsidian-style).
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { scanTags, type TagSpan } from "../../../src/core/tags.ts";
import { lineTokens, parseTask, TASK_LINE } from "../../../src/core/tasks.ts";
import { today, tokenChip } from "../taskChips.ts";
import { openChipEditor, taskPeople } from "../taskChipEditors.ts";
import { editorContext } from "./blocks.ts";
import { taskLineEdit } from "./taskEdit.ts";

const hide = Decoration.replace({});
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

/** A document's tags, found by the same parser the index uses, so a chip here is a tag there. */
const tagCache = new WeakMap<Text, TagSpan[]>();
function tagsIn(doc: Text): TagSpan[] {
  let spans = tagCache.get(doc);
  if (!spans) tagCache.set(doc, (spans = scanTags(doc.toString())));
  return spans;
}

export function touches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}
/** Last line of a node, not counting a trailing newline the node may include. */
const endLine = (state: EditorState, from: number, to: number) =>
  state.doc.lineAt(to > from && state.doc.sliceString(to - 1, to) === "\n" ? to - 1 : to);
const lineTouched = (state: EditorState, pos: number) => {
  const line = state.doc.lineAt(pos);
  return touches(state, line.from, line.to);
};

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = ["•", "◦", "▪"][this.depth % 3];
    return s;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = `cm-checkbox${this.checked ? " is-checked" : ""}`;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(this.pos);
      // Ticking stamps done: (and adds a repeating task's next occurrence below); one undo takes it back.
      const spec = taskLineEdit(view.state, line.number, line.text, { checked: !this.checked }, today());
      if (spec) view.dispatch(spec);
      else view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * A task token (due date, repeat, person, priority) drawn as a chip. Clicking it opens the same
 * editor as in task lists; the edit is a transaction on this line, so undo takes it back. The
 * chip keeps the mousedown, so the cursor doesn't move onto the line (which would turn the chip
 * back into text) and the editor keeps its selection. Clicking the task's text shows the raw tokens.
 */
class TokenWidget extends WidgetType {
  constructor(
    readonly field: Parameters<typeof tokenChip>[0],
    readonly value: string,
    readonly done: boolean,
  ) {
    super();
  }
  eq(o: TokenWidget) {
    return o.field === this.field && o.value === this.value && o.done === this.done;
  }
  toDOM(view: EditorView) {
    const chip = tokenChip(this.field, this.value, { done: this.done });
    chip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (!view.state.readOnly) openLineChip(view, chip);
    });
    return chip;
  }
  ignoreEvent() {
    return true;
  }
}

function openLineChip(view: EditorView, chip: HTMLElement) {
  const line = view.state.doc.lineAt(view.posAtDOM(chip));
  const task = parseTask(line.text);
  if (!task) return;
  const ctx = view.state.facet(editorContext);
  openChipEditor(chip, {
    task: { path: ctx.path, title: "", line: line.number, text: task.text, summary: task.summary, done: task.done, heading: null, meta: task.meta },
    save: async (patch) => {
      const spec = taskLineEdit(view.state, line.number, line.text, patch);
      if (spec) view.dispatch(spec);
    },
    people: taskPeople,
    showPerson: (name) => ctx.openPerson(name),
    onClose: () => setTimeout(() => view.focus()), // after the key or click that closed it is done
  });
}

class PlaceholderWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: PlaceholderWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-title-placeholder";
    s.textContent = this.text;
    return s;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-rule";
    return s;
  }
}

class FenceLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  eq(o: FenceLabelWidget) {
    return o.lang === this.lang;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-fence-label";
    s.textContent = this.lang || "code";
    return s;
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const doc = state.doc;

  // #tags render as chips; the # comes back while the cursor is on one.
  const first = doc.lineAt(view.viewport.from).number;
  const last = doc.lineAt(view.viewport.to).number;
  const inCode = (pos: number) => {
    for (let n: any = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (CODE.has(n.name)) return true;
    return false;
  };
  for (const t of tagsIn(doc)) {
    if (t.frontmatter || t.line < first || t.line > last) continue;
    const line = doc.line(t.line);
    const from = line.from + t.from - 1;
    if (inCode(from)) continue; // where the editor sees code, it shows no chip
    const to = line.from + t.to;
    const raw = touches(state, from, to);
    out.push(Decoration.mark({ class: `cm-tag${raw ? " is-raw" : ""}`, attributes: { "data-tag": t.display } }).range(raw ? from : from + 1, to));
    if (!raw) out.push(hide.range(from, from + 1));
  }

  // A task's tokens render as chips while the cursor is off its line.
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const task = line.text.match(TASK_LINE);
    if (!task || lineTouched(state, line.from) || inCode(line.from)) continue;
    for (const t of lineTokens(line.text)) {
      out.push(Decoration.replace({ widget: new TokenWidget(t.field, t.value, task[2] !== " ") }).range(line.from + t.from, line.from + t.to));
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node;
        const name = ref.name;

        if (name === "Frontmatter") {
          const first = doc.lineAt(ref.from).number;
          const last = endLine(state, ref.from, ref.to).number;
          for (let l = first; l <= last; l++) {
            const cls = `cm-frontmatter${l === first ? " is-first" : ""}${l === last ? " is-last" : ""}`;
            out.push(Decoration.line({ class: cls }).range(doc.line(l).from));
          }
          return false;
        }

        if (/^(ATX|Setext)Heading\d$/.test(name)) {
          const level = Number(name.slice(-1));
          const line = doc.lineAt(ref.from);
          out.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(line.from));
          if (level === 1 && line.number === 1 && /^#\s*$/.test(line.text)) {
            out.push(Decoration.widget({ widget: new PlaceholderWidget("Untitled"), side: 1 }).range(line.to));
          }
          return;
        }

        switch (name) {
          case "HeaderMark": {
            if (node.parent?.name.startsWith("ATX") && !lineTouched(state, ref.from)) {
              const line = doc.lineAt(ref.from);
              if (ref.from === line.from || /^\s*$/.test(doc.sliceString(line.from, ref.from))) {
                out.push(hide.range(ref.from, Math.min(ref.to + 1, line.to)));
              } else out.push(hide.range(ref.from, ref.to)); // closing ###
            }
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark": {
            const p = node.parent!;
            if (!touches(state, p.from, p.to)) out.push(hide.range(ref.from, ref.to));
            return;
          }
          case "InlineCode": {
            out.push(Decoration.mark({ class: "cm-inline-code" }).range(ref.from, ref.to));
            if (!touches(state, ref.from, ref.to)) {
              for (const m of node.getChildren("CodeMark")) out.push(hide.range(m.from, m.to));
            }
            return false;
          }
          case "Link": {
            const marks = node.getChildren("LinkMark");
            const url = node.getChild("URL");
            if (marks.length >= 2 && marks[1].from > marks[0].to) {
              const href = url ? doc.sliceString(url.from, url.to) : "";
              const active = touches(state, ref.from, ref.to);
              out.push(
                Decoration.mark({ class: `cm-md-link${active ? " is-raw" : ""}`, attributes: { "data-href": href } }).range(marks[0].to, marks[1].from),
              );
              if (!active) {
                out.push(hide.range(marks[0].from, marks[0].to));
                out.push(hide.range(marks[1].from, ref.to));
              }
            }
            return false;
          }
          case "URL": {
            // Bare URLs in prose (GFM autolinks) and <url>: ⌘-click opens them.
            if (node.parent?.name !== "Link" && node.parent?.name !== "Image") {
              out.push(Decoration.mark({ class: "cm-md-link is-raw cm-autolink", attributes: { "data-href": doc.sliceString(ref.from, ref.to) } }).range(ref.from, ref.to));
            }
            return;
          }
          case "Autolink": {
            if (!touches(state, ref.from, ref.to)) for (const m of node.getChildren("LinkMark")) out.push(hide.range(m.from, m.to));
            return;
          }
          case "WikiLink":
          case "Embed": {
            // A whole-line ![[embed]] is shown raw: it's the caption above the rendered embed.
            if (name === "Embed" && doc.lineAt(ref.from).text.trim() === doc.sliceString(ref.from, ref.to)) return false;
            const bang = name === "Embed" ? 1 : 0;
            const inner = doc.sliceString(ref.from + 2 + bang, ref.to - 2);
            const bar = inner.indexOf("|");
            const target = bar >= 0 ? inner.slice(0, bar) : inner;
            const active = touches(state, ref.from, ref.to);
            const cls = name === "Embed" ? "cm-wikilink cm-embed-inline" : "cm-wikilink";
            const mark = (a: number, b: number, extra = "") =>
              b > a && out.push(Decoration.mark({ class: cls + extra, attributes: { "data-target": target } }).range(a, b));
            if (active) {
              mark(ref.from, ref.to, " is-raw");
            } else {
              const textFrom = bar >= 0 ? ref.from + 2 + bang + bar + 1 : ref.from + 2 + bang;
              out.push(hide.range(ref.from, textFrom));
              mark(textFrom, ref.to - 2);
              out.push(hide.range(ref.to - 2, ref.to));
            }
            return false;
          }
          case "Blockquote": {
            const first = doc.lineAt(ref.from).number;
            const last = endLine(state, ref.from, ref.to).number;
            for (let l = first; l <= last; l++) out.push(Decoration.line({ class: "cm-quote" }).range(doc.line(l).from));
            return;
          }
          case "QuoteMark": {
            if (!lineTouched(state, ref.from)) {
              const next = doc.sliceString(ref.to, ref.to + 1) === " " ? ref.to + 1 : ref.to;
              out.push(hide.range(ref.from, next));
            }
            return;
          }
          case "ListMark": {
            const item = node.parent;
            const list = item?.parent;
            const task = item?.getChild("Task");
            if (list?.name === "BulletList") {
              if (task) {
                const marker = task.getChild("TaskMarker");
                if (marker && !touches(state, ref.from, marker.to)) out.push(hide.range(ref.from, marker.from));
              } else if (!touches(state, ref.from, ref.to)) {
                let depth = 0;
                for (let p = list.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
                out.push(Decoration.replace({ widget: new BulletWidget(depth) }).range(ref.from, ref.to));
              }
            } else {
              out.push(Decoration.mark({ class: "cm-list-num" }).range(ref.from, ref.to));
            }
            return;
          }
          case "TaskMarker": {
            const checked = /x/i.test(doc.sliceString(ref.from, ref.to));
            const listMark = node.parent?.parent?.getChild("ListMark");
            if (!touches(state, listMark?.from ?? ref.from, ref.to)) {
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked, ref.from) }).range(ref.from, ref.to));
            }
            const line = doc.lineAt(ref.from);
            if (checked && line.to > ref.to) out.push(Decoration.mark({ class: "cm-task-done" }).range(ref.to, line.to));
            return;
          }
          case "HorizontalRule": {
            out.push(Decoration.line({ class: "cm-hr-line" }).range(doc.lineAt(ref.from).from));
            if (!lineTouched(state, ref.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
            return;
          }
          case "FencedCode": {
            const first = doc.lineAt(ref.from);
            const last = endLine(state, ref.from, ref.to);
            const active = touches(state, ref.from, ref.to);
            for (let l = first.number; l <= last.number; l++) {
              let cls = "cm-codeblock";
              if (l === first.number) cls += " is-first";
              if (l === last.number) cls += " is-last";
              if ((l === first.number || (l === last.number && last.number > first.number)) && !active) cls += " is-fence";
              out.push(Decoration.line({ class: cls }).range(doc.line(l).from));
            }
            if (!active) {
              const info = node.getChild("CodeInfo");
              out.push(
                Decoration.replace({ widget: new FenceLabelWidget(info ? doc.sliceString(info.from, info.to) : "") }).range(first.from, first.to),
              );
              const marks = node.getChildren("CodeMark");
              const closing = marks.length > 1 ? marks[marks.length - 1] : null;
              if (closing && last.number > first.number) out.push(hide.range(last.from, last.to));
            }
            return false;
          }
          case "HTMLBlock":
          case "CommentBlock": {
            const first = doc.lineAt(ref.from).number;
            const last = endLine(state, ref.from, ref.to).number;
            for (let l = first; l <= last; l++) out.push(Decoration.line({ class: "cm-htmlblock" }).range(doc.line(l).from));
            return false;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
