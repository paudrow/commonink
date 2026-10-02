import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { dropDock, forget, linkClick, paletteEnter, parseLayout, sideClick, step, visit } from "../web/src/panes.ts";
import { markdownWithFrontmatter } from "../web/src/editor/language.ts";
import { noteLinkAt } from "../web/src/editor/linkAt.ts";

test("in the palette, Enter opens in place, ⌘Enter (Ctrl+Enter off a Mac) opens to the side, and Shift+Enter makes a note", () => {
  const key = (metaKey: boolean, ctrlKey: boolean, shiftKey = false) => ({ metaKey, ctrlKey, shiftKey });
  assert.deepEqual([key(false, false), key(true, false), key(false, true), key(false, false, true), key(true, false, true)].map((e) => paletteEnter(e, true)), ["open", "side", "open", "create", "create"]);
  assert.deepEqual([key(false, false), key(true, false), key(false, true)].map((e) => paletteEnter(e, false)), ["open", "open", "side"]);
});

test("⌘⌥Enter finds the note linked under the cursor, or just before it, and never a web link", () => {
  const doc = "See [[Pricing page|tiers]] and [the plan](Projects/Plan.md) or [site](https://example.com).";
  const at = (text: string, offset = 0) => {
    const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()], selection: { anchor: doc.indexOf(text) + offset } });
    return noteLinkAt(state);
  };
  assert.deepEqual([at("Pricing"), at("tiers]]", 7), at("the plan"), at("site"), at("See")], ["Pricing page", "Pricing page", "Projects/Plan.md", null, null]);
});

test("open to the side is Cmd-click on a Mac and Ctrl-click elsewhere; a Mac's Ctrl-click is the right-click menu, never a side click", () => {
  const click = (metaKey: boolean, ctrlKey: boolean, button = 0) => ({ metaKey, ctrlKey, button });
  assert.deepEqual(
    [click(true, false), click(false, true), click(true, true), click(false, false), click(true, false, 2)].map((e) => sideClick(e, true)),
    [true, false, false, false, false],
  );
  assert.deepEqual(
    [click(true, false), click(false, true), click(false, false), click(false, true, 1)].map((e) => sideClick(e, false)),
    [false, true, false, false],
  );
});

test("a note link opens in place on a plain click, to the side on a side click, and leaves new tabs and windows to the browser", () => {
  const click = (keys: string, button = 0) => ({ metaKey: keys.includes("⌘"), ctrlKey: keys.includes("^"), shiftKey: keys.includes("⇧"), altKey: keys.includes("⌥"), button });
  const clicks = [click(""), click("⌘"), click("^"), click("⇧"), click("⌥"), click("", 1), click("⌘⇧")];
  assert.deepEqual(clicks.map((e) => linkClick(e, true)), ["open", "side", "browser", "browser", "browser", "browser", "side"]);
  assert.deepEqual(clicks.map((e) => linkClick(e, false)), ["open", "browser", "side", "browser", "browser", "browser", "browser"]);
});

test("each pane keeps its own back and forward: visiting clears forward, and the same note twice is one visit", () => {
  let p = visit(visit(visit({ note: null, back: [], forward: [] }, "a"), "b"), "c");
  assert.deepEqual(p, { note: "c", back: ["a", "b"], forward: [] });
  assert.equal(visit(p, "c"), p);
  p = step(p, "back")!;
  assert.deepEqual(p, { note: "b", back: ["a"], forward: ["c"] });
  p = step(p, "back")!;
  assert.deepEqual(p, { note: "a", back: [], forward: ["c", "b"] });
  assert.equal(step(p, "back"), null);
  p = step(p, "forward")!;
  assert.deepEqual(p, { note: "b", back: ["a"], forward: ["c"] });
  assert.deepEqual(visit(p, "d"), { note: "d", back: ["a", "b"], forward: [] });
});

test("a note that's gone drops out of a pane's trail", () => {
  assert.deepEqual(forget({ note: "b", back: ["a", "b", "c"], forward: ["b"] }, "b"), { note: null, back: ["a", "c"], forward: [] });
});

test("a stored layout comes back as it was; anything missing or malformed is one pane", () => {
  const saved = { split: true, at: "bottom", side: 0.35, focus: 1, panes: [{ note: "a", back: ["x"], forward: [] }, { note: "b", back: [], forward: ["y"] }] };
  assert.deepEqual(parseLayout(JSON.stringify(saved)), saved);
  const one = { split: false, at: "right", side: 0.5, focus: 0, panes: [{ note: null, back: [], forward: [] }, { note: null, back: [], forward: [] }] };
  for (const raw of [null, "", "not json", "42", '{"panes":7}']) assert.deepEqual(parseLayout(raw), one, String(raw));
  assert.equal(parseLayout('{"at":"middle"}').at, "right");
  assert.deepEqual(parseLayout('{"split":true,"side":3,"focus":1,"panes":[{"note":"a"},{}]}'), { ...one, side: 0.8, panes: [{ note: "a", back: [], forward: [] }, one.panes[1]] });
});

test("a note dropped near the top or bottom edge splits above or below, elsewhere beside it", () => {
  assert.equal(dropDock(0.7, 0.5), "right");
  assert.equal(dropDock(0.3, 0.5), "left");
  assert.equal(dropDock(0.5, 0.1), "top");
  assert.equal(dropDock(0.5, 0.9), "bottom");
  assert.equal(dropDock(0.05, 0.1), "left"); // a corner goes to the nearer edge
  assert.equal(dropDock(0.9, 0.95), "bottom");
});
