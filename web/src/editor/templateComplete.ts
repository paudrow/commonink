// In a template (a note in Templates/), typing {{ suggests the placeholders, each with a line on
// what it does (the catalogue in src/core/templates.ts, which docs/templates.md lists too). A
// question's label is selected after it goes in, to type over. No DOM here, so it's tested in node.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { PLACEHOLDERS, TEMPLATES } from "../../../src/core/templates.ts";
import { editorContext } from "./blocks.ts";

export function placeholderSource(ctx: CompletionContext): CompletionResult | null {
  const path = ctx.state.facet(editorContext)?.path ?? "";
  if (!path.startsWith(`${TEMPLATES}/`)) return null;
  const m = ctx.matchBefore(/\{\{[^{}\n]*$/);
  if (!m || (m.from > 0 && ctx.state.sliceDoc(m.from - 1, m.from) === "\\")) return null; // \{{ stays as written
  const meeting = /(^|\/)Meeting note\.md$/i.test(path);
  const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "}}";
  const options: Completion[] = PLACEHOLDERS.filter((p) => p.where === "any" || meeting).map((p, i) => ({
    label: p.insert,
    detail: p.info,
    boost: -i,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const end = closed ? to + 2 : to;
      // A question: its label is selected, to type your own.
      const label = p.insert.match(/^\{\{ask:([^|}]+)/)?.[1];
      const anchor = from + (label ? "{{ask:".length : p.insert.length);
      view.dispatch({ changes: { from, to: end, insert: p.insert }, selection: { anchor, head: label ? anchor + label.length : anchor }, userEvent: "input.complete" });
    },
  }));
  return { from: m.from, options, validFor: /^\{\{[^{}\n]*$/ };
}
