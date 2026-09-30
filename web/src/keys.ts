// App shortcuts, matched by the character a key types rather than where the key sits, so they work
// on any keyboard layout (Dvorak's "." is the physical E key). Every app shortcut outside a
// CodeMirror keymap (those already resolve by character) goes through matchKeys:
//
//   if (matchKeys(e, "Mod-Shift-.")) …
//
// Keys are written as CodeMirror writes them: modifiers and a key joined by "-". `Mod` is ⌘ on a
// Mac and Ctrl elsewhere, `Ctrl` is Ctrl everywhere, then `Alt` and `Shift`; the key is one
// character ("p", ".", "\\", "[") or a key name ("Enter", "ArrowUp"). Modifiers must match exactly.
// With Shift the shifted character counts (">" for "."). With ⌥ on a Mac a key types a symbol ("“"
// for "["), so the layout map (learnLayout) says which character the key types; without one, and on
// layouts without Latin letters, the key where it is on a US keyboard. formatKeys writes a shortcut
// the platform's way (⌘⇧. on a Mac, Ctrl+Shift+. elsewhere).
import { IS_MAC } from "./panes.ts";

/** The parts of a KeyboardEvent a shortcut looks at. */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** What each physical key types in this keyboard layout, unshifted (Chrome and Edge can tell). */
let layout: ReadonlyMap<string, string> | null = null;

/** Learn the keyboard layout, so a shortcut with ⌥ still finds the key its character is on. The app calls it at boot and on focus. */
export async function learnLayout(keyboard: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } | undefined = (navigator as any).keyboard) {
  layout = (await keyboard?.getLayoutMap().catch(() => null)) ?? null;
}

/** A US keyboard's shifted characters. */
const SHIFTED: Record<string, string> = { ".": ">", ",": "<", "/": "?", ";": ":", "'": '"', "[": "{", "]": "}", "\\": "|", "-": "_", "=": "+", "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")" };
/** Where a character is on a US keyboard: the fallback when the layout can't say. */
const US_CODE: Record<string, string> = { ".": "Period", ",": "Comma", "/": "Slash", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal", "`": "Backquote" };
const usCode = (ch: string) => US_CODE[ch] ?? (/^[a-z]$/.test(ch) ? `Key${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : null);
const ASCII = /^[\x20-\x7e]$/;

/** Whether a key press is the shortcut `keys` ("Mod-Shift-."; see the top of this file). */
export function matchKeys(e: KeyLike, keys: string, mac = IS_MAC): boolean {
  const parts = keys.split(/-(?=.)/);
  const last = parts.pop()!;
  const want = last.length === 1 ? last.toLowerCase() : last;
  const has = (m: string) => parts.includes(m);
  if (e.metaKey !== (has("Mod") && mac) || e.ctrlKey !== (has("Ctrl") || (has("Mod") && !mac)) || e.altKey !== has("Alt") || e.shiftKey !== has("Shift")) return false;
  if (want.length > 1) return e.key === want; // Enter, ArrowUp…
  const typed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (typed === want || (e.shiftKey && typed === SHIFTED[want])) return true;
  // The character that key types on this layout (⌥ on a Mac composes a symbol instead).
  const plain = layout?.get(e.code);
  if (plain && ASCII.test(plain)) return plain.toLowerCase() === want;
  // No layout map, or a layout without Latin letters (Russian, Greek): the key where it is on a US keyboard.
  return ((e.altKey && mac) || !ASCII.test(typed)) && e.code === usCode(want);
}

const MAC_MOD: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const PC_MOD: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const KEY_NAMES: Record<string, string> = { Enter: "↵", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", click: "click" };

/** "Mod-Shift-e" → ⌘⇧E on a Mac and Ctrl+Shift+E elsewhere; a key typed as is ("gd") stays as it is. */
export function formatKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.length > 1 ? keys.split(/-(?=.)/) : [keys];
  const key = parts.pop()!;
  const mods = parts.filter((p) => p in MAC_MOD);
  if (mods.length !== parts.length) return keys;
  const name = KEY_NAMES[key] ?? (mods.length && key.length === 1 ? key.toUpperCase() : key);
  if (key === "click") return mac ? `${mods.map((m) => MAC_MOD[m]).join("")}-click` : `${mods.map((m) => PC_MOD[m]).join("+")}-click`;
  return mac ? mods.map((m) => MAC_MOD[m]).join("") + name : [...mods.map((m) => PC_MOD[m]), name].join("+");
}

const MAC_MOD_SAID: Record<string, string> = { Mod: "Command", Ctrl: "Control", Alt: "Option", Shift: "Shift" };
const PC_MOD_SAID: Record<string, string> = { Mod: "Control", Ctrl: "Control", Alt: "Alt", Shift: "Shift" };
const KEY_SAID: Record<string, string> = {
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
  ".": "Period",
  ",": "Comma",
  "/": "Slash",
  "\\": "Backslash",
  "[": "Left Bracket",
  "]": "Right Bracket",
  "?": "Question Mark",
  ">": "Greater Than",
};

/** How a screen reader should say a shortcut: "Mod-Shift-p" is "Command Shift P" on a Mac, "Control Shift P" elsewhere. */
export function speakKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.length > 1 ? keys.split(/-(?=.)/) : [keys];
  const key = parts.pop()!;
  if (!parts.every((p) => p in MAC_MOD)) return keys;
  const said = mac ? MAC_MOD_SAID : PC_MOD_SAID;
  return [...parts.map((m) => said[m]), KEY_SAID[key] ?? (parts.length && key.length === 1 ? key.toUpperCase() : key)].join(" ");
}

/** A <kbd> with the shortcut the platform's way (⌘⇧P), and its spoken name for screen readers in place of the symbols. */
export function kbd(keys: string, mac = IS_MAC): HTMLElement {
  const k = document.createElement("kbd");
  const [shown, said] = [formatKeys(keys, mac), speakKeys(keys, mac)];
  if (shown === said) {
    k.textContent = shown;
    return k;
  }
  const glyphs = document.createElement("span");
  glyphs.setAttribute("aria-hidden", "true");
  glyphs.textContent = shown;
  const words = document.createElement("span");
  words.className = "sr-only";
  words.textContent = said;
  k.append(glyphs, words);
  return k;
}
