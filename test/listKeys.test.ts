// The keys every list page shares (listKeys.ts): one table the pages run and the shortcut sheet
// lists, checked here on the helper itself, on the sheet, and on the Assets and Tags pages.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoteMeta, TagCount } from "../web/src/api.ts";
import { listKey, listShortcuts, stepFocus, type ListAction } from "../web/src/listKeys.ts";
import { STATIC_SHORTCUTS } from "../web/src/commands.ts";

const W = window as unknown as typeof globalThis & Window;
document.body.append(Object.assign(document.createElement("div"), { id: "assets-view", tabIndex: -1 }), Object.assign(document.createElement("div"), { id: "tags-view", tabIndex: -1 }));
// jsdom has no CSS.escape; the pages use it to find a row again after a redraw.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s.replace(/["\\]/g, "\\$&") };
globalThis.fetch = (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch;
const { Assets } = await import("../web/src/assets.ts");
const { TagsPage } = await import("../web/src/tagsPage.ts");

/** Press a key on `target`; false if something took it (preventDefault). */
const key = (target: EventTarget, k: string, more: KeyboardEventInit = {}) => target.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
const focused = () => document.activeElement as HTMLElement;

test("each key runs its action, and a key the page has no action for is left alone", () => {
  const box = document.createElement("div");
  document.body.append(box);
  const ran: ListAction[] = [];
  const every: ListAction[] = ["next", "prev", "first", "last", "open", "select", "filter", "delete", "clear"];
  box.addEventListener("keydown", (e) => listKey(e, Object.fromEntries(every.map((a) => [a, () => ran.push(a)]))));
  for (const k of ["j", "ArrowDown", "k", "ArrowUp", "g", "G", "Enter", "x", "/", "Delete", "Backspace", "Escape"]) assert.equal(key(box, k), false, `${k} is taken`);
  assert.deepEqual(ran, ["next", "next", "prev", "prev", "first", "last", "open", "select", "filter", "delete", "delete", "clear"]);
  const bare = document.createElement("div");
  document.body.append(bare);
  bare.addEventListener("keydown", (e) => listKey(e, { next: () => ran.push("next") }));
  ran.length = 0;
  for (const k of ["x", "Delete", "Enter", "/", "q"]) assert.equal(key(bare, k), true, `${k} goes on to the browser`);
  assert.deepEqual(ran, []);
});

test("the keys stay out of the way while typing, with ⌘ or Ctrl held, and Enter on a button is the button's", () => {
  const box = document.createElement("div");
  const [input, button, select] = [document.createElement("input"), document.createElement("button"), document.createElement("select")];
  box.append(input, button, select);
  document.body.append(box);
  const ran: string[] = [];
  box.addEventListener("keydown", (e) => listKey(e, { next: () => ran.push("next"), open: () => ran.push("open"), delete: () => ran.push("delete") }));
  for (const k of ["j", "Enter", "Backspace"]) assert.equal(key(input, k), true);
  assert.equal(key(select, "ArrowDown"), true, "the arrows change a menu's choice");
  assert.equal(key(box, "j", { ctrlKey: true }), true);
  assert.equal(key(box, "j", { metaKey: true }), true);
  assert.equal(key(button, "Enter"), true, "Enter presses the button");
  assert.deepEqual(ran, []);
  key(button, "j");
  key(box, "Enter");
  assert.deepEqual(ran, ["next", "open"]);
});

test("the sheet lists the shared keys under every list page, History and Assets included", () => {
  const keysOf = (area: string) => STATIC_SHORTCUTS.filter((s) => s.area === area).map((s) => s.keys.join(" "));
  const shared = ["j k", "g G", "Enter", "x", "Delete Backspace", "/", "Escape"];
  assert.deepEqual(keysOf("Notes page").slice(0, 7), shared);
  assert.deepEqual(keysOf("Assets").slice(0, 7), shared);
  assert.deepEqual(keysOf("History").slice(0, 5), ["j k", "g G", "Enter", "x", "Escape"], "History deletes and filters nothing");
  assert.deepEqual(keysOf("Tags").slice(0, 5), ["j k", "g G", "Enter", "Delete Backspace", "/"], "Tags has no selection");
  assert.deepEqual(keysOf("Contacts").slice(0, 4), ["j k", "g G", "Enter", "/"]);
  assert.deepEqual(keysOf("Tasks").slice(0, 2), ["j k", "g G"]);
  const label = (area: string, keys: string) => STATIC_SHORTCUTS.find((s) => s.area === area && s.keys.join(" ") === keys)?.label;
  assert.deepEqual([label("Notes page", "Enter"), label("Notes page", "Space"), label("History", "Enter")], ["Open the note", "Expand the note's preview, or fold it again", "Open the note the change is in"]);
  assert.deepEqual(listShortcuts("row", ["next", "open"]), [{ keys: ["Enter"], label: "Open the row" }], "j and k are listed only with both ways to move");
});

test("stepFocus moves through focusable rows and stops at the ends", () => {
  const rows = [1, 2, 3].map(() => document.body.appendChild(document.createElement("button")));
  stepFocus(rows, 1);
  assert.equal(focused(), rows[0], "from outside the list: the first row");
  stepFocus(rows, 1);
  stepFocus(rows, 1);
  stepFocus(rows, 1);
  assert.equal(focused(), rows[2]);
  stepFocus(rows, "first");
  stepFocus(rows, -1);
  assert.equal(focused(), rows[0]);
  stepFocus(rows, "last");
  assert.equal(focused(), rows[2]);
});

test("Assets: j and k move through the files, x selects, Delete deletes the selection, / filters, Esc clears", async () => {
  const asset = (path: string): NoteMeta => ({ id: path, path, kind: "asset", title: path, version: "1", mtime: 0, size: 1 });
  let files = ["assets/a.png", "assets/b.png", "assets/c.png"].map(asset);
  const deleted: string[][] = [];
  const assets = new Assets({
    notes: () => files,
    upload: async () => [],
    open: () => {},
    archive: async () => {},
    delete: async (paths) => (deleted.push(paths), (files = files.filter((f) => !paths.includes(f.path))), paths),
    rename: async () => null,
    readOnly: () => false,
    embedName: (p) => p,
    tags: () => [],
    refreshTags: async () => {},
    toast: () => {},
  });
  const root = document.getElementById("assets-view")!;
  assets.show();
  const at = () => focused().closest<HTMLElement>(".as-card")?.dataset.path;
  const selected = () => [...root.querySelectorAll<HTMLElement>(".as-card.is-selected")].map((c) => c.dataset.path);
  key(root, "Delete");
  assert.deepEqual(deleted, [], "nothing in focus, nothing selected: nothing to delete");
  key(root, "j");
  const first = at();
  key(focused(), "x");
  key(focused(), "j");
  key(focused(), "x");
  assert.equal(selected().length, 2);
  assert.notEqual(at(), first, "j went on to the next file, and the redraw kept the keyboard there");
  key(focused(), "k");
  assert.equal(at(), first);
  key(focused(), "Escape");
  assert.deepEqual(selected(), []);
  key(focused(), "G");
  key(focused(), "x");
  const last = at()!;
  key(focused(), "g");
  key(focused(), "Delete");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, [[last]], "the selection, not the file in focus");
  key(focused(), "/");
  assert.equal(focused(), root.querySelector(".as-search input"));
  assert.equal(key(focused(), "x"), true, "typing in the search is typing");
  assert.deepEqual(selected(), []);
});

