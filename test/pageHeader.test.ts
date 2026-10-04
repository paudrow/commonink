// The one page header (web/src/pageHeader.ts): a page's name, its buttons at the right, and a line
// under them, built the same way on every page. Tags has its New tag button there.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageHeader } from "../web/src/pageHeader.ts";
import { el } from "../web/src/dom.ts";
import { TagsPage } from "../web/src/tagsPage.ts";

test("a header is the name, then the buttons, then the line under them", () => {
  const add = el("button", { type: "button" }, "New thing");
  const head = pageHeader({ title: "Things", sub: "Every thing.", actions: [null, add], class: "th-head" });
  assert.equal(head.className, "page-head th-head");
  assert.deepEqual([...head.children].map((c) => c.className), ["page-head-row", "page-sub"]);
  assert.deepEqual([...head.firstElementChild!.children].map((c) => c.tagName === "H1" ? c.textContent : c.className), ["Things", "page-actions"]);
  assert.deepEqual([...head.querySelector(".page-actions")!.children], [add]);
  assert.equal(head.querySelector(".page-sub")!.textContent, "Every thing.");
});

test("no buttons, no line: only the name", () => {
  const head = pageHeader({ title: "Things", actions: [false, null] });
  assert.equal(head.querySelector(".page-actions"), null);
  assert.equal(head.querySelector(".page-sub"), null);
  assert.equal(head.querySelector("h1")!.textContent, "Things");
});

test("a page's own h1 and its own line under it are used as they are", () => {
  const h1 = el("h1", {}, "Notes");
  const dates = el("div", { class: "cal-bar" }, "Oct 1 – 7");
  const head = pageHeader({ title: h1, sub: dates });
  assert.equal(head.querySelector("h1"), h1);
  assert.equal(dates.className, "cal-bar page-sub");
  assert.equal(dates.parentElement, head);
});

test("Tags has New tag in its header; it asks for a name and adds the tag", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const added: string[] = [];
  let viewer = false;
  const page = new TagsPage(root, { tags: () => [], refresh: async () => {}, openTag() {}, addTag: async (t) => void added.push(t), deleteTag: async () => {}, readOnly: () => viewer, toast() {} });
  page.show();
  const btn = root.querySelector<HTMLButtonElement>(".page-head .page-actions button")!;
  assert.deepEqual([btn.textContent, btn.hidden], ["New tag", false]);
  btn.click();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Tag"]')!;
  input.value = "work/clients";
  input.dispatchEvent(new window.Event("input"));
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Add tag")!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(added, ["work/clients"]);
  // A viewer can't add tags.
  viewer = true;
  page.show();
  assert.equal(btn.hidden, true);
});
