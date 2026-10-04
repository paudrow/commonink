// App shortcuts match the character typed, so they work on any keyboard layout: ⌘⇧. is the key
// that types "." whether that's US Period or Dvorak's E key. Mod is ⌘ on a Mac, Ctrl elsewhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteKey, formatKeys, learnLayout, matchKeys, speakKeys, withKeys, type KeyLike } from "../web/src/keys.ts";

const press = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const MAC = true;
const WIN = false;
/** What navigator.keyboard.getLayoutMap() gives: the character each physical key types. */
const US = new Map([["Period", "."], ["KeyE", "e"], ["KeyV", "v"], ["Backslash", "\\"], ["BracketLeft", "["], ["BracketRight", "]"], ["Minus", "-"], ["Equal", "="], ["KeyS", "s"]]);
const DVORAK = new Map([["Period", "v"], ["KeyE", "."], ["KeyV", "k"], ["Backslash", "\\"], ["BracketLeft", "/"], ["BracketRight", "="], ["Minus", "["], ["Equal", "]"], ["Semicolon", "s"], ["KeyS", "o"], ["KeyR", "p"], ["KeyP", "l"]]);
const layout = (m: Map<string, string> | null) => learnLayout(m ? { getLayoutMap: async () => m } : undefined);

test("the quick-add shortcut is the key that types '.', on US and Dvorak alike", async () => {
  for (const map of [null, US, DVORAK]) {
    await layout(map);
    // US: Shift+. types ">" on the Period key.
    if (map !== DVORAK) assert.ok(matchKeys(press(">", "Period", { metaKey: true, shiftKey: true }), "Mod-Shift-.", MAC));
    // Dvorak: "." is on the physical E key; with Shift it types ">" there.
    assert.ok(matchKeys(press(">", "KeyE", { metaKey: true, shiftKey: true }), "Mod-Shift-.", MAC));
    assert.ok(matchKeys(press(".", "KeyE", { metaKey: true, shiftKey: true }), "Mod-Shift-.", MAC), "some browsers report the unshifted character");
    // Dvorak's physical Period key types "v": not the shortcut, even though its code is Period.
    if (map !== US) assert.equal(matchKeys(press("V", "Period", { metaKey: true, shiftKey: true }), "Mod-Shift-.", MAC), false);
    // Modifiers are exact: no Shift, or an extra Alt, is another shortcut.
    assert.equal(matchKeys(press(".", "Period", { metaKey: true }), "Mod-Shift-.", MAC), false);
    assert.equal(matchKeys(press(">", "Period", { metaKey: true, shiftKey: true, altKey: true }), "Mod-Shift-.", MAC), false);
  }
  await layout(null);
});

test("Mod is ⌘ on a Mac and Ctrl elsewhere; letters go by the character", async () => {
  await layout(null);
  assert.ok(matchKeys(press("p", "KeyP", { metaKey: true }), "Mod-p", MAC));
  assert.equal(matchKeys(press("p", "KeyP", { ctrlKey: true }), "Mod-p", MAC), false, "Ctrl isn't Mod on a Mac");
  assert.ok(matchKeys(press("p", "KeyP", { ctrlKey: true }), "Mod-p", WIN));
  assert.equal(matchKeys(press("p", "KeyP", { metaKey: true }), "Mod-p", WIN), false, "the Windows key isn't Mod");
  assert.ok(matchKeys(press("P", "KeyP", { metaKey: true, shiftKey: true }), "Mod-Shift-p", MAC));
  assert.equal(matchKeys(press("P", "KeyP", { metaKey: true, shiftKey: true }), "Mod-p", MAC), false, "⌘⇧P isn't ⌘P");
  // Ctrl is Ctrl everywhere (the palette's Ctrl+N and Ctrl+P).
  assert.ok(matchKeys(press("n", "KeyN", { ctrlKey: true }), "Ctrl-n", MAC));
  assert.ok(matchKeys(press("n", "KeyN", { ctrlKey: true }), "Ctrl-n", WIN));
  assert.ok(matchKeys(press("Enter", "Enter", { metaKey: true, shiftKey: true }), "Mod-Shift-Enter", MAC));
  // Dvorak: P is on the physical R key, S on the ; key.
  for (const map of [null, DVORAK]) {
    await layout(map);
    assert.ok(matchKeys(press("p", "KeyR", { metaKey: true }), "Mod-p", MAC));
    assert.equal(matchKeys(press("r", "KeyP", { metaKey: true }), "Mod-p", MAC), false);
    assert.ok(matchKeys(press("s", "Semicolon", { ctrlKey: true }), "Mod-s", WIN));
    assert.equal(matchKeys(press("o", "KeyS", { ctrlKey: true }), "Mod-s", WIN), false);
  }
  // A layout without Latin letters: Ctrl+K types "л", so the key where K is on a US keyboard.
  await layout(new Map([["KeyK", "л"]]));
  assert.ok(matchKeys(press("л", "KeyK", { ctrlKey: true }), "Mod-k", WIN));
  await layout(null);
  assert.ok(matchKeys(press("л", "KeyK", { ctrlKey: true }), "Mod-k", WIN));
});

