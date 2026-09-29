// ⌘⌥S (Ctrl+Alt+S off a Mac) wraps a collapsible section, matched by the letter typed: on Dvorak S is
// the physical ; key, and its O the physical S key; on a Mac ⌥S types "ß".
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnLayout, matchKeys } from "../web/src/commands.ts";

const key = (key: string, code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test("⌘⌥S on a Dvorak Mac is the ; key, which types ß with ⌥; the physical S key (O there) isn't", async () => {
  await learnLayout({ getLayoutMap: async () => new Map([["Semicolon", "s"], ["KeyS", "o"], ["KeyO", "r"]]) });
  assert.equal(matchKeys(key("ß", "Semicolon", { metaKey: true, altKey: true }), "Mod-Alt-s", true), true);
  assert.equal(matchKeys(key("ø", "KeyS", { metaKey: true, altKey: true }), "Mod-Alt-s", true), false);
  assert.equal(matchKeys(key("s", "Semicolon", { ctrlKey: true, altKey: true }), "Mod-Alt-s", false), true, "Windows Dvorak: Ctrl+Alt+S");
  await learnLayout(undefined);
});

test("without a layout map (Safari, Firefox), ⌥ + a letter on a Mac is the US letter key", async () => {
  await learnLayout(undefined);
  assert.equal(matchKeys(key("ß", "KeyS", { metaKey: true, altKey: true }), "Mod-Alt-s", true), true, "US Mac");
  assert.equal(matchKeys(key("s", "KeyS", { ctrlKey: true, altKey: true }), "Mod-Alt-s", false), true, "Windows");
  assert.equal(matchKeys(key("s", "KeyS", { metaKey: true }), "Mod-Alt-s", true), false, "⌘S is Save");
  assert.equal(matchKeys(key("s", "KeyS", { ctrlKey: true, altKey: true }), "Mod-Alt-s", true), false, "Ctrl isn't ⌘ on a Mac");
  assert.equal(matchKeys(key("Í", "KeyS", { metaKey: true, altKey: true, shiftKey: true }), "Mod-Alt-s", true), false, "⌘⌥⇧S isn't it");
});
