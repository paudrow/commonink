import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { clickWhere, dropDock, forget, linkClick, paletteEnter, step, visit } from "../web/src/panes.ts";
import { markdownWithFrontmatter } from "../web/src/editor/language.ts";
import { noteLinkAt } from "../web/src/editor/linkAt.ts";

test("in the palette, Enter opens here, ⌘Enter (Ctrl+Enter off a Mac) or ⌥Enter in a new tab, ⌘⌥Enter to the side, and Shift+Enter makes a note", () => {
  const key = (metaKey: boolean, ctrlKey: boolean, shiftKey = false, altKey = false) => ({ metaKey, ctrlKey, shiftKey, altKey });
  assert.deepEqual([key(false, false), key(true, false), key(false, true), key(false, false, true), key(true, false, true), key(true, false, false, true), key(false, false, false, true)].map((e) => paletteEnter(e, true)), ["here", "tab", "here", "create", "create", "side", "tab"]);
  assert.deepEqual([key(false, false), key(true, false), key(false, true), key(false, true, false, true)].map((e) => paletteEnter(e, false)), ["here", "here", "tab", "side"]);
});

test("⌘⌥Enter finds the note linked under the cursor, or just before it, and never a web link", () => {
  const doc = "See [[Pricing page|tiers]] and [the plan](Projects/Plan.md) or [site](https://example.com).";
  const at = (text: string, offset = 0) => {
    const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()], selection: { anchor: doc.indexOf(text) + offset } });
    return noteLinkAt(state);
  };
  assert.deepEqual([at("Pricing"), at("tiers]]", 7), at("the plan"), at("site"), at("See")], ["Pricing page", "Pricing page", "Projects/Plan.md", null, null]);
});

test("⌘-click (Ctrl-click off a Mac) or a middle-click opens in a new tab, ⌘⌥-click to the side; a Mac's Ctrl-click is the right-click menu", () => {
  const click = (keys: string, button = 0) => ({ metaKey: keys.includes("⌘"), ctrlKey: keys.includes("^"), altKey: keys.includes("⌥"), button });
  const clicks = [click(""), click("⌘"), click("^"), click("⌘⌥"), click("^⌥"), click("⌘^"), click("", 1), click("⌘", 2)];
  assert.deepEqual(clicks.map((e) => clickWhere(e, true)), ["here", "tab", "here", "side", "here", "here", "tab", "here"]);
  assert.deepEqual(clicks.map((e) => clickWhere(e, false)), ["here", "here", "tab", "here", "side", "tab", "tab", "here"]);
});

test("a note link opens here on a plain click, in a tab or to the side on those clicks, and leaves a Shift-click to the browser", () => {
  const click = (keys: string, button = 0) => ({ metaKey: keys.includes("⌘"), ctrlKey: keys.includes("^"), shiftKey: keys.includes("⇧"), altKey: keys.includes("⌥"), button });
  const clicks = [click(""), click("⌘"), click("^"), click("⇧"), click("⌥"), click("", 1), click("⌘⌥")];
  assert.deepEqual(clicks.map((e) => linkClick(e, true)), ["here", "tab", "browser", "browser", "browser", "tab", "side"]);
  assert.deepEqual(clicks.map((e) => linkClick(e, false)), ["here", "browser", "tab", "browser", "browser", "tab", "browser"]);
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

test("a note dropped near the top or bottom edge splits above or below, elsewhere beside it", () => {
  assert.equal(dropDock(0.7, 0.5), "right");
  assert.equal(dropDock(0.3, 0.5), "left");
  assert.equal(dropDock(0.5, 0.1), "top");
  assert.equal(dropDock(0.5, 0.9), "bottom");
  assert.equal(dropDock(0.05, 0.1), "left"); // a corner goes to the nearer edge
  assert.equal(dropDock(0.9, 0.95), "bottom");
});
