import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { morePlaces, nameField, sectionHint, shownItems, sidebarTags } from "../web/src/sidebar.ts";
import type { TagCount } from "../web/src/api.ts";

const tag = (t: string, notes: number, tasks = 0, assets = 0): TagCount => ({ tag: t, display: t, notes, tasks, assets });

test("Tags lists tags on notes or tasks and tags added by name, with their parents, but not tags only on assets", () => {
  const tags = [tag("brand", 0, 0, 2), tag("home", 1), tag("podcast", 0, 3), tag("work", 0), tag("work/clients", 0), tag("work/logo", 0, 0, 1)];
  assert.deepEqual(sidebarTags(tags).map((t) => t.tag), ["home", "podcast", "work", "work/clients"]);
});

test("an empty section's line keeps the rows' chevron column, so it starts where their icons do", () => {
  const hint = sectionHint("Click ", "+", " to add a tag.");
  assert.deepEqual([...hint.children].map((c) => c.className), ["chev is-leaf", ""]);
  assert.equal(hint.textContent, "Click + to add a tag.");
});

test("a section's name field hands over what was typed on Enter, nothing on Escape, and goes either way", () => {
  const section = document.createElement("nav");
  section.append(document.createElement("div"));
  document.body.append(section);
  const got: Array<string | null> = [];
  const open = () => nameField(section, { icon: "hash", placeholder: "Tag", label: "New tag", done: (name) => got.push(name) });
  const key = (k: string) => section.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: k }));

  open();
  assert.equal(section.firstElementChild!.className, "tree-row is-input");
  section.querySelector("input")!.value = "work/clients";
  key("Enter");
  open();
  key("Escape");
  open();
  section.querySelector("input")!.value = "left";
  section.querySelector("input")!.dispatchEvent(new window.Event("blur")); // jsdom's Event: Node's own isn't one jsdom takes
  assert.deepEqual(got, ["work/clients", null, "left"]);
  assert.equal(section.querySelector(".is-input"), null);
});

test("Contacts, Calendar, Assets and Smart folders show once in use, while you're on one, or always if Settings says so", () => {
  const none = { contacts: false, calendar: false, assets: false, smart: false };
  const shown = (r: Record<string, boolean>) => Object.keys(r).filter((k) => r[k]);
  assert.deepEqual(shown(shownItems(none, {}, new Set())), [], "a new workspace's sidebar leaves them all out");
  assert.deepEqual(shown(shownItems({ ...none, assets: true, smart: true }, {}, new Set())), ["assets", "smart"]);
  assert.deepEqual(shown(shownItems(none, {}, new Set(["contacts"]))), ["contacts"], "opened by URL or from ⌘K, it shows while you're on it");
  assert.deepEqual(shown(shownItems(none, { calendar: true, assets: false }, new Set())), ["calendar"]);
  assert.deepEqual(shown(shownItems({ ...none, assets: true }, { assets: false }, new Set())), ["assets"], "turning the setting off only lets it wait again");
});

test("a workspace that isn't gamified shows every optional item from the start", () => {
  const none = { contacts: false, calendar: false, assets: false, smart: false };
  assert.deepEqual(shownItems(none, {}, new Set(), true), { contacts: true, calendar: true, assets: true, smart: true });
  assert.deepEqual(shownItems(none, {}, new Set()), none);
});

test("past Today, Notes and Tasks, pages sit under More unless kept up top (Calendar is by default); Shared with me always folds", () => {
  const shown = { contacts: true, calendar: true, assets: false, history: true, shared: true };
  assert.deepEqual(morePlaces(shown, {}), { contacts: "more", calendar: "top", assets: null, history: "more", shared: "more" });
  assert.deepEqual(morePlaces(shown, { calendar: false, history: true, assets: true }), { contacts: "more", calendar: "more", assets: null, history: "top", shared: "more" }, "a page that isn't showing stays out, kept up top or not");
});

test("with More folded, the page you're on sits up top, never below the closed More", () => {
  const shown = { contacts: true, calendar: true, assets: true, history: true, shared: false };
  assert.equal(morePlaces(shown, {}, "contacts", true).contacts, "top");
  assert.equal(morePlaces(shown, {}, "contacts", false).contacts, "more", "open, it stays in its place under More");
  assert.equal(morePlaces(shown, {}, "notes", true).contacts, "more");
});