test("Tags: from the filter ↓ goes to the tags, j and k move, / goes back, and Delete takes away only a tag nothing carries", () => {
  const tag = (name: string, notes: number): TagCount => ({ tag: name, display: name, notes, tasks: 0, assets: 0 });
  const went: string[] = [];
  const root = document.getElementById("tags-view")!;
  const page = new TagsPage(root, { tags: () => [tag("recipe", 2), tag("someday", 0), tag("work", 1)], refresh: async () => {}, openTag: () => {}, deleteTag: async (t) => void went.push(t.tag), readOnly: () => false, toast: () => {} });
  page.show();
  const input = root.querySelector("input")!;
  const at = () => focused().closest(".tags-row")?.getAttribute("data-tag");
  assert.equal(focused(), input);
  key(input, "j");
  assert.equal(focused(), input, "j in the filter is a letter");
  key(input, "ArrowDown");
  assert.equal(at(), "recipe");
  key(focused(), "Delete");
  assert.deepEqual(went, [], "a tag in use isn't deleted from the keyboard");
  key(focused(), "j");
  assert.equal(at(), "someday");
  key(focused(), "Delete");
  assert.deepEqual(went, ["someday"]);
  key(focused(), "G");
  assert.equal(at(), "work");
  key(focused(), "k");
  key(focused(), "g");
  assert.equal(at(), "recipe");
  key(focused(), "/");
  assert.equal(focused(), input);
});
