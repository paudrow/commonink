// The one filter row (web/src/filterRow.ts): a "Filter <things>…" box with a / hint, / to reach it,
// the sort at its right, and a segmented control for a short pick-one set. Tags and Tasks use it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterBox, NOTE_SORTS, pageKey, segmented, slashToFilter, sortSelect, SORT_NAMES } from "../web/src/filterRow.ts";
import { el } from "../web/src/dom.ts";
import { TagsPage } from "../web/src/tagsPage.ts";
import type { Task } from "../web/src/api.ts";

const press = (at: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  at.dispatchEvent(e);
  return e;
};

test("the box says what it filters, then the page's tools, then the / hint", () => {
  const sort = sortSelect([["newest", SORT_NAMES.newest], ["name", SORT_NAMES.name]], "name", () => {});
  const { root, input } = filterBox("things", { class: "th-search", tools: [null, sort] });
  assert.equal(root.className, "feed-search th-search");
  assert.deepEqual([input.placeholder, input.getAttribute("aria-label")], ["Filter things…", "Filter things"]);
  assert.deepEqual([...root.children].map((c) => c.tagName), ["svg", "INPUT", "SELECT", "KBD"]);
  assert.equal(root.querySelector("kbd")!.textContent, "/");
});

test("a page's own input keeps what it had", () => {
  const mine = el("input", { role: "combobox" });
  const { input } = filterBox("assets", { input: mine });
  assert.equal(input, mine);
  assert.deepEqual([mine.getAttribute("role"), mine.placeholder], ["combobox", "Filter assets…"]);
});

test("the sort is one menu with the shared names, and says what was picked", () => {
  const picked: string[] = [];
  const sort = sortSelect([["newest", SORT_NAMES.newest], ["oldest", SORT_NAMES.oldest], ["name", SORT_NAMES.name]], "oldest", (v) => picked.push(v));
  assert.deepEqual([sort.className, sort.getAttribute("aria-label"), sort.value], ["qt-select feed-sort", "Sort", "oldest"]);
  assert.deepEqual([...sort.options].map((o) => o.textContent), ["Newest", "Oldest", "Name"]);
  sort.value = "name";
  sort.dispatchEvent(new window.Event("change"));
  assert.deepEqual(picked, ["name"]);
  // A list of notes calls the same orders the same things.
  assert.deepEqual(NOTE_SORTS.map(([, label]) => label), ["Recently changed", "Recently created", "Newest", "Oldest", "Name"]);
});

test("a segmented control has one choice on, and picking another says so", () => {
  const picked: string[] = [];
  const seg = segmented({ label: "Whose", class: "th-whose", current: "", options: [{ value: "", label: "Everyone" }, { value: "people", label: "People", icon: "user" }], onPick: (v) => picked.push(v) });
  assert.deepEqual([seg.className, seg.getAttribute("role"), seg.getAttribute("aria-label")], ["seg th-whose", "group", "Whose"]);
  const [everyone, people] = [...seg.querySelectorAll("button")];
  assert.deepEqual([everyone.getAttribute("aria-pressed"), people.getAttribute("aria-pressed")], ["true", "false"]);
  assert.ok(people.querySelector("svg"));
  everyone.click(); // already on
  people.click();
  assert.deepEqual(picked, ["people"]);
});

test("/ goes to the filter from the page, but not from a field, another page or a hidden one", () => {
  const root = el("div", { tabindex: "-1" });
  const { root: box, input } = filterBox("things");
  const other = el("input", {});
  const row = el("button", { type: "button" }, "A row");
  const elsewhere = el("button", { type: "button" }, "In a dialog");
  root.append(box, other, row);
  document.body.append(root, elsewhere);
  slashToFilter(root, input);

  elsewhere.focus();
  assert.equal(press(elsewhere, "/").defaultPrevented, false);
  assert.equal(press(other, "/").defaultPrevented, false, "typing a / in a field types it");
  assert.equal(press(row, "/", { ctrlKey: true }).defaultPrevented, false);
  assert.notEqual(document.activeElement, input);

  assert.equal(press(row, "/").defaultPrevented, true);
  assert.equal(document.activeElement, input);

  input.blur();
  assert.equal(press(document.body, "/").defaultPrevented, true, "nothing in focus: still the page's filter");
  assert.equal(document.activeElement, input);

  input.blur();
  root.hidden = true;
  assert.equal(press(document.body, "/").defaultPrevented, false);
  root.remove();
  elsewhere.remove();
});

