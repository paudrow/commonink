// What Notes shows when there's nothing to list: a way in, not a dead end.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

document.body.append(Object.assign(document.createElement("div"), { id: "notes-view" }));
const { NotesPage } = await import("../web/src/notesPage.ts");

const EMPTY = { items: [], total: 0, counts: { active: 0, archived: 0 }, folders: [] };
const requests: string[] = [];
globalThis.fetch = (async (url: string) => {
  requests.push(url);
  return new Response(JSON.stringify(EMPTY), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

let created = 0;
const page = new NotesPage({
  open() {},
  starred: () => false,
  toggleStar() {},
  filtersChanged() {},
  tags: () => [],
  saveQuery() {},
  starButton: () => document.createElement("span"),
  openPerson() {},
  readOnly: () => false,
  toast() {},
  changed() {},
  newNote: () => created++,
});
const root = document.getElementById("notes-view")!;
const settle = () => new Promise((r) => setTimeout(r, 20));
const shown = (sel: string) => !root.querySelector<HTMLElement>(sel)!.hidden;
const button = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label)!;

test("an empty vault offers a new note and hides the filters and keys it can't use", async () => {
  page.show();
  await settle();
  assert.equal(root.querySelector(".empty-state b")!.textContent, "No notes yet");
  assert.deepEqual([shown(".feed-search"), shown(".feed-filters"), shown(".feed-keys")], [false, false, false]);
  button("New note").click();
  assert.equal(created, 1);
});

test("a filter with no matches says so and clears in one click", async () => {
  page.show({ query: { q: "zebra", folder: "Projects" } });
  await settle();
  assert.equal(root.querySelector(".empty-state b")!.textContent, "No active notes in Projects match “zebra”");
  assert.equal(shown(".feed-search"), true);
  requests.length = 0;
  button("Clear filters").click();
  await settle();
  assert.deepEqual(requests, ["/api/feed?scope=active&limit=40"]);
  assert.equal(root.querySelector(".empty-state b")!.textContent, "No notes yet");
});

test("Archived with nothing in it explains archiving and goes back to active notes", async () => {
  page.show({ scope: "archived" });
  await settle();
  assert.equal(root.querySelector(".empty-state b")!.textContent, "Nothing archived");
  button("Show active notes").click();
  await settle();
  assert.equal(page.scope, "active");
  assert.equal(root.querySelector(".empty-state b")!.textContent, "No notes yet");
});
