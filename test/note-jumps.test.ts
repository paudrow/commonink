// Moving between notes: each pane's back and forward (pages only when you went to them), the browser's
// back and forward, and where you were in each note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyStep, pageEntry, pageOf, rememberPlace, step, visit } from "../web/src/panes.ts";
import { learnLayout, matchKeys } from "../web/src/keys.ts";

test("a page is in a pane's trail only when you went to it; back from a linked note is the note that linked it", () => {
  // Notes (clicked) → A → link to B → link to C.
  let p = { note: null as string | null, back: [] as string[], forward: [] as string[] };
  p = visit(p, pageEntry("/notes"));
  for (const id of ["aaaaaaaa", "bbbbbbbb", "cccccccc"]) p = visit(p, id);
  assert.deepEqual(p.back, ["page:/notes", "aaaaaaaa", "bbbbbbbb"]);
  p = step(p, "back")!;
  assert.equal(p.note, "bbbbbbbb", "back from C is B, which linked to it");
  p = step(step(p, "back")!, "back")!;
  assert.equal(pageOf(p.note!), "/notes", "and back from A is Notes, because you went there");
  assert.equal(pageOf("bbbbbbbb"), null);
  assert.equal(pageOf(pageEntry("/history?note=abcd1234")), "/history?note=abcd1234");
});

test("a browser back or forward is a step in the focused pane, as many as the browser moved", () => {
  assert.deepEqual(historyStep(5, 4), { dir: "back", steps: 1 });
  assert.deepEqual(historyStep(5, 7), { dir: "forward", steps: 2 });
  assert.equal(historyStep(5, 5), null);
  assert.equal(historyStep(5, undefined), null, "an entry from before (or outside) the app: show what its address says");
});

test("where you were in each note is kept for the latest notes, newest last", () => {
  let places = {};
  for (let i = 0; i < 5; i++) places = rememberPlace(places, `n${i}`, { pos: i, top: i * 10, off: 0 }, 3);
  assert.deepEqual(Object.keys(places), ["n2", "n3", "n4"]);
  places = rememberPlace(places, "n2", { pos: 9, top: 90, off: 4 }, 3);
  assert.deepEqual(Object.entries(places), [["n3", { pos: 3, top: 30, off: 0 }], ["n4", { pos: 4, top: 40, off: 0 }], ["n2", { pos: 9, top: 90, off: 4 }]]);
});

test("back and forward keys by the character typed: ⌘[ and ⌘] (Ctrl off a Mac), on US and Dvorak", async () => {
  const key = (key: string, code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  await learnLayout({ getLayoutMap: async () => new Map([["Minus", "["], ["Equal", "]"], ["BracketLeft", "/"], ["BracketRight", "="]]) });
  assert.equal(matchKeys(key("[", "Minus", { metaKey: true }), "Mod-[", true), true, "Dvorak's [ is the physical - key");
  assert.equal(matchKeys(key("/", "BracketLeft", { metaKey: true }), "Mod-[", true), false, "and its physical [ key types /");
  assert.equal(matchKeys(key("]", "Equal", { metaKey: true }), "Mod-]", true), true);
  assert.equal(matchKeys(key("[", "BracketLeft", { ctrlKey: true }), "Mod-[", false), true, "Windows: Ctrl+[");
  assert.equal(matchKeys(key("[", "Minus", { metaKey: true, shiftKey: true }), "Mod-[", true), false, "⌘⇧[ isn't back");
  await learnLayout(undefined);
});