test("Tags opens with its list in focus, and / goes to its filter box", () => {
  const root = el("div", { tabindex: "-1" });
  document.body.append(root);
  const page = new TagsPage(root, { tags: () => [{ tag: "work", display: "work", notes: 2, tasks: 0, assets: 0 }], refresh: async () => {}, openTag() {}, addTag: async () => {}, deleteTag: async () => {}, readOnly: () => false, toast() {} });
  page.show();
  const input = root.querySelector<HTMLInputElement>(".feed-search input")!;
  assert.equal(input.placeholder, "Filter tags…");
  assert.equal(root.querySelector(".feed-search kbd")!.textContent, "/");
  assert.equal(document.activeElement, root, "the box isn't focused on arrival (a phone would raise its keyboard)");
  press(root, "/");
  assert.equal(document.activeElement, input);
  root.remove();
});

test("a page key stops when the page says so", () => {
  const root = el("div", { tabindex: "-1" });
  document.body.append(root);
  let ran = 0;
  const stop = pageKey(root, "n", () => (ran++, true));
  assert.equal(press(root, "n").defaultPrevented, true);
  stop();
  assert.equal(press(root, "n").defaultPrevented, false);
  assert.equal(ran, 1);
  root.remove();
});

test("Tasks: the filter box sits under the quick-add bar, / goes to it, n goes to the bar, and typing narrows the list", async () => {
  const task = (line: number, text: string, title: string): Task => ({ path: `${title}.md`, title, line, text, summary: text, done: false, heading: null, meta: { due: null, start: null, done: null, rec: null, until: null, times: null, priority: null, assignees: [], tags: [] } });
  const tasks = [task(3, "Book the venue", "Offsite"), task(4, "Send the invites", "Offsite"), task(7, "Pay rent", "Home")];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => new Response(JSON.stringify(/\/tasks\b/.test(String(url)) ? tasks : {}), { headers: { "content-type": "application/json" } })) as typeof fetch;
  const { renderTasksPage } = await import("../web/src/tasksView.ts");
  const root = el("div", { tabindex: "-1" });
  document.body.append(root);
  const leave = renderTasksPage(root, { open() {}, tags: () => [], me: "Tasks with @me" });
  root.focus();
  const rows = async () => {
    await new Promise((r) => setTimeout(r, 20));
    return root.querySelectorAll(".qt-list .qt-row").length;
  };
  try {
    const input = root.querySelector<HTMLInputElement>(".tasks-search input")!;
    assert.equal(input.placeholder, "Filter tasks…");
    const page = root.querySelector(".page")!;
    assert.deepEqual([...page.children].slice(1, 3).map((c) => c.className), ["qa", "feed-search tasks-search"], "the quick-add bar, then the filter box");
    assert.equal(await rows(), 3);
    assert.equal(press(root, "/").defaultPrevented, true);
    assert.equal(document.activeElement, input);
    input.value = "offsite VENUE";
    input.dispatchEvent(new window.Event("input"));
    assert.equal(await rows(), 1, "every word, in the task or its note's title");
    input.value = "nothing like it";
    input.dispatchEvent(new window.Event("input"));
    assert.equal(await rows(), 0);
    assert.equal(root.querySelector(".qt-empty")?.textContent, "No tasks match.");
    assert.equal(press(input, "n").defaultPrevented, false, "n in the filter box is a letter");
    root.focus();
    assert.equal(press(root, "n").defaultPrevented, true);
    assert.ok(root.querySelector(".qa")!.contains(document.activeElement), "n puts the cursor in the quick-add bar");
  } finally {
    leave();
    globalThis.fetch = fetchBefore;
  }
  root.focus();
  assert.equal(press(root, "/").defaultPrevented, false, "gone with the page");
  root.remove();
});
