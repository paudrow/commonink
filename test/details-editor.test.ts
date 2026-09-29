// Collapsible sections in the editor: which lines the cursor can stop on, what shows raw, and Space.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const { details, foldLayout, setFold, spaceToggles } = await import("../web/src/editor/details.ts");

const NOTE = [
  "Above", //                       1
  "<details>", //                   2
  "<summary>Transcript</summary>", // 3
  "", //                            4
  "Long talk.", //                  5
  "", //                            6
  "<details open>", //              7
  "<summary>Aside</summary>", //    8
  "", //                            9
  "- a list", //                    10
  "", //                            11
  "</details>", //                  12
  "", //                            13
  "</details>", //                  14
  "Below", //                       15
].join("\n");

const at = (line: number, doc = NOTE) => {
  const s = EditorState.create({ doc, extensions: details });
  const l = s.doc.line(line);
  return s.update({ selection: EditorSelection.cursor(l.from) }).state;
};
const opened = (s: EditorState, key: string, open = true) => s.update({ effects: setFold.of({ key, open }) }).state;

/** The lines drawn (not hidden in a block): where j, k and the arrows can land. */
function visible(s: EditorState): number[] {
  const hidden = foldLayout(s)
    .decorations.filter((r) => r.value.spec.block)
    .map((r) => [s.doc.lineAt(r.from).number, s.doc.lineAt(r.to).number]);
  return Array.from({ length: s.doc.lines }, (_, i) => i + 1).filter((n) => !hidden.some(([a, b]) => n >= a && n <= b));
}
const below = (s: EditorState, line: number) => visible(s).find((n) => n > line);
const above = (s: EditorState, line: number) => visible(s).findLast((n) => n < line);

test("closed: the cursor stops on the summary line, and the next step skips the hidden content", () => {
  const s = at(1);
  assert.deepEqual(visible(s), [1, 3, 15]);
  assert.equal(below(s, 1), 3, "j from the line above lands on the summary");
  assert.equal(below(s, 3), 15, "j again skips the closed section");
  assert.equal(above(s, 15), 3, "k from below lands on the summary");
  assert.equal(above(s, 3), 1, "k again goes past the <details> line");
  // The cursor steps over the hidden content as one: from the end of the summary line to the line after.
  const summary = s.doc.line(3);
  assert.ok(foldLayout(s).atoms.some((a) => a.from === summary.to && a.to === s.doc.line(15).from));
});

test("open: the summary, then every content line; nested sections fold on their own", () => {
  const s = opened(at(1), "Transcript");
  assert.deepEqual(visible(s), [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 15]);
  assert.equal(below(s, 3), 4, "j from the summary enters the content");
  assert.equal(above(s, 15), 13, "k from below lands on the last content line");
  const inner = opened(s, "Aside", false);
  assert.deepEqual(visible(inner), [1, 3, 4, 5, 6, 8, 13, 15], "the closed inner section keeps only its summary");
});

test("tags show as written only on the line the cursor is on", () => {
  const onSummary = opened(at(3), "Transcript");
  const widgets = (s: EditorState, line: number) =>
    foldLayout(s)
      .decorations.filter((r) => s.doc.lineAt(r.from).number === line && !r.value.spec.block && r.value.spec.widget)
      .map((r) => r.value.spec.widget.constructor.name);
  assert.deepEqual(widgets(onSummary, 3), ["ToggleWidget"], "on the summary line: raw, with its triangle");
  assert.deepEqual(visible(onSummary).slice(0, 3), [1, 3, 4], "and the <details> line stays out of the way");
  assert.deepEqual(widgets(opened(at(1), "Transcript"), 3), ["SummaryWidget"], "off it: the summary as it reads");
  assert.ok(visible(at(2)).includes(2), "a cursor put on the <details> line (a search, a line number) shows it");
  assert.ok(visible(opened(at(12), "Transcript")).includes(12), "and on a </details> line");
});

test("Space on a summary line opens or closes the section: anywhere in vim's normal mode, else at the line's ends", () => {
  const press = (s: EditorState, anywhere: boolean) => {
    const sent: any[] = [];
    const view = { state: s, dispatch: (spec: unknown) => sent.push(spec) } as unknown as EditorView;
    return spaceToggles(view, anywhere) ? sent[0].effects.value : null;
  };
  const start = at(3);
  const middle = start.update({ selection: EditorSelection.cursor(start.doc.line(3).from + 12) }).state;
  const end = start.update({ selection: EditorSelection.cursor(start.doc.line(3).to) }).state;
  assert.deepEqual(press(start, false), { key: "Transcript", open: true });
  assert.deepEqual(press(end, false), { key: "Transcript", open: true });
  assert.equal(press(middle, false), null, "typing inside the summary types a space");
  assert.deepEqual(press(middle, true), { key: "Transcript", open: true });
  assert.deepEqual(press(opened(end, "Transcript"), false), { key: "Transcript", open: false });
  assert.equal(press(at(5), true), null, "not on a summary line: Space is Space");
});
