// The Notes page's tabs: Notes, Archive and Trash, each saying in one line what it holds, and a
// search that points to its matches in the other tabs.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

document.body.append(Object.assign(document.createElement("div"), { id: "notes-view" }));
const { NotesPage } = await import("../web/src/notesPage.ts");
const { TrashPage } = await import("../web/src/trash.ts");

const DAY = 86_400_000;
const trashed = (id: string, path: string, excerpt: string) => ({ id, path, kind: "md", size: 10, deletedAt: Date.now(), expiresAt: Date.now() + 30 * DAY, by: null, excerpt });
let feed = { items: [], total: 0, counts: { active: 3, archived: 2 }, folders: [] };
const TRASH = [trashed("t1", "Launch plan.md", "Dates for the launch"), trashed("t2", "Groceries.md", "Milk, eggs")];
globalThis.fetch = (async (url: string) =>
  new Response(JSON.stringify(url.startsWith("/api/trash") ? TRASH : feed), { headers: { "Content-Type": "application/json" } })) as typeof fetch;

let viewer = false;
const went: string[] = [];
const trash = new TrashPage({ toast() {}, changed: async () => {}, canPurge: () => true, open() {} });
const page = new NotesPage({
  open() {},
  starred: () => false,
  toggleStar() {},
  filtersChanged() {},
  tags: () => [],
  saveQuery() {},
  advanced() {},
  delete: async () => [],
  rename() {},
  starButton: () => document.createElement("span"),
  openPerson() {},
  readOnly: () => viewer,
  toast() {},
  changed() {},
  newNote() {},
  goTab: (tab) => (went.push(tab), page.show({ tab })),
  trash: () => (viewer ? null : trash),
});
const root = document.getElementById("notes-view")!;
const settle = () => new Promise((r) => setTimeout(r, 20));
const text = (sel: string) => root.querySelector<HTMLElement>(sel)!.textContent;
const tabs = () => [...root.querySelectorAll(".feed-scope button")].map((b) => `${b.textContent}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`);

test("the tabs are Notes, Archive and Trash, and Archive and Trash each say what they hold", async () => {
  page.show({ tab: "archive" });
  await settle();
  assert.deepEqual(tabs(), ["Notes", "Archive*", "Trash"]);
  assert.equal(text(".feed-about"), "Out of your way but kept. Links to them still work.");
  page.show({ tab: "trash" });
  await settle();
  assert.deepEqual([root.dataset.tab, text(".feed-about")], ["trash", "Deleted notes. Each is removed for good 30 days after you delete it."]);
  assert.deepEqual([...root.querySelectorAll(".tr-name")].map((n) => n.firstChild!.textContent), ["Launch plan", "Groceries"]);
  page.show({ tab: "notes" });
  await settle();
  assert.equal(root.querySelector<HTMLElement>(".feed-about")!.hidden, true);
});

test("a search names its matches in the other tabs, and a click goes there with the search kept", async () => {
  feed = { ...feed, counts: { active: 0, archived: 2 } };
  page.show({ tab: "notes", query: { q: "launch" } });
  await settle();
  assert.equal(text(".feed-elsewhere"), "Also 2 in Archive and 1 in Trash.");
  [...root.querySelectorAll<HTMLButtonElement>(".feed-elsewhere button")].find((b) => b.textContent === "1 in Trash")!.click();
  await settle();
  assert.deepEqual(went, ["trash"]);
  assert.deepEqual([...root.querySelectorAll(".tr-name")].map((n) => n.firstChild!.textContent), ["Launch plan"], "Trash keeps the search");
});

test("someone with no Trash (a viewer) sees no Trash tab, and asking for it shows Notes", async () => {
  viewer = true;
  page.show({ tab: "trash", query: {} });
  await settle();
  assert.deepEqual(tabs(), ["Notes*", "Archive"]);
  viewer = false;
});
