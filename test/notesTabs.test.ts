// The Notes page's tabs: Notes, Archive and Trash, each saying in one line what it holds, and a
// search that points to its matches in the other tabs. Trash lists the same cards, with the same
// filters, keys and bulk bar, and Restore and Delete forever for its actions.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

document.body.append(Object.assign(document.createElement("div"), { id: "notes-view" }));
const { NotesPage } = await import("../web/src/notesPage.ts");
const { Trash, filterTrash, trashFolders, trashTags } = await import("../web/src/trash.ts");

const DAY = 86_400_000;
const trashed = (id: string, path: string, excerpt: string, o: { title?: string; tags?: string[]; ago?: number } = {}) => ({
  id,
  path,
  kind: "md" as const,
  title: o.title ?? path.split("/").pop()!.replace(/\.md$/, ""),
  tags: o.tags ?? [],
  size: 10,
  deletedAt: Date.now() - (o.ago ?? 0) * DAY,
  expiresAt: Date.now() + (30 - (o.ago ?? 0)) * DAY,
  by: null,
  excerpt,
});
let feed = { items: [], total: 0, counts: { active: 3, archived: 2 }, folders: [] };
let TRASH = [trashed("t1", "Launch plan.md", "Dates for the **launch**"), trashed("t2", "Groceries.md", "Milk, eggs")];
const posts: Array<[string, unknown]> = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  let body: unknown = url.startsWith("/api/trash") ? TRASH : feed;
  if (init?.method === "POST") {
    const sent = JSON.parse(String(init.body));
    posts.push([url, sent]);
    if (url === "/api/trash/restore") body = { restored: TRASH.filter((t) => sent.ids.includes(t.id)).map((t) => t.path) };
    else body = { deleted: sent.ids ?? [] };
    TRASH = TRASH.filter((t) => !sent.ids || !sent.ids.includes(t.id));
  }
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

let viewer = false;
let owner = true;
const went: string[] = [];
const made: string[] = [];
const toasts: string[] = [];
const trash = new Trash({ toast: (t) => toasts.push(t.text), changed: async () => {}, canPurge: () => owner, open() {} });
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
  newNote: (folder) => void made.push(folder),
  goTab: (tab) => (went.push(tab), page.show({ tab })),
  trash: () => (viewer ? null : trash),
});
const root = document.getElementById("notes-view")!;
const settle = () => new Promise((r) => setTimeout(r, 20));
const text = (sel: string) => root.querySelector<HTMLElement>(sel)!.textContent;
const tabs = () => [...root.querySelectorAll(".feed-scope button")].map((b) => `${b.textContent}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`);
const titles = () => [...root.querySelectorAll(".feed-card .fc-title")].map((n) => n.textContent);
const press = (key: string) => root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const button = (label: string, within: ParentNode = root) => [...within.querySelectorAll("button")].find((b) => b.textContent === label || b.title === label)!;

test("New note sits in the page's header, on the Notes tab only", async () => {
  page.show({ tab: "notes" });
  await settle();
  const btn = root.querySelector<HTMLButtonElement>(".feed > .page-head .page-actions button")!;
  assert.deepEqual([root.querySelector(".page-head h1")!.textContent, btn.textContent, btn.hidden], ["Notes", "New note", false]);
  btn.click();
  assert.deepEqual(made, [""]);
  for (const tab of ["archive", "trash"] as const) {
    page.show({ tab });
    await settle();
    assert.equal(btn.hidden, true, tab);
  }
  page.show({ tab: "notes" });
  await settle();
  assert.equal(btn.hidden, false);
});

test("the tabs are Notes, Archive and Trash, each says what it holds, and the search stays on each", async () => {
  page.show({ tab: "archive" });
  await settle();
  assert.deepEqual(tabs(), ["Notes", "Archive*", "Trash"]);
  assert.equal(text(".feed-about"), "Out of your way but kept. Links to them still work.");
  page.show({ tab: "trash" });
  await settle();
  assert.deepEqual([root.dataset.tab, text(".feed-about")], ["trash", "Deleted notes. Each is removed for good 30 days after you delete it."]);
  assert.deepEqual(titles(), ["Launch plan", "Groceries"]);
  page.show({ tab: "notes" });
  await settle();
  assert.equal(text(".feed-about"), "Notes you're working on. Archive one you're done with, or delete one you don't need.");
});

test("a search names its matches in the other tabs, and a click goes there with the search kept", async () => {
  feed = { ...feed, counts: { active: 0, archived: 2 } };
  page.show({ tab: "notes", query: { q: "launch" } });
  await settle();
  assert.equal(text(".feed-elsewhere"), "Also 2 in Archive and 1 in Trash.");
  [...root.querySelectorAll<HTMLButtonElement>(".feed-elsewhere button")].find((b) => b.textContent === "1 in Trash")!.click();
  await settle();
  assert.deepEqual(went, ["trash"]);
  assert.deepEqual(titles(), ["Launch plan"], "Trash keeps the search");
  assert.equal(text(".feed-elsewhere"), "Also 2 in Archive.", "and points back to the notes it finds");
});

