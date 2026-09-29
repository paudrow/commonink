// App shortcuts match the character typed, so they work on any keyboard layout: ⌘⇧. is the key
// that types "." whether that's US Period or Dvorak's E key. Mod is ⌘ on a Mac, Ctrl elsewhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchShortcut, shortcutLabel, type KeyLike } from "../web/src/keys.ts";

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const mac = { mac: true, layout: null };
const win = { mac: false, layout: null };
/** What navigator.keyboard.getLayoutMap() gives: the character each physical key types. */
const US = new Map([["Period", "."], ["KeyE", "e"], ["KeyV", "v"], ["Backslash", "\\"], ["BracketLeft", "["], ["BracketRight", "]"], ["Minus", "-"], ["Equal", "="], ["KeyS", "s"]]);
const DVORAK = new Map([["Period", "v"], ["KeyE", "."], ["KeyV", "k"], ["Backslash", "\\"], ["BracketLeft", "/"], ["BracketRight", "="], ["Minus", "["], ["Equal", "]"], ["Semicolon", "s"], ["KeyS", "o"]]);

test("the quick-add shortcut is the key that types '.', on US and Dvorak alike", () => {
  // US: Shift+. types ">" on the Period key.
  assert.ok(matchShortcut(ev(">", "Period", { metaKey: true, shiftKey: true }), "Mod+Shift+.", mac));
  // Dvorak: "." is on the physical E key; with Shift it types ">" there.
  assert.ok(matchShortcut(ev(">", "KeyE", { metaKey: true, shiftKey: true }), "Mod+Shift+.", mac));
  assert.ok(matchShortcut(ev(".", "KeyE", { metaKey: true, shiftKey: true }), "Mod+Shift+.", mac), "some browsers report the unshifted character");
  // Dvorak's physical Period key types "v": not the shortcut, even though its code is Period.
  assert.equal(matchShortcut(ev("V", "Period", { metaKey: true, shiftKey: true }), "Mod+Shift+.", mac), false);
  assert.equal(matchShortcut(ev("V", "Period", { metaKey: true, shiftKey: true }), "Mod+Shift+.", { mac: true, layout: DVORAK }), false);
  // Modifiers are exact: no Shift, or an extra Alt, is another shortcut.
  assert.equal(matchShortcut(ev(".", "Period", { metaKey: true }), "Mod+Shift+.", mac), false);
  assert.equal(matchShortcut(ev(">", "Period", { metaKey: true, shiftKey: true, altKey: true }), "Mod+Shift+.", mac), false);
});

test("Mod is ⌘ on a Mac and Ctrl elsewhere", () => {
  assert.ok(matchShortcut(ev("k", "KeyK", { metaKey: true }), "Mod+k", mac));
  assert.equal(matchShortcut(ev("k", "KeyK", { ctrlKey: true }), "Mod+k", mac), false, "Ctrl+K on a Mac is the editor's");
  assert.ok(matchShortcut(ev("k", "KeyK", { ctrlKey: true }), "Mod+k", win));
  assert.equal(matchShortcut(ev("k", "KeyK", { metaKey: true }), "Mod+k", win), false, "the Windows key isn't Mod");
  // Ctrl is Ctrl everywhere (the palette's Ctrl+N and Ctrl+P).
  assert.ok(matchShortcut(ev("n", "KeyN", { ctrlKey: true }), "Ctrl+n", mac));
  assert.ok(matchShortcut(ev("n", "KeyN", { ctrlKey: true }), "Ctrl+n", win));
  // Letters by character: Dvorak's S is on the physical ; key.
  assert.ok(matchShortcut(ev("s", "Semicolon", { ctrlKey: true }), "Mod+s", win));
  assert.equal(matchShortcut(ev("o", "KeyS", { ctrlKey: true }), "Mod+s", win), false);
  assert.ok(matchShortcut(ev("E", "KeyE", { metaKey: true, shiftKey: true }), "Mod+Shift+e", mac));
  assert.ok(matchShortcut(ev("Enter", "Enter", { metaKey: true, shiftKey: true }), "Mod+Shift+Enter", mac));
});

test("with ⌥ on a Mac the key types a symbol, so the layout says which key it was", () => {
  // US ⌘⌥[ types "“" on BracketLeft; Dvorak's [ is on the physical - key.
  assert.ok(matchShortcut(ev("“", "BracketLeft", { metaKey: true, altKey: true }), "Mod+Alt+[", { mac: true, layout: US }));
  assert.ok(matchShortcut(ev("“", "Minus", { metaKey: true, altKey: true }), "Mod+Alt+[", { mac: true, layout: DVORAK }));
  assert.equal(matchShortcut(ev("÷", "BracketLeft", { metaKey: true, altKey: true }), "Mod+Alt+[", { mac: true, layout: DVORAK }), false);
  assert.ok(matchShortcut(ev("«", "Backslash", { metaKey: true, altKey: true }), "Mod+Alt+\\", { mac: true, layout: DVORAK }));
  // Without a layout map (Safari, Firefox), a composed symbol falls back to the US key.
  assert.ok(matchShortcut(ev("“", "BracketLeft", { metaKey: true, altKey: true }), "Mod+Alt+[", mac));
  // A layout without Latin letters: Ctrl+K types "л", so the key where K is on a US keyboard.
  assert.ok(matchShortcut(ev("л", "KeyK", { ctrlKey: true }), "Mod+k", win));
  assert.ok(matchShortcut(ev("л", "KeyK", { ctrlKey: true }), "Mod+k", { mac: false, layout: new Map([["KeyK", "л"]]) }));
  // Windows: Ctrl+Alt+[ reports the character itself.
  assert.ok(matchShortcut(ev("[", "Minus", { ctrlKey: true, altKey: true }), "Mod+Alt+[", win));
});

test("shortcuts are written the platform's way", () => {
  assert.equal(shortcutLabel("Mod+Shift+.", true), "⌘⇧.");
  assert.equal(shortcutLabel("Mod+Shift+.", false), "Ctrl+Shift+.");
  assert.equal(shortcutLabel("Mod+Alt+\\", true), "⌘⌥\\");
  assert.equal(shortcutLabel("Mod+Shift+Enter", true), "⌘⇧↵");
  assert.equal(shortcutLabel("Mod+Alt+[", false), "Ctrl+Alt+[");
  assert.equal(shortcutLabel("Mod+Shift+e", true), "⌘⇧E");
});
