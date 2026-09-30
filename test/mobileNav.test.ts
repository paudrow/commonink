import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
(globalThis as any).matchMedia = () => ({ matches: true, addEventListener() {} });
const { closeDrawer, setupMobileNav } = await import("../web/src/mobileNav.ts");
setupMobileNav();

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const key = (target: Element, k: string, shiftKey = false) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }));
const focused = () => document.activeElement?.id || document.activeElement?.textContent;

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

test("More lists the showing overflow buttons by their titles, and an item presses the real button", () => {
  $("#move-btn").hidden = true;
  $("#more-btn").click();
  const items = [...document.querySelectorAll("#more-menu [role=menuitem]")].map((n) => n.textContent);
  assert.deepEqual(items, ["History of this note", "Archive note", "Delete note", "Focus mode", "Toggle side panel"]);
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
  const items = [...document.querySelectorAll("#more-menu [role=menuitem]")].map((n) => n.textContent);
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
    "Move to folder",
    "Toggle side panel",
    "History of this note",
    "Toggle side panel",
    "History of this note",
  ]);
  key(document.activeElement!, "Escape");
  assert.deepEqual([menu.hidden, focused()], [true, "more-btn"]);
});

test("the top-bar search and the floating new-note button press the sidebar's own buttons", () => {
  const pressed: string[] = [];
  $("#search-btn").addEventListener("click", () => pressed.push("search"), { once: true });
  $("#new-note").addEventListener("click", () => pressed.push("new"), { once: true });
  $("#search-top").click();
  $("#fab-new").click();
  assert.deepEqual(pressed, ["search", "new"]);
});
