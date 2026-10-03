// Help with a note's properties (its front matter), from the schemas in src/core/schema.ts: the
// properties it can have as you start a line, their values after `key:`, what each does on hover,
// and what's wrong, underlined where it is and named in a strip above the note. The rendered
// properties card marks a row with a problem too (blocks.ts), so it shows without the YAML open.
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { startCompletion } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, showPanel, WidgetType, type DecorationSet, type Panel } from "@codemirror/view";
import { frontmatterProblems, scanFrontmatter, schemaFor, type Problem, type PropSchema } from "../../../src/core/schema.ts";
import { el, icon } from "../dom.ts";
import { editorContext } from "./blocks.ts";

const pathOf = (state: EditorState) => state.facet(editorContext)?.path ?? "";

/** A property's type as a word, for completions and hover. */
function typeText(p: PropSchema): string {
  if (p.enum) return p.enum.join(" | ");
  if (p.type === "boolean") return "true | false";
  if (p.type === "array") return p.items?.enum ? `list of ${p.items.enum.join(" | ")}` : "list";
  return p.format === "date" ? "date" : "text";
}

const infoOf = (key: string, p: PropSchema) => () =>
  el(
    "div",
    { class: "prop-info" },
    el("div", { class: "prop-info-head" }, el("code", {}, key), el("span", {}, typeText(p))),
    el("p", {}, p.description),
    p.default !== undefined ? el("p", { class: "prop-info-more" }, `Default: ${String(p.default)}`) : null,
    p.examples?.length ? el("p", { class: "prop-info-more" }, `Like: ${p.examples.join(", ")}`) : null,
  );

/** Where the front matter's YAML is, if `pos` is in it. */
function inFrontmatter(state: EditorState, pos: number) {
  const scan = scanFrontmatter(state.doc.toString());
  return scan && pos >= scan.from && pos <= scan.to ? scan : null;
}

/**
 * At the start of a front matter line, the properties this note can have that it doesn't yet; after
 * `key: `, a true/false or listed property's values. (`tags:` has its own source, with the tags in use.)
 */
