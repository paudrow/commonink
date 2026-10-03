import { test } from "node:test";
import assert from "node:assert/strict";
import { closeOthers, closeTabs, closeToRight, currentTab, forgetEntry, insertTab, jumpIndex, MAX_TABS, moveTab, nudgeTab, openEntry, parseLayout, pinTab, setTrail, stepIndex, takeTab, type Group, type Tab } from "../web/src/tabs.ts";

const tab = (note: string, more: Partial<Tab> = {}): Tab => ({ note, back: [], forward: [], ...more });
const group = (notes: string, at = 0): Group => ({ tabs: notes.split("").map((n) => (n === n.toUpperCase() ? tab(n.toLowerCase(), { pinned: true }) : tab(n))), at });
/** A group as letters (pinned in capitals), with the showing one in brackets. */
const show = (g: Group) => g.tabs.map((t, i) => (i === g.at ? `[${t.pinned ? t.note!.toUpperCase() : t.note}]` : t.pinned ? t.note!.toUpperCase() : t.note)).join("");

test("opening changes the tab you're on, with back to what it showed; a tab that has it already shows instead", () => {
  let g = openEntry({ tabs: [], at: -1 }, "a");
  assert.equal(show(g), "[a]");
  g = openEntry(g, "b");
  assert.equal(show(g), "[b]");
  assert.deepEqual(currentTab(g), { note: "b", back: ["a"], forward: [] });
  g = openEntry(group("xyz", 0), "y");
  assert.equal(show(g), "x[y]z");
});

test("a new tab goes after the one showing, or where it's dropped; one already open moves there", () => {
  assert.equal(show(openEntry(group("abc", 0), "d", "new")), "a[d]bc");
  assert.equal(show(openEntry(group("abc", 0), "d", "new", 3)), "abc[d]");
  assert.equal(show(openEntry(group("abc", 0), "c", "new", 0)), "[c]ab");
  assert.equal(show(openEntry(group("abc", 1), "d", "here", 0)), "[d]abc"); // a drop is always a tab of its own
});

test("a pinned tab keeps its note: opening from it opens a new tab, after the pinned ones", () => {
  assert.equal(show(openEntry(group("Ab", 0), "c")), "A[c]b");
  assert.equal(show(insertTab(group("Ab", 1), tab("c"), 0)), "A[c]b");
  assert.equal(show(insertTab(group("Ab", 1), tab("c", { pinned: true }), 5)), "A[C]b");
});

test("a pane keeps at most MAX_TABS tabs: the leftmost that isn't pinned or showing closes", () => {
  let g: Group = { tabs: [tab("pin", { pinned: true })], at: 0 };
  for (let i = 0; i < MAX_TABS + 3; i++) g = openEntry(g, `n${i}`, "new");
  assert.equal(g.tabs.length, MAX_TABS);
  assert.equal(g.tabs[0].note, "pin");
  assert.equal(currentTab(g)!.note, `n${MAX_TABS + 2}`);
});

test("a step back or forward changes the showing tab's trail, keeping its pin", () => {
  const g = setTrail(group("Ab", 0), { note: "z", back: [], forward: ["a"] });
  assert.deepEqual(g.tabs[0], { note: "z", back: [], forward: ["a"], pinned: true });
  assert.equal(show(setTrail({ tabs: [], at: -1 }, { note: "a", back: [], forward: [] })), "[a]");
});

test("dragging a tab reorders the strip; pinned tabs stay first", () => {
  assert.equal(show(moveTab(group("abcd", 0), 0, 3)), "bc[a]d");
  assert.equal(show(moveTab(group("abcd", 1), 3, 0)), "da[b]c");
  assert.equal(show(moveTab(group("ABcd", 2), 3, 0)), "ABd[c]"); // not before the pinned ones
  assert.equal(show(moveTab(group("ABcd", 0), 0, 4)), "B[A]cd"); // nor a pinned one after the rest
  assert.equal(show(nudgeTab(group("abc", 1), 1, 1)), "ac[b]");
  assert.equal(show(nudgeTab(group("abc", 1), 1, -1)), "[b]ac");
  assert.equal(show(nudgeTab(group("abc", 0), 0, -1)), "[a]bc");
});

test("closing the tab showing shows the one to its right, else the left; closed tabs come back to reopen", () => {
  assert.equal(show(closeTabs(group("abc", 1), [1]).group), "a[c]");
  assert.equal(show(closeTabs(group("abc", 2), [2]).group), "a[b]");
  assert.equal(show(closeTabs(group("abcd", 1), [1, 2]).group), "a[d]");
  assert.equal(show(closeTabs(group("abc", 0), [2]).group), "[a]b");
  const r = closeTabs(group("a", 0), [0]);
  assert.deepEqual([r.group, r.closed], [{ tabs: [], at: -1 }, [tab("a")]]);
});

