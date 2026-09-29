// Shortcuts by the character a key types, not where it sits, so they work on any layout (Dvorak's S
// is the physical ; key). With ⌥ on a Mac a key types a symbol ("ß" for S), so the layout map
// (Chrome's navigator.keyboard.getLayoutMap) says which character it is; without one, the US key's.
// Interim: #72 adds matchShortcut (web/src/keys.ts), which does this for every app shortcut. Once
// that's merged, use it instead and remove this file.
import { IS_MAC } from "./panes.ts";

export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;
/** Physical key code → the character it types, unshifted. */
export type LayoutMap = { get(code: string): string | undefined };
type Env = { mac: boolean; layout: LayoutMap | null };

let layout: LayoutMap | null = null;
function loadLayout() {
  const kb = typeof navigator !== "undefined" ? (navigator as { keyboard?: { getLayoutMap?(): Promise<LayoutMap> } }).keyboard : undefined;
  void kb?.getLayoutMap?.().then((m) => (layout = m)).catch(() => {});
}
loadLayout();
if (typeof window !== "undefined") window.addEventListener("focus", loadLayout); // the layout may have changed while away

const ASCII = /^[\x20-\x7e]$/;

/** The character `e`'s key types (lowercase), or its name ("Enter"): e.key, unless ⌥ made it a symbol. */
export function typedKey(e: Pick<KeyLike, "key" | "code">, env: Env = { mac: IS_MAC, layout }): string {
  if (e.key.length > 1) return e.key;
  const typed = e.key.toLowerCase();
  if (ASCII.test(typed)) return typed;
  const plain = env.layout?.get(e.code);
  if (plain && ASCII.test(plain)) return plain.toLowerCase();
  return /^Key([A-Z])$/.exec(e.code)?.[1].toLowerCase() ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? typed;
}

/**
 * Whether `e` is `spec`, written like a CodeMirror key: `Mod-Alt-s`, `Mod-[`. `Mod` is ⌘ on a Mac
 * and Ctrl elsewhere; the modifiers must match exactly.
 */
export function isShortcut(e: KeyLike, spec: string, env: Env = { mac: IS_MAC, layout }): boolean {
  const parts = spec.split("-");
  const want = parts.pop()!.toLowerCase();
  const mods = new Set(parts);
  const meta = mods.has("Mod") && env.mac;
  const ctrl = mods.has("Ctrl") || (mods.has("Mod") && !env.mac);
  if (e.metaKey !== meta || e.ctrlKey !== ctrl || e.altKey !== mods.has("Alt") || e.shiftKey !== mods.has("Shift")) return false;
  return typedKey(e, env) === want;
}