export function propertySource(ctx: CompletionContext): CompletionResult | null {
  const scan = inFrontmatter(ctx.state, ctx.pos);
  if (!scan) return null;
  const schema = schemaFor(pathOf(ctx.state));
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const key = before.match(/^([\w-]*)$/);
  if (key) {
    // On an empty line, only when asked (Ctrl-Space), or in a settings file, where a new line offers what's left to set.
    if (!key[1] && !ctx.explicit && schema.additionalProperties) return null;
    const used = new Set(scan.fields.filter((f) => f.from !== line.from).map((f) => f.key));
    const options = Object.entries(schema.properties)
      .filter(([k]) => !used.has(k))
      .map(([k, p]) => ({
        label: k,
        detail: typeText(p),
        info: infoOf(k, p),
        icon: "sliders",
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          // Renaming a key that has its colon already: keep its value.
          const at = view.state.doc.lineAt(to);
          const skip = view.state.sliceDoc(to, at.to).match(/^:[ \t]*/)?.[0].length ?? 0;
          const insert = `${k}: `;
          view.dispatch({ changes: { from, to: to + skip, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" });
          if (p.type === "boolean" || p.enum) setTimeout(() => startCompletion(view), 0);
        },
      }));
    return options.length ? { from: line.from, options, validFor: /^[\w-]*$/ } : null;
  }
  const value = before.match(/^([\w-]+):\s*(\w*)$/);
  const prop = value && schema.properties[value[1]];
  if (!value || !prop || !(prop.type === "boolean" || prop.enum)) return null;
  const values = prop.enum ?? ["true", "false"];
  return {
    from: ctx.pos - value[2].length,
    options: values.map((v) => ({ label: v, detail: String(prop.default) === v ? "default" : undefined, icon: "check", info: infoOf(value[1], prop) })),
    validFor: /^\w*$/,
  };
}

/** Hovering a property's key: what it is and what it does. */
const propertyHover = hoverTooltip((view, pos) => {
  const scan = inFrontmatter(view.state, pos);
  const field = scan?.fields.find((f) => pos >= f.from && pos <= f.to);
  const prop = field && schemaFor(pathOf(view.state)).properties[field.key];
  if (!field || !prop) return null;
  return { pos: field.from, end: field.to, above: true, create: () => ({ dom: infoOf(field.key, prop)() }) };
});

/** The note's property problems, kept up to date as it changes. */
const problemsField = StateField.define<Problem[]>({
  create: (state) => frontmatterProblems(state.doc.toString(), pathOf(state)),
  update: (value, tr) => (tr.docChanged ? frontmatterProblems(tr.state.doc.toString(), pathOf(tr.state)) : value),
});

/** Underline each problem where it is, with what's wrong on hover. */
const propertyLint = linter((view): Diagnostic[] => view.state.field(problemsField).map((p) => ({ from: p.from, to: Math.max(p.to, p.from), severity: p.severity, message: p.message })), { delay: 250 });

/** A strip above the note while its properties have a problem; clicking it goes to the first one. */
function problemsPanel(view: EditorView): Panel {
  const text = el("span", {});
  const dom = el("button", { type: "button", class: "prop-problems", onclick: () => {
    const first = view.state.field(problemsField)[0];
    if (!first) return;
    view.dispatch({ selection: EditorSelection.cursor(first.from), effects: EditorView.scrollIntoView(first.from, { y: "center" }) });
    view.focus();
  } }, icon("info", 14), text);
  const render = (problems: Problem[]) => {
    const errors = problems.filter((p) => p.severity === "error").length;
    dom.classList.toggle("is-error", errors > 0);
    text.textContent = problems.length === 1 ? `This note's properties have a problem: ${problems[0].message}` : `This note's properties have ${problems.length} problems. Show the first`;
  };
  render(view.state.field(problemsField));
  return { dom, top: true, update: (u) => u.docChanged && render(u.state.field(problemsField)) };
}

const problemsStrip = showPanel.from(problemsField, (problems) => (problems.length ? problemsPanel : null));

/** A settings file (one whose schema lists every key it may have). */
const strict = (state: EditorState) => !schemaFor(pathOf(state)).additionalProperties;

/** In a settings file, a new line in the properties offers the settings not set yet, so nobody has to know their names. */
const offerOnNewLine = EditorView.updateListener.of((u) => {
  if (!u.docChanged || !u.transactions.some((t) => t.isUserEvent("input")) || !strict(u.state)) return;
  const head = u.state.selection.main.head;
  const line = u.state.doc.lineAt(head);
  if (line.text.trim() || !inFrontmatter(u.state, head)) return;
  let newline = false;
  u.changes.iterChanges((_a, _b, _c, _d, text) => (newline ||= text.toString().includes("\n")));
  if (newline) setTimeout(() => startCompletion(u.view), 0);
});

/**
 * Under a settings file's properties, the settings it doesn't set yet, each with what it does and
 * an Add button: like VS Code's default settings, what you can set is in front of you.
 */
class AvailableWidget extends WidgetType {
  constructor(
    readonly rows: Array<[string, PropSchema]>,
    readonly at: number,
  ) {
    super();
  }
  eq(o: AvailableWidget) {
    return o.at === this.at && o.rows.map(([k]) => k).join() === this.rows.map(([k]) => k).join();
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const add = (key: string, p: PropSchema) => {
      const value = p.default !== undefined ? String(p.default) : p.enum ? "" : p.type === "array" ? "[]" : "";
      const insert = `${key}: ${value}`;
      view.dispatch({ changes: { from: this.at, insert: `${insert}\n` }, selection: { anchor: this.at + insert.length }, userEvent: "input.complete" });
      view.focus();
      if (!value && (p.enum || p.type === "boolean")) setTimeout(() => startCompletion(view), 0);
    };
    return el(
      "div",
      { class: "prop-available" },
      el("div", { class: "prop-available-head" }, "You can also set"),
      ...this.rows.map(([k, p]) =>
        el(
          "div",
          { class: "prop-available-row" },
          el("code", {}, k),
          el("span", { class: "prop-available-type" }, typeText(p)),
          el("span", { class: "prop-available-desc" }, p.description),
          el("button", { type: "button", class: "qw-btn", onmousedown: (e: Event) => (e.preventDefault(), add(k, p)) }, "Add"),
        ),
      ),
    );
  }
}

const SKIP = new Set(["title", "tags"]);
function available(state: EditorState): DecorationSet {
  if (!strict(state)) return Decoration.none;
  const scan = scanFrontmatter(state.doc.toString());
  if (!scan) return Decoration.none;
  const used = new Set(scan.fields.map((f) => f.key));
  const rows = Object.entries(schemaFor(pathOf(state)).properties).filter(([k]) => !used.has(k) && !SKIP.has(k));
  if (!rows.length) return Decoration.none;
  // After the closing --- line.
  const close = state.doc.lineAt(Math.min(scan.to, state.doc.length));
  return Decoration.set([Decoration.widget({ block: true, side: 1, widget: new AvailableWidget(rows, close.from) }).range(close.to)]);
}

const availableField = StateField.define<DecorationSet>({
  create: available,
  update: (value, tr) => (tr.docChanged ? available(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

export function propertyHelp(): Extension {
  return [problemsField, propertyLint, propertyHover, problemsStrip, offerOnNewLine, availableField];
}