test("close others and close to the right leave pinned tabs", () => {
  assert.equal(show(closeOthers(group("Abcd", 3), 2).group), "A[c]");
  assert.deepEqual(closeOthers(group("Abcd", 3), 2).closed.map((t) => t.note), ["b", "d"]);
  assert.equal(show(closeToRight(group("abcd", 3), 1).group), "a[b]");
  assert.equal(show(closeToRight(group("abcd", 0), 1).group), "[a]b");
});

test("pinning moves a tab to the end of the pinned ones; unpinning, to the start of the rest", () => {
  assert.equal(show(pinTab(group("Abc", 2), 2, true)), "A[C]b");
  assert.equal(show(pinTab(group("ABc", 2), 0, false)), "Ba[c]");
  assert.equal(pinTab(group("abc", 0), 0, false).tabs[0].pinned, undefined);
});

test("⌃Tab steps through the tabs, wrapping; ⌘1 to ⌘8 pick one and ⌘9 the last", () => {
  assert.equal(stepIndex(group("abc", 2), 1), 0);
  assert.equal(stepIndex(group("abc", 0), -1), 2);
  assert.equal(stepIndex({ tabs: [], at: -1 }, 1), -1);
  assert.deepEqual([1, 3, 4, 9].map((n) => jumpIndex(group("abc"), n)), [0, 2, -1, 2]);
});

test("a tab dragged to the other pane goes with its back and forward; the pane it left shows its neighbour", () => {
  const from = { tabs: [tab("a"), tab("b", { back: ["x"] }), tab("c")], at: 1 };
  const r = takeTab(from, 1, group("yz", 0), 0);
  assert.equal(show(r.from), "a[c]");
  assert.equal(show(r.to), "[b]yz");
  assert.deepEqual(r.to.tabs[0].back, ["x"]);
  assert.equal(show(takeTab(group("ab", 0), 0, group("xa", 0)).to), "x[a]"); // it was there already
});

test("a note that's gone closes its tab and leaves the others' back and forward", () => {
  const g = forgetEntry({ tabs: [tab("a", { back: ["gone"] }), tab("gone"), tab("c")], at: 1 }, "gone");
  assert.deepEqual(g, { tabs: [tab("a"), tab("c")], at: 1 });
});

test("a stored layout comes back as it was; anything missing or malformed is one pane", () => {
  const saved = { split: true, at: "bottom", side: 0.35, focus: 1, groups: [{ tabs: [tab("p", { pinned: true }), tab("a", { back: ["x"] }), tab("page:/today")], at: 1 }, { tabs: [tab("b", { forward: ["y"] })], at: 0 }] };
  assert.deepEqual(parseLayout(JSON.stringify(saved)), saved);
  const one = { split: false, at: "right", side: 0.5, focus: 0, groups: [{ tabs: [], at: -1 }, { tabs: [], at: -1 }] };
  for (const raw of [null, "", "not json", "42", '{"panes":7}', '{"groups":7}']) assert.deepEqual(parseLayout(raw), one, String(raw));
  assert.equal(parseLayout('{"at":"middle"}').at, "right");
  // Repeats and tabs without a note drop out, pinned tabs go first, and the side pane keeps notes only.
  const messy = { split: true, groups: [{ tabs: [tab("a"), tab("a"), { note: 3 }, tab("b", { pinned: true })], at: 0 }, { tabs: [tab("page:/notes")], at: 0 }] };
  assert.deepEqual(parseLayout(JSON.stringify(messy)), { ...one, groups: [{ tabs: [tab("b", { pinned: true }), tab("a")], at: 1 }, { tabs: [], at: -1 }] });
});

test("a layout kept before tabs becomes a tab per pane, with the tabs a pane had around it", () => {
  const old = { split: true, at: "left", side: 0.4, focus: 1, panes: [{ note: "a", back: ["x"], forward: [] }, { note: "b", back: [], forward: ["y"] }] };
  assert.deepEqual(parseLayout(JSON.stringify(old)).groups, [
    { tabs: [{ note: "a", back: ["x"], forward: [] }], at: 0 },
    { tabs: [{ note: "b", back: [], forward: ["y"] }], at: 0 },
  ]);
  assert.deepEqual(parseLayout(JSON.stringify(old), [["c", "a", "d"], []]).groups[0], { tabs: [tab("c"), { note: "a", back: ["x"], forward: [] }, tab("d")], at: 1 });
  assert.deepEqual(parseLayout('{"split":true,"panes":[{"note":"a"},{}]}').split, false);
  assert.deepEqual(parseLayout('{"panes":[{"note":"page:/today","back":["a"]}]}').groups[0], { tabs: [{ note: "page:/today", back: ["a"], forward: [] }], at: 0 });
});
