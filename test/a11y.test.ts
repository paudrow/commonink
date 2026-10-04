// What screen readers get from the app's controls: names for icon-only buttons, and toggle and
// current-page state that follows what's shown.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { el, icon, setCurrent, setLabel, setPressed } = await import("../web/src/dom.ts");

test("every button in the app shell has a name a screen reader can say", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const unnamed = [...doc.querySelectorAll("button")].filter((b) => !b.textContent?.trim() && !b.getAttribute("aria-label")).map((b) => b.id || b.outerHTML);
  assert.deepEqual(unnamed, []);
});

test("every top-level page has a sidebar entry, named as the page is", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const names = [...doc.querySelectorAll("#sidebar > .nav-item")].map((b) => b.querySelector("span:not(.ico)")?.textContent);
  assert.deepEqual(names, ["Today", "Notes", "Tasks", "Contacts", "Calendar", "Assets", "History", "Tags", "Archive", "Trash", "Shared with me"]);
});

test("an icon-only button is named by its tooltip; a button with words keeps them as its name", () => {
  assert.equal(el("button", { title: "Archive (e)" }, icon("archive")).getAttribute("aria-label"), "Archive (e)");
  assert.equal(el("button", { title: "Archive (e)", "aria-label": "Archive" }, icon("archive")).getAttribute("aria-label"), "Archive");
  assert.equal(el("button", { title: "Keep these filters" }, icon("folderSearch"), "Save").getAttribute("aria-label"), null);
});

test("renaming a button changes its tooltip and its name together", () => {
  const b = el("button", { title: "Star" }, icon("star"));
  setLabel(b, "Unstar");
  assert.deepEqual([b.title, b.getAttribute("aria-label")], ["Unstar", "Unstar"]);
});

test("a toggle is pressed for screen readers exactly when it shows as on", () => {
  const b = el("button", {}, "vim");
  setPressed(b, true);
  assert.deepEqual([b.className, b.getAttribute("aria-pressed")], ["is-on", "true"]);
  setPressed(b, false);
  assert.deepEqual([b.className, b.getAttribute("aria-pressed")], ["", "false"]);
});

test("the sidebar entry for what's shown is the current page, and only while it is", () => {
  const b = el("button", { class: "nav-item" }, "Tasks");
  setCurrent(b, true);
  assert.deepEqual([b.className, b.getAttribute("aria-current")], ["nav-item is-active", "page"]);
  setCurrent(b, false);
  assert.deepEqual([b.className, b.getAttribute("aria-current")], ["nav-item", null]);
});
