import { test } from "node:test";
import assert from "node:assert/strict";
import { closeTab, openTab, parseTabs, stepTab } from "../web/src/tabs.ts";

test("opening a note changes the tab you're on; a new tab goes after it; one already open stays put", () => {
  assert.deepEqual(openTab([], null, "a", false), ["a"]);
  assert.deepEqual(openTab(["a", "b"], "a", "c", false), ["c", "b"]);
  assert.deepEqual(openTab(["a", "b"], "a", "c", true), ["a", "c", "b"]);
  assert.deepEqual(openTab(["a", "b"], "a", "b", true), ["a", "b"]);
  assert.deepEqual(openTab(["a", "b"], "gone", "c", false), ["a", "b", "c"]);
});

test("closing a tab shows the one after it, else the one before", () => {
  assert.deepEqual(closeTab(["a", "b", "c"], "b"), { tabs: ["a", "c"], next: "c" });
  assert.deepEqual(closeTab(["a", "b", "c"], "c"), { tabs: ["a", "b"], next: "b" });
  assert.deepEqual(closeTab(["a"], "a"), { tabs: [], next: null });
  assert.deepEqual(closeTab(["a"], "x"), { tabs: ["a"], next: null });
});

test("gt and gT step through the tabs, wrapping around", () => {
  assert.equal(stepTab(["a", "b", "c"], "c", 1), "a");
  assert.equal(stepTab(["a", "b", "c"], "a", -1), "c");
  assert.equal(stepTab(["a", "b"], null, 1), "a");
  assert.equal(stepTab([], "a", 1), null);
});

test("stored tabs come back per pane; anything malformed is none", () => {
  assert.deepEqual(parseTabs([["a", "b", "a", 3], ["c"]]), [["a", "b"], ["c"]]);
  for (const raw of [null, "x", 42, {}]) assert.deepEqual(parseTabs(raw), [[], []]);
});
