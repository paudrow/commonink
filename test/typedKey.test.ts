// Shortcuts by the character a key types, on any layout: Dvorak's S is the physical ; key, and its O the S key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isShortcut, typedKey } from "../web/src/typedKey.ts";

const DVORAK = { get: (code: string) => ({ Semicolon: "s", KeyS: "o", KeyO: "r", KeyJ: "h" })[code] };
const key = (key: string, code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test("the character a key types: e.key, or with ⌥ on a Mac the layout's character for that key", () => {
  const mac = { mac: true, layout: DVORAK };
  assert.equal(typedKey(key("s", "Semicolon"), mac), "s");
  assert.equal(typedKey(key("ß", "Semicolon", { altKey: true, metaKey: true }), mac), "s", "Dvorak ⌥S types ß on the ; key");
  assert.equal(typedKey(key("ø", "KeyS", { altKey: true, metaKey: true }), mac), "o", "and the S key there is O");
  assert.equal(typedKey(key("ß", "KeyS", { altKey: true }), { mac: true, layout: null }), "s", "no layout map: the US key");
  assert.equal(typedKey(key("[", "Minus", { metaKey: true }), mac), "[");
});

test("⌘⌥S on a Mac and Ctrl+Alt+S elsewhere, on US and Dvorak, and nothing else", () => {
  const macDvorak = { mac: true, layout: DVORAK };
  assert.equal(isShortcut(key("ß", "Semicolon", { metaKey: true, altKey: true }), "Mod-Alt-s", macDvorak), true);
  assert.equal(isShortcut(key("ø", "KeyS", { metaKey: true, altKey: true }), "Mod-Alt-s", macDvorak), false, "the physical S key types O on Dvorak");
  assert.equal(isShortcut(key("ß", "KeyS", { metaKey: true, altKey: true }), "Mod-Alt-s", { mac: true, layout: null }), true, "US Mac");
  assert.equal(isShortcut(key("s", "KeyS", { ctrlKey: true, altKey: true }), "Mod-Alt-s", { mac: false, layout: null }), true, "Windows");
  assert.equal(isShortcut(key("s", "Semicolon", { ctrlKey: true, altKey: true }), "Mod-Alt-s", { mac: false, layout: DVORAK }), true, "Windows Dvorak");
  assert.equal(isShortcut(key("s", "KeyS", { metaKey: true }), "Mod-Alt-s", { mac: true, layout: null }), false, "⌘S is Save");
  assert.equal(isShortcut(key("s", "KeyS", { ctrlKey: true, altKey: true }), "Mod-Alt-s", { mac: true, layout: null }), false, "Ctrl isn't ⌘ on a Mac");
  assert.equal(isShortcut(key("s", "KeyS", { metaKey: true, altKey: true, shiftKey: true }), "Mod-Alt-s", { mac: true, layout: null }), false);
});
