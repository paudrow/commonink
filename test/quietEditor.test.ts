import "./dom.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { markdownWithFrontmatter } from "../web/src/editor/language.ts";
import { lineHintAt } from "../web/src/editor/lineHint.ts";
import { blockWidgets, hiddenSource, selectSource, stepIntoBlocks } from "../web/src/editor/blocks.ts";

const at = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: { anchor, head }, extensions: [markdownWithFrontmatter(), blockWidgets, stepIntoBlocks] });
/** Which lines of `doc` get the hint, with the cursor on each empty line in turn. */
const hinted = (doc: string) =>
  doc.split("\n").flatMap((text, i) => {
    if (text) return [];
    const state = at(doc, doc.split("\n").slice(0, i).join("\n").length + (i ? 1 : 0));
    return lineHintAt(state) === state.doc.line(i + 1).from ? [i + 1] : [];
  });

test("the empty-line hint shows on empty prose lines, not in code, properties or lists", () => {
  assert.deepEqual(hinted("---\ntags: [a]\n\n---\n\n# Title\n\nText\n\n- one\n\n- two\n\nMore\n\n```\ncode\n\n```\n"), [5, 7, 9, 13, 15, 20]);
  assert.deepEqual(hinted("Text\n\n```js\nlet a\n\n"), [2], "an unclosed code block runs to the end");
  assert.deepEqual(hinted("- a\n  \n"), [3], "a line of spaces isn't empty");
});

test("the empty-line hint needs one empty cursor in a note with something in it", () => {
  assert.equal(lineHintAt(at("", 0)), null, "an empty note has its own placeholder");
  assert.equal(lineHintAt(at("a\n\nb", 1, 3)), null, "a selection");
  assert.equal(lineHintAt(at("a\n\nb", 1)), null, "a line with text");
  assert.equal(lineHintAt(EditorState.create({ doc: "a\n\nb", selection: { anchor: 2 }, extensions: [EditorState.readOnly.of(true)] })), null, "read-only");
  assert.equal(lineHintAt(at("a\n\nb", 2)), 2);
});

const NOTE = "Intro\n::timer{duration=25m}\nNext\n\n![[margin.svg]]\n\nhttps://example.com\nAfter";
const lineStart = (doc: string, n: number) => EditorState.create({ doc }).doc.line(n).from;
const lineEnd = (doc: string, n: number) => EditorState.create({ doc }).doc.line(n).to;

test("a widget's or embed's markdown line is hidden until the cursor is on it", () => {
  const hidden = (state: EditorState) => [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => hiddenSource(state, n));
  assert.deepEqual(hidden(at(NOTE, 0)), [2, 5, 7]);
  assert.deepEqual(hidden(at(NOTE, lineStart(NOTE, 2) + 3)), [5, 7]);
  assert.deepEqual(hidden(at(NOTE, lineEnd(NOTE, 5))), [2, 7], "the cursor at the end of the line counts");
  assert.deepEqual(hidden(at(NOTE, lineStart(NOTE, 1), lineStart(NOTE, 8))), [], "a selection across them shows them all");
});

const run = (state: EditorState, dir: -1 | 1) => {
  let tr: Transaction | null = null;
  const handled = selectSource(dir)({ state, dispatch: (t) => (tr = t) });
  const next = (tr as Transaction | null)?.state;
  return { handled, doc: next?.doc.toString(), selected: next ? next.sliceDoc(next.selection.main.from, next.selection.main.to) : null };
};

test("Backspace after a hidden markdown line, or Delete before one, selects it instead of joining onto it", () => {
  assert.deepEqual(run(at(NOTE, lineStart(NOTE, 3)), -1), { handled: true, doc: NOTE, selected: "::timer{duration=25m}" });
  assert.deepEqual(run(at(NOTE, lineEnd(NOTE, 1)), 1), { handled: true, doc: NOTE, selected: "::timer{duration=25m}" });
  assert.deepEqual(run(at(NOTE, lineStart(NOTE, 8)), -1), { handled: true, doc: NOTE, selected: "https://example.com" });
  assert.equal(run(at(NOTE, lineStart(NOTE, 6)), -1).handled, false, "from an empty line Backspace works as usual");
  assert.equal(run(at(NOTE, lineStart(NOTE, 3) + 1), -1).handled, false, "not at the start of the line");
  assert.equal(run(at(NOTE, lineEnd(NOTE, 3)), 1).handled, false, "the next line is empty, not a card");
  assert.equal(run(at(NOTE, lineStart(NOTE, 3), lineStart(NOTE, 3) + 2), -1).handled, false, "a selection deletes as usual");
});

