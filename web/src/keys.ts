// App shortcuts, matched by the character a key types rather than where the key sits, so they work
// on any keyboard layout (Dvorak's "." is the physical E key). Use matchShortcut for every app
// shortcut outside CodeMirror keymaps (which already resolve by character):
//
//   if (matchShortcut(e, "Mod+Shift+.")) …
//
// A spec is modifiers and a key joined by "+": `Mod` (⌘ on a Mac, Ctrl elsewhere), `Ctrl` (Ctrl
// everywhere), `Shift`, `Alt`; then one character ("k", ".", "\\", "[") or a key name ("Enter",
// "ArrowUp"). Modifiers must match exactly. With Shift, the shifted character (">" for ".") counts.
// With ⌥ on a Mac a key types a symbol ("“" for "["), so the layout map (Chrome's
// navigator.keyboard.getLayoutMap) says which character the key types; without one, the US key.
import { IS_MAC } from "./panes.ts";

/** The parts of a KeyboardEvent a shortcut looks at. */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;
/** Physical key code → the character it types, unshifted (navigator.keyboard.getLayoutMap()). */
export type LayoutMap = { get(code: string): string | undefined };

/** The layout the browser reported, once it has (Chrome and Edge); null elsewhere. */
let layout: LayoutMap | null = null;
function loadLayout() {
  const kb = (typeof navigator !== "undefined" ? (navigator as { keyboard?: { getLayoutMap?(): Promise<LayoutMap> } }).keyboard : undefined) ?? null;
  void kb?.getLayoutMap?.().then((m) => (layout = m)).catch(() => {});
}
loadLayout();
if (typeof window !== "undefined") window.addEventListener("focus", loadLayout); // the layout may have changed while away

/** A US keyboard's shifted characters. */
const SHIFTED: Record<string, string> = { ".": ">", ",": "<", "/": "?", ";": ":", "'": '"', "[": "{", "]": "}", "\\": "|", "-": "_", "=": "+", "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")" };
/** Where a character is on a US keyboard: the fallback when there's no layout map. */
const US_CODE: Record<string, string> = { ".": "Period", ",": "Comma", "/": "Slash", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal", "`": "Backquote" };
const usCode = (ch: string) => US_CODE[ch] ?? (/^[a-z]$/.test(ch) ? `Key${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : null);

function parse(spec: string) {
  const parts = spec.split("+");
  // "Mod++" would be a plus; a trailing empty part means the key was "+".
  const key = parts.at(-1) === "" ? "+" : parts.at(-1)!;
  const mods = new Set(parts.slice(0, parts.at(-1) === "" ? -2 : -1));
  return { key: key.length === 1 ? key.toLowerCase() : key, mod: mods.has("Mod"), ctrl: mods.has("Ctrl"), shift: mods.has("Shift"), alt: mods.has("Alt") };
}

/** Whether `e` is the shortcut `spec` (see the top of this file). `env` is for tests. */
export function matchShortcut(e: KeyLike, spec: string, env: { mac: boolean; layout: LayoutMap | null } = { mac: IS_MAC, layout }): boolean {
  const s = parse(spec);
  const meta = s.mod && env.mac;
  const ctrl = s.ctrl || (s.mod && !env.mac);
  if (e.metaKey !== meta || e.ctrlKey !== ctrl || e.shiftKey !== s.shift || e.altKey !== s.alt) return false;
  if (s.key.length > 1) return e.key === s.key; // Enter, ArrowUp…
  const typed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (typed === s.key || (s.shift && typed === SHIFTED[s.key])) return true;
  // The character that key types on this layout (⌥ on a Mac composes a symbol instead).
  const plain = env.layout?.get(e.code);
  if (plain && ASCII.test(plain)) return plain.toLowerCase() === s.key;
  // No layout map, or a layout without Latin letters (Russian, Greek): the key where it is on a US keyboard.
  return ((e.altKey && env.mac) || !ASCII.test(typed)) && e.code === usCode(s.key);
}

const ASCII = /^[\x20-\x7e]$/;

/** A shortcut as the platform writes it: ⌘⇧. on a Mac, Ctrl+Shift+. elsewhere. */
export function shortcutLabel(spec: string, mac = IS_MAC): string {
  const s = parse(spec);
  const key = s.key === "Enter" ? (mac ? "↵" : "Enter") : s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) return `${s.mod ? "⌘" : ""}${s.ctrl ? "⌃" : ""}${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}${key}`;
  return [s.mod || s.ctrl ? "Ctrl" : "", s.alt ? "Alt" : "", s.shift ? "Shift" : "", key].filter(Boolean).join("+");
}
