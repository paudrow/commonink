import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
// A phone, until a test says it's a computer.
let touch = true;
(globalThis as any).matchMedia = () => ({ get matches() { return touch; }, addEventListener() {} });
const { closeDrawer, renderMore, setupMobileNav } = await import("../web/src/mobileNav.ts");
setupMobileNav();

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const key = (target: Element, k: string, shiftKey = false) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }));
const focused = () => document.activeElement?.id || document.activeElement?.querySelector("span")?.textContent;
/** More's items, each as its name, and its shortcut or place after a bar when it has one. */
const moreItems = () => [...document.querySelectorAll("#more-menu [role=menuitem]")].map((n) => [...n.querySelectorAll("span")].map((s) => s.textContent).join(" | "));

test("the menu button opens the sidebar as a modal drawer, and Esc closes it back to the button", () => {
  $("#menu-btn").click();
  assert.deepEqual(
    [$("#menu-btn").getAttribute("aria-expanded"), $("#sidebar").getAttribute("role"), $("#sidebar").getAttribute("aria-modal"), $("#main").hasAttribute("inert"), $("#scrim").hidden, focused()],
    ["true", "dialog", "true", true, false, "search-btn"],
  );
  key(document.activeElement!, "Escape");
  assert.deepEqual(
    [$("#menu-btn").getAttribute("aria-expanded"), $("#sidebar").getAttribute("role"), $("#main").hasAttribute("inert"), $("#scrim").hidden, focused()],
    ["false", null, false, true, "menu-btn"],
  );
});

test("Tab and Shift+Tab wrap inside the open drawer", () => {
  $("#menu-btn").click();
  key(document.activeElement!, "Tab", true);
  assert.equal(focused(), "new-from-template"); // the last control in the sidebar
  key(document.activeElement!, "Tab");
  assert.equal(focused(), "search-btn");
  closeDrawer();
});

test("Esc in a field inside the drawer is the field's, not the drawer's", () => {
  $("#menu-btn").click();
  const input = document.createElement("input");
  $("#tree").append(input);
  input.focus();
  key(input, "Escape");
  assert.equal($("#menu-btn").getAttribute("aria-expanded"), "true");
  input.remove();
  closeDrawer();
});

test("the scrim closes the drawer; going somewhere closes it and leaves the focus where the page put it", () => {
  $("#menu-btn").click();
  $("#scrim").click();
  assert.equal($("#menu-btn").getAttribute("aria-expanded"), "false");
  $("#menu-btn").click();
  $("#tasks-view").focus();
  closeDrawer();
  assert.deepEqual([$("#menu-btn").getAttribute("aria-expanded"), focused()], ["false", "tasks-view"]);
});

test("More lists the showing overflow buttons by their titles, with their shortcuts, and an item presses the real button", () => {
  $("#move-btn").hidden = true;
  $("#more-btn").click();
  assert.deepEqual(moreItems(), ["History of this note", "Archive note | ⌘⇧E", "Delete note", "Focus mode | ⌘⇧↵", "Toggle info panel | ⌥⌘B"]);
  assert.deepEqual([$("#more-btn").getAttribute("aria-expanded"), focused()], ["true", "History of this note"]);
  let pressed = "";
  $("#archive-btn").addEventListener("click", () => (pressed = "archive"), { once: true });
  (document.querySelectorAll("#more-menu [role=menuitem]")[1] as HTMLElement).click();
  assert.deepEqual([pressed, $("#more-menu").hidden, $("#more-btn").getAttribute("aria-expanded")], ["archive", true, "false"]);
  $("#move-btn").hidden = false;
});

test("More offers the HTML view it isn't showing", () => {
  $("#html-toggle").hidden = false;
  $('#html-toggle [data-mode="preview"]').classList.add("is-on");
  $("#more-btn").click();
  const items = moreItems();
  assert.equal(items.at(-1), "Show source");
  assert.equal(items.includes("Show preview"), false);
  key(document.activeElement!, "Escape");
  $("#html-toggle").hidden = true;
});