test("one arrow press past a hidden markdown line lands on it; a click lands where it was clicked", () => {
  const move = (from: number, to: number, userEvent = "select") => at(NOTE, lineStart(NOTE, from)).update({ selection: { anchor: lineStart(NOTE, to) }, userEvent }).state;
  const line = (s: EditorState) => s.doc.lineAt(s.selection.main.head).number;
  assert.equal(line(move(1, 3)), 2);
  assert.equal(line(move(3, 1)), 2);
  assert.equal(line(move(6, 8)), 7);
  assert.equal(line(move(4, 6)), 5);
  assert.equal(line(move(1, 4)), 4, "a longer jump is left alone");
  assert.equal(line(at(NOTE, 0).update({ selection: { anchor: lineStart(NOTE, 3) } }).state), 2, "vim's j, which has no user event");
  assert.equal(line(move(1, 3, "select.pointer")), 3, "a click");
});

test("a jump lands where it aims, past a card or a table; one arrow press still steps onto them", () => {
  const TABLE = "# Days\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n## After";
  const move = (doc: string, from: number, to: number, userEvent: string) => {
    const s = at(doc, lineStart(doc, from)).update({ selection: { anchor: lineStart(doc, to) }, userEvent }).state;
    return s.doc.lineAt(s.selection.main.head).number;
  };
  assert.equal(move(NOTE, 1, 3, "select.jump"), 3, "the Outline, a link to a heading, back and forward");
  assert.equal(move(NOTE, 3, 1, "select.jump"), 1);
  assert.equal(move(NOTE, 6, 8, "select.search"), 8, "a find");
  assert.equal(move(TABLE, 2, 6, "select.jump"), 6);
  assert.equal(move(TABLE, 2, 6, "select"), 3, "an arrow press steps into the table");
  assert.equal(move(TABLE, 6, 2, "select"), 5);
});

// A timer card ticks on jsdom's window.setInterval, which node's clearInterval can't stop.
after(() => window.close());

/** A note in an editor with vim, the cursor at the start of `line`; `keys` types into vim. */
function vimAt(doc: string, line: number) {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: lineStart(doc, line) }, extensions: [vim(), markdownWithFrontmatter(), blockWidgets, stepIntoBlocks] }), parent: document.body });
  const cm = getCM(view) as Parameters<typeof Vim.handleEx>[0];
  const keys = (typed: string) => {
    for (const k of typed) Vim.handleKey(cm, k, "user");
    return view.state.doc.toString();
  };
  return { view, cm, keys };
}

test("vim's J, gJ and :join stop at a card's or a code block's hidden lines, as at the end of the note", () => {
  const CARD = "Some text\n::timer{duration=25m}\nNext";
  const j = vimAt(CARD, 1);
  assert.equal(j.keys("wJ"), CARD);
  assert.equal(j.view.state.selection.main.head, 5, "the cursor stays put");
  assert.equal(vimAt(CARD, 1).keys("gJ"), CARD);
  const ex = vimAt(CARD, 1);
  Vim.handleEx(ex.cm, "join");
  assert.equal(ex.view.state.doc.toString(), CARD, ":join");
  assert.equal(vimAt("a\nb\n::timer{duration=25m}\nc", 1).keys("3J"), "a b\n::timer{duration=25m}\nc", "a count joins up to the card");
  assert.equal(vimAt("Text\n```js\nlet a\n```", 1).keys("J"), "Text\n```js\nlet a\n```", "a code block drawn as itself");
  assert.equal(vimAt(CARD, 2).keys("J"), "Some text\n::timer{duration=25m} Next", "on the card's line, which shows, J works as usual");
});

test("vim's J and gJ join as usual away from cards", () => {
  assert.equal(vimAt("a\n  b\nc", 1).keys("J"), "a b\nc");
  assert.equal(vimAt("a\n  b\nc", 1).keys("gJ"), "a  b\nc");
  assert.equal(vimAt("a\n  b\nc", 1).keys("3J"), "a b c");
  assert.equal(vimAt("a\n\nc", 1).keys("J"), "a\nc", "an empty line adds no space");
  const one = vimAt("ab\ncd", 1);
  one.keys("J");
  assert.equal(one.view.state.selection.main.head, 2, "the cursor on the joining space");
  assert.equal(vimAt("only", 1).keys("J"), "only", "the last line joins nothing");
});
