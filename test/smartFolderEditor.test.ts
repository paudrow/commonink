// The smart folder dialog: words, folders and tags as rows (all or any), folders picked from a list, and
// the query text, always shown, kept in step with the controls.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 }); // the pickers place themselves in the window

const feeds: string[] = [];
globalThis.fetch = (async (url: string) => {
  feeds.push(decodeURIComponent(String(url)));
  const page = { items: [{ id: "a", path: "Health/Run log.md", kind: "md", title: "Run log", mtime: 0, archived: false, excerpt: "", tags: [], lines: [], lastSource: null, lastBy: null, role: null }], total: 3, counts: { active: 3, archived: 0 }, folders: [] };
  return new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { smartFolderEditor } = await import("../web/src/smartFolderEditor.ts");
const sources = {
  tags: () => [
    { tag: "health", display: "health", notes: 3, tasks: 0, assets: 0 },
    { tag: "journal", display: "journal", notes: 2, tasks: 0, assets: 0 },
  ],
  folders: () => ["Areas", "Areas/Health and Fitness"],
};
const settle = () => new Promise((r) => setTimeout(r, 260));
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.includes(text))!;
const pickItem = (text: string) => byText(".folder-picker .fp-item", text).click();

test("tags are rows joined by and/or, the folder is picked, and the query shows as text", async () => {
  let saved: { name: string; query: string } | null = null;
  const anchor = document.body.appendChild(document.createElement("button"));
  smartFolderEditor(anchor, { name: "", query: "", shared: true }, { canShare: true, sources, save: async (f) => void (saved = f) });
  assert.ok($(".sf-modal .sf-dialog"), "opens as a dialog in the middle");
  assert.equal($(".sf-tags").querySelectorAll(".sf-item").length, 1);
  assert.equal($(".sf-tags select"), null, "no all/any choice with one tag");

  byText(".sf-tags .sf-item .sf-pick", "Any tag").click();
  pickItem("#health");
  byText(".sf-add", "Add a tag").click(); // opens the picker for the new row
  pickItem("#journal");
  assert.deepEqual([...document.querySelectorAll(".sf-tags .sf-item .sf-pick")].map((b) => b.textContent), ["health", "journal"]);
  assert.equal(byText(".sf-item", "journal").querySelector(".sf-join")!.textContent, "and");

  const match = $<HTMLSelectElement>(".sf-tags select");
  match.value = "any";
  match.dispatchEvent(new window.Event("change"));
  assert.equal(byText(".sf-item", "journal").querySelector(".sf-join")!.textContent, "or");

  byText(".sf-folders .sf-pick", "Any folder").click();
  assert.ok(!byText(".folder-picker .fp-list", "New folder"), "a filter only picks folders that exist");
  pickItem("Health and Fitness");
  assert.deepEqual([...document.querySelectorAll(".sf-crumb")].map((c) => c.textContent), ["Areas", "Health and Fitness"]);

  const query = $<HTMLInputElement>(".sf-query");
  assert.equal(query.closest("details"), null, "the query is always in view, not folded away");
  assert.equal(query.value, 'folder="Areas/Health and Fitness" tag="health,journal" match=any');
  await settle();
  assert.match(feeds.at(-1)!, /tag=health,journal&match=any/);
  assert.equal($(".sf-count").textContent, "3 notes match");
  assert.match($(".sf-preview").textContent!, /Run log.*Health.*and 2 more/);

  // Typing a query fills the controls from it.
  query.value = "tag=journal sort=date";
  query.dispatchEvent(new window.Event("input"));
  assert.deepEqual([...document.querySelectorAll(".sf-tags .sf-item .sf-pick")].map((b) => b.textContent), ["journal"]);
  assert.equal(byText(".sf-folders .sf-pick", "Any folder").textContent, "Any folder");

  $<HTMLInputElement>(".sf-name").value = "Journal";
  $<HTMLFormElement>(".sf-dialog").requestSubmit();
  await settle();
  assert.deepEqual(saved, { id: undefined, name: "Journal", query: "tag=journal sort=date", shared: true });
  assert.equal(document.querySelector(".sf-modal"), null, "saving closes it");
});

test("a smart folder without a name isn't saved, and Escape closes the dialog", async () => {
  let saves = 0;
  smartFolderEditor(document.body, { name: "", query: "tag=health", shared: true }, { canShare: true, sources, save: async () => void saves++ });
  $<HTMLFormElement>(".sf-dialog").requestSubmit();
  assert.equal(saves, 0);
  assert.equal($(".sf-pop-error").textContent, "Give the smart folder a name");
  $(".sf-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector(".sf-modal"), null);
});

test("words and folders are rows too: words match all or any, folders any of them", async () => {
  let saved: { query: string } | null = null;
  smartFolderEditor(document.body, { name: "Mixed", query: "", shared: false }, { canShare: true, sources, save: async (f) => void (saved = f) });
  const words = () => [...document.querySelectorAll<HTMLInputElement>(".sf-words .sf-word")];
  const type = (input: HTMLInputElement, value: string) => ((input.value = value), input.dispatchEvent(new window.Event("input")));
  type(words()[0], "budget");
  byText(".sf-add", "Add a word").click();
  type(words()[1], "weekly review");
  assert.equal($<HTMLInputElement>(".sf-query").value, "q=\"budget 'weekly review'\"");
  const match = $<HTMLSelectElement>(".sf-words select");
  match.value = "any";
  match.dispatchEvent(new window.Event("change"));
  assert.equal($<HTMLInputElement>(".sf-query").value, "q=\"budget OR 'weekly review'\"");

  byText(".sf-folders .sf-pick", "Any folder").click();
  pickItem("Health and Fitness");
  byText(".sf-add", "Add a folder").click();
  pickItem("Areas");
  assert.equal(document.querySelectorAll(".sf-folders .sf-item")[1].querySelector(".sf-join")!.textContent, "or");
  assert.match($<HTMLInputElement>(".sf-query").value, /folder="Areas\/Health and Fitness\|Areas"/);

  // A query rows can't say keeps its words as text.
  const query = $<HTMLInputElement>(".sf-query");
  query.value = "q=\"plan -draft\"";
  query.dispatchEvent(new window.Event("input"));
  assert.equal(words().length, 1);
  assert.equal(words()[0].value, "plan -draft");
  assert.ok(byText(".sf-words", "query syntax"));
  $<HTMLFormElement>(".sf-dialog").requestSubmit();
  await settle();
  assert.equal(saved!.query, 'q="plan -draft"');
});

test("sharing with the workspace is a box, off unless the folder is shared; Favorites aren't asked", async () => {
  let saved: { shared: boolean } | null = null;
  smartFolderEditor(document.body, { name: "Work", query: "tag=health", shared: false }, { canShare: true, sources, save: async (f) => void (saved = f) });
  const box = byText(".sf-just-me", "Share with workspace").querySelector("input")!;
  assert.equal(box.checked, false);
  assert.equal(byText(".sf-just-me", "In Favorites"), undefined);
  box.checked = true;
  $<HTMLFormElement>(".sf-dialog").requestSubmit();
  await settle();
  assert.equal(saved!.shared, true);
  smartFolderEditor(document.body, { name: "Work", query: "", shared: true }, { canShare: false, sources, save: async () => {} });
  const viewer = byText(".sf-just-me", "Share with workspace").querySelector("input")!;
  assert.equal(viewer.checked, false);
  assert.equal(viewer.disabled, true);
  $(".sf-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