test("arrow keys, Home and End move through More's items, wrapping; Esc closes it back to the button", () => {
  $("#more-btn").click();
  const menu = $("#more-menu");
  const walk = (k: string) => (key(document.activeElement!, k), focused());
  assert.deepEqual([walk("ArrowDown"), walk("End"), walk("ArrowDown"), walk("ArrowUp"), walk("Home")], [
    "Move to another folder",
    "Toggle info panel",
    "History of this note",
    "Toggle info panel",
    "History of this note",
  ]);
  key(document.activeElement!, "Escape");
  assert.deepEqual([menu.hidden, focused()], [true, "more-btn"]);
});

test("the bottom bar's Search and the floating new-note button press the sidebar's own buttons", () => {
  const pressed: string[] = [];
  $("#search-btn").addEventListener("click", () => pressed.push("search"), { once: true });
  $("#new-note").addEventListener("click", () => pressed.push("new"), { once: true });
  $("#search-top").click();
  $("#fab-new").click();
  assert.deepEqual(pressed, ["search", "new"]);
});

test("the bottom bar goes to Today, Notes and Tasks by the sidebar's own buttons, and marks the page you're on", async () => {
  const pressed: string[] = [];
  for (const id of ["today", "notes", "tasks"]) $(`#${id}-btn`).addEventListener("click", () => pressed.push(id), { once: true });
  for (const id of ["today", "notes", "tasks"]) $(`#bn-${id}`).click();
  assert.deepEqual(pressed, ["today", "notes", "tasks"]);
  assert.deepEqual([...$("#bottom-nav").querySelectorAll("button")].map((b) => b.textContent), ["Today", "Notes", "Tasks", "Search", "Menu"]);
  $("#tasks-btn").setAttribute("aria-current", "page");
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(["today", "notes", "tasks"].map((id) => $(`#bn-${id}`).getAttribute("aria-current")), [null, null, "page"]);
  $("#tasks-btn").removeAttribute("aria-current");
  await new Promise((r) => setTimeout(r));
  assert.equal($("#bn-tasks").getAttribute("aria-current"), null);
});

test("on a computer, More holds only a note's occasional buttons, and shows only when one of them does", () => {
  touch = false;
  const set = (id: string, attr: Record<string, string>) => Object.entries(attr).forEach(([k, v]) => $(id).setAttribute(k, v));
  set("#move-btn", { title: "In Projects / Work · Move to another folder" });
  set("#archive-btn", { title: "Unarchive note (⌘⇧E)" });
  set("#split-btn", { title: "Open split view (⌘⌥\\)" });
  renderMore();
  $("#more-btn").click();
  assert.deepEqual(moreItems(), ["History of this note", "Move to another folder | In Projects / Work", "Unarchive note | ⌘⇧E", "Open split view | ⌘⌥\\", "Delete note"]);
  key(document.activeElement!, "Escape");

  // A viewer has no Delete; an open split's lit button is in the bar, not here.
  $("#delete-btn").hidden = true;
  $("#split-btn").classList.add("is-on");
  $("#more-btn").click();
  assert.deepEqual(moreItems(), ["History of this note", "Move to another folder | In Projects / Work", "Unarchive note | ⌘⇧E"]);
  key(document.activeElement!, "Escape");

  // No note open: nothing to tuck away, so no More.
  for (const id of ["#note-history-btn", "#move-btn", "#archive-btn"]) $(id).hidden = true;
  renderMore();
  assert.equal($(".more-wrap").hidden, true);
  for (const id of ["#note-history-btn", "#move-btn", "#archive-btn", "#delete-btn"]) $(id).hidden = false;
  $("#split-btn").classList.remove("is-on");
  renderMore();
  assert.equal($(".more-wrap").hidden, false);
  touch = true;
});
