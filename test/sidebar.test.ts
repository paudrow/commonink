import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameField, sectionHint, sidebarTags } from "../web/src/sidebar.ts";
import type { TagCount } from "../web/src/api.ts";

const tag = (t: string, notes: number, tasks = 0, assets = 0): TagCount => ({ tag: t, display: t, notes, tasks, assets });

test("Tags lists tags on notes and tags added by name, with their parents, but not tags only on assets", () => {
  const tags = [tag("brand", 0, 0, 2), tag("home", 1), tag("work", 0), tag("work/clients", 0), tag("work/logo", 0, 0, 1)];
  assert.deepEqual(sidebarTags(tags).map((t) => t.tag), ["home", "work", "work/clients"]);
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
