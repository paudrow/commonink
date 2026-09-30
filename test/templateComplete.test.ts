// Typing {{ in a template suggests its placeholders, each with what it does; nowhere else.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { editorContext, type EditorContext } from "../web/src/editor/blocks.ts";
import { placeholderSource } from "../web/src/editor/templateComplete.ts";

const at = (path: string, doc: string) => {
  const state = EditorState.create({ doc, extensions: [editorContext.of({ path } as EditorContext)], selection: { anchor: doc.length } });
  return placeholderSource(new CompletionContext(state, doc.length, false));
};

test("{{ in a template offers every placeholder with what it does; the calendar's only in the meeting note template", () => {
  const r = at("Templates/Meeting.md", "# {{");
  assert.equal(r?.from, 2);
  const labels = r!.options.map((o) => o.label);
  assert.ok(labels.includes("{{date:dddd, MMMM D}}") && labels.includes("{{ask:Attendees|people}}") && labels.includes("{{cursor}}"));
  assert.ok(!labels.includes("{{when}}"), "the event's placeholders are for Templates/Meeting note.md");
  assert.equal(r!.options.find((o) => o.label === "{{date+1d}}")?.detail, "Tomorrow: an offset in days (d) or weeks (w), + or -");
  assert.ok(at("Templates/Meeting note.md", "{{")!.options.some((o) => o.label === "{{when}}"));
});

test("not outside Templates/, not after a backslash, and not once the braces are closed", () => {
  assert.equal(at("Projects/Plan.md", "{{"), null);
  assert.equal(at("Templates/Meeting.md", "\\{{"), null);
  assert.equal(at("Templates/Meeting.md", "{{date}} and"), null);
});

test("picking one replaces what was typed (and closing braces already there); a question's label is selected to type over", () => {
  const doc = "Due {{da}}";
  let state = EditorState.create({ doc, extensions: [editorContext.of({ path: "Templates/T.md" } as EditorContext)], selection: { anchor: 8 } });
  const r = placeholderSource(new CompletionContext(state, 8, false))!;
  const view = { state, dispatch: (tr: { changes: unknown; selection: unknown }) => (state = state.update(tr as never).state) };
  const apply = (label: string) => {
    const o = r.options.find((x) => x.label === label)!;
    (o.apply as (v: unknown, c: unknown, from: number, to: number) => void)(view, o, r.from, 8);
  };
  apply("{{date+1d}}");
  assert.equal(state.doc.toString(), "Due {{date+1d}}");
  state = EditorState.create({ doc: "{{a", extensions: [editorContext.of({ path: "Templates/T.md" } as EditorContext)], selection: { anchor: 3 } });
  const q = placeholderSource(new CompletionContext(state, 3, false))!;
  const o = q.options.find((x) => x.label === "{{ask:Attendees|people}}")!;
  (o.apply as (v: unknown, c: unknown, from: number, to: number) => void)({ state, dispatch: (tr: never) => (state = state.update(tr).state) }, o, q.from, 3);
  assert.equal(state.doc.toString(), "{{ask:Attendees|people}}");
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), "Attendees");
});