test("with ⌥ on a Mac the key types a symbol, so the layout says which key it was", async () => {
  // US ⌘⌥[ types "“" on BracketLeft; Dvorak's [ is on the physical - key.
  await layout(US);
  assert.ok(matchKeys(press("“", "BracketLeft", { metaKey: true, altKey: true }), "Mod-Alt-[", MAC));
  await layout(DVORAK);
  assert.ok(matchKeys(press("“", "Minus", { metaKey: true, altKey: true }), "Mod-Alt-[", MAC), "⌥ changed the character; the layout knows the key");
  assert.equal(matchKeys(press("“", "BracketLeft", { metaKey: true, altKey: true }), "Mod-Alt-[", MAC), false);
  assert.ok(matchKeys(press("«", "Backslash", { metaKey: true, altKey: true }), "Mod-Alt-\\", MAC));
  // Without a layout map (Safari, Firefox), a composed symbol falls back to the US key.
  await layout(null);
  assert.ok(matchKeys(press("“", "BracketLeft", { metaKey: true, altKey: true }), "Mod-Alt-[", MAC), "no layout map: the US key");
  // Windows: Ctrl+Alt+[ reports the character itself.
  assert.ok(matchKeys(press("[", "Minus", { ctrlKey: true, altKey: true }), "Mod-Alt-[", WIN));
});

test("shortcuts read ⌘⇧E on a Mac and Ctrl+Shift+E elsewhere; keys typed as they are stay as they are", () => {
  const keys = ["Mod-Shift-e", "Mod-Shift-.", "Mod-Alt-\\", "Mod-Enter", "Shift-Tab", "Mod-click", "G", "gd", ":w", "?"];
  assert.deepEqual(
    keys.map((k) => formatKeys(k, true)),
    ["⌘⇧E", "⌘⇧.", "⌘⌥\\", "⌘↵", "⇧Tab", "⌘-click", "G", "gd", ":w", "?"],
  );
  assert.deepEqual(
    keys.map((k) => formatKeys(k, false)),
    ["Ctrl+Shift+E", "Ctrl+Shift+.", "Ctrl+Alt+\\", "Ctrl+Enter", "Shift+Tab", "Ctrl+click", "G", "gd", ":w", "?"],
  );
});

test("Enter and Backspace are ↵ and ⌫ on a Mac and spelled out elsewhere, like Esc; clicks join the way keys do", () => {
  const keys = ["Enter", "Backspace", "Delete", "Escape", "Mod-Alt-Enter", "Mod-Alt-click", "Shift-click", "click", "Middle-click"];
  assert.deepEqual(
    keys.map((k) => formatKeys(k, true)),
    ["↵", "⌫", "Delete", "Esc", "⌘⌥↵", "⌘⌥-click", "⇧-click", "click", "Middle-click"],
  );
  assert.deepEqual(
    keys.map((k) => formatKeys(k, false)),
    ["Enter", "Backspace", "Delete", "Esc", "Ctrl+Alt+Enter", "Ctrl+Alt+click", "Shift+click", "click", "Middle-click"],
  );
});

test("a tooltip names its shortcut the platform's way, and the key that deletes is ⌫ on a Mac and Delete elsewhere", () => {
  assert.deepEqual([withKeys("Archive", "e", true), withKeys("Close", "Mod-w", true), withKeys("Close", "Mod-w", false), withKeys("Expand", "Enter", false)], ["Archive (e)", "Close (⌘W)", "Close (Ctrl+W)", "Expand (Enter)"]);
  assert.deepEqual([withKeys("Delete", deleteKey(true), true), withKeys("Delete", deleteKey(false), false)], ["Delete (⌫)", "Delete (Delete)"]);
});

test("shortcuts are spoken as words: Command Shift P on a Mac, Control Shift P elsewhere", () => {
  const keys = ["Mod-Shift-p", "Mod-Shift-.", "Mod-Alt-[", "Mod-Enter", "Shift-Enter", "ArrowUp", "Escape", "Mod-click", "Ctrl-o", "G", "gd", ":w", "?"];
  assert.deepEqual(
    keys.map((k) => speakKeys(k, true)),
    ["Command Shift P", "Command Shift Period", "Command Option Left Bracket", "Command Enter", "Shift Enter", "Up Arrow", "Escape", "Command click", "Control O", "G", "gd", ":w", "Question Mark"],
  );
  assert.deepEqual(
    keys.map((k) => speakKeys(k, false)),
    ["Control Shift P", "Control Shift Period", "Control Alt Left Bracket", "Control Enter", "Shift Enter", "Up Arrow", "Escape", "Control click", "Control O", "G", "gd", ":w", "Question Mark"],
  );
});