test("Trash shows cards like Notes: the title, rendered text, the sort and filters, and its own keys", async () => {
  TRASH = [trashed("t1", "Projects/Launch plan.md", "Dates for the **launch**", { title: "The launch", tags: ["Work/Acme"] }), trashed("t2", "Groceries.md", "Milk, eggs", { ago: 2 })];
  page.show({ tab: "trash", query: {} });
  await settle();
  const card = root.querySelector(".feed-card")!;
  assert.deepEqual([card.querySelector(".fc-title")!.textContent, card.querySelector(".fc-body strong")?.textContent], ["The launch", "launch"], "the title, and markdown rendered, not raw");
  assert.deepEqual([...card.querySelectorAll(".fc-action")].map((b) => (b as HTMLElement).title), ["Restore (r)", "Delete forever (⌫)"]);
  const folderSel = root.querySelector<HTMLSelectElement>(".feed-folder")!;
  assert.deepEqual([...folderSel.options].map((o) => o.textContent), ["All folders", "Projects"]);
  assert.deepEqual([...root.querySelectorAll<HTMLOptionElement>(".feed-sort option")].map((o) => o.textContent), ["Recently deleted", "Deleted longest ago", "By title"]);
  assert.deepEqual([...root.querySelectorAll(".feed-keys kbd")].map((k) => k.textContent), ["j k", "r", "⌫", "x", "/"]);
  assert.equal(button("Empty trash").hidden, false);
  folderSel.value = "Projects";
  folderSel.dispatchEvent(new document.defaultView!.Event("change"));
  await settle();
  assert.deepEqual(titles(), ["The launch"]);
  page.show({ query: { sort: "oldest" } });
  await settle();
  assert.deepEqual(titles(), ["Groceries", "The launch"]);
});

test("in Trash, x selects and the bulk bar restores; r restores the focused card", async () => {
  TRASH = [trashed("t1", "A.md", "a"), trashed("t2", "B.md", "b", { ago: 1 }), trashed("t3", "C.md", "c", { ago: 2 })];
  page.show({ tab: "trash", query: {} });
  await settle();
  press("g");
  press("x");
  press("j");
  press("x");
  const bulk = root.querySelector<HTMLElement>(".feed-bulk")!;
  assert.deepEqual([bulk.hidden, bulk.firstChild!.textContent], [false, "2 selected"]);
  posts.length = 0;
  button("Restore", bulk).click();
  await settle();
  assert.deepEqual(posts, [["/api/trash/restore", { ids: ["t1", "t2"] }]]);
  assert.deepEqual([titles(), bulk.hidden, toasts.at(-1)], [["C"], true, "Restored 2 items"]);
  press("r");
  await settle();
  assert.deepEqual([titles(), toasts.at(-1)], [[], "Restored C"]);
  assert.equal(root.querySelector(".empty-state b")!.textContent, "Trash is empty");
  assert.equal(root.querySelector<HTMLElement>(".feed-search")!.hidden, false, "an empty Trash keeps the search where Notes has it");
});

test("Delete forever asks first, and only whoever may delete for good gets it", async () => {
  TRASH = [trashed("t1", "A.md", "a")];
  page.show({ tab: "trash", query: {} });
  await settle();
  posts.length = 0;
  press("Delete");
  await settle();
  button("Delete forever", document.querySelector(".ask")!).click();
  await settle();
  assert.deepEqual([posts, titles()], [[["/api/trash/delete", { ids: ["t1"] }]], []]);
  owner = false;
  TRASH = [trashed("t1", "A.md", "a")];
  page.show({ tab: "trash", query: {} });
  await settle();
  assert.deepEqual([...root.querySelectorAll<HTMLElement>(".feed-card .fc-action")].map((b) => b.title), ["Restore (r)"]);
  assert.equal(button("Empty trash").hidden, true);
  press("Delete");
  await settle();
  assert.equal(document.querySelector(".ask"), null);
  owner = true;
});

test("Trash filters by words, folder, tag (and tags under it) and sorts by when things were deleted", () => {
  const items = [
    trashed("a", "Archive/Work/Plan.md", "the plan", { title: "Plan", tags: ["Work/Acme"], ago: 1 }),
    trashed("b", "Work/Retro.md", "went well", { title: "Retro", tags: ["work"], ago: 3 }),
    trashed("c", "Home.md", "milk", { title: "Apples", ago: 2 }),
  ];
  const ids = (q: Parameters<typeof filterTrash>[1]) => filterTrash(items, q).map((t) => t.id);
  assert.deepEqual(ids({}), ["a", "c", "b"]);
  assert.deepEqual(ids({ sort: "oldest" }), ["b", "c", "a"]);
  assert.deepEqual(ids({ sort: "title" }), ["c", "a", "b"]);
  assert.deepEqual(ids({ folder: "Work" }), ["a", "b"], "an archived note's folder is the one it was archived from");
  assert.deepEqual(ids({ tag: "work" }), ["a", "b"]);
  assert.deepEqual(ids({ tag: "work/acme" }), ["a"]);
  assert.deepEqual(ids({ tag: "work/*" }), ["a"], "a * is a wildcard here too");
  assert.deepEqual(ids({ folder: "W*" }), ["a", "b"]);
  assert.deepEqual(ids({ q: "acme" }), ["a"], "words find tags too");
  assert.deepEqual(trashFolders(items), ["Work"]);
  assert.deepEqual(
    trashTags(items).map((t) => [t.tag, t.notes]),
    [["work", 2], ["work/acme", 1]],
  );
});

test("someone with no Trash (a viewer) sees no Trash tab, and asking for it shows Notes", async () => {
  viewer = true;
  page.show({ tab: "trash", query: {} });
  await settle();
  assert.deepEqual(tabs(), ["Notes*", "Archive"]);
  viewer = false;
});
