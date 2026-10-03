// Split view: the notes the two panes show, each tab with its own back and forward (tabs.ts holds
// the tabs and the layout), and how the window is divided. Kept per viewer in browser storage; the app works the same without it.
// No DOM here: the app shell (main.ts) draws the panes.

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Where something opened goes: here (the tab you're on), in a new tab, or to the side (split view). */
export type Where = "here" | "tab" | "side";

/**
 * What a click on something that opens a note does, as in a browser and VS Code: a plain click opens
 * it here; ⌘-click (Ctrl-click off a Mac) or a middle-click opens it in a new tab; ⌘⌥-click
 * (Ctrl+Alt-click) opens it to the side, as ⌘⌥\ splits and ⌘⌥↵ opens a link to the side. On a Mac,
 * Ctrl-click is the right-click menu, so it never counts.
 */
export function clickWhere(e: { metaKey: boolean; ctrlKey: boolean; altKey?: boolean; button?: number }, mac = IS_MAC): Where {
  const button = e.button ?? 0;
  if (button === 1) return "tab";
  if (button !== 0 || !(mac ? e.metaKey && !e.ctrlKey : e.ctrlKey)) return "here";
  return e.altKey ? "side" : "tab";
}
/** A click that opens somewhere other than here (so a row's own click action shouldn't run). */
export const modClick = (e: { metaKey: boolean; ctrlKey: boolean; altKey?: boolean; button?: number }, mac = IS_MAC) => clickWhere(e, mac) !== "here";

/**
 * What a click on a real link to a note (`<a href="/notes/…">`) does: open it here, in a new tab or
 * to the side (the same clicks as everywhere else), or leave it to the browser, which opens a
 * window for a Shift-click and the like.
 */
export function linkClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button?: number }, mac = IS_MAC): Where | "browser" {
  const where = clickWhere(e, mac);
  if (where !== "here") return where;
  return (e.button ?? 0) !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ? "browser" : "here";
}

/** How those clicks are written in hints. */
export const TAB_CLICK = IS_MAC ? "⌘-click" : "Ctrl-click";
export const SIDE_CLICK = IS_MAC ? "⌘⌥-click" : "Ctrl+Alt-click";

/**
 * What Enter does in the palette (⌘K), the same way round as the clicks: open the pick here, in a
 * new tab (⌘Enter, Ctrl+Enter off a Mac, or Alt+Enter), to the side (⌘⌥Enter), or make a note of
 * what's typed even if notes match (Shift+Enter).
 */
export function paletteEnter(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }, mac = IS_MAC): Where | "create" {
  if (e.shiftKey) return "create";
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod) return e.altKey ? "side" : "tab";
  return e.altKey && !e.metaKey && !e.ctrlKey ? "tab" : "here";
}

/** One pane's place: the note it shows (by ID, so renames don't lose it) and where it's been. */
export interface PaneTrail {
  note: string | null;
  back: string[];
  forward: string[];
}
/** Which edge of the window the side pane sits on: beside the main pane, or above or below it. */
export type Dock = "right" | "left" | "top" | "bottom";
export const DOCKS: readonly Dock[] = ["right", "left", "top", "bottom"];
const KEEP = 50;
export const clampSide = (n: number) => Math.min(0.8, Math.max(0.2, n));

/** Show `note` in a pane: the one it showed goes on its back list, and forward is cleared. The same note again changes nothing. */
export function visit(p: PaneTrail, note: string): PaneTrail {
  if (p.note === note) return p;
  return { note, back: p.note ? [...p.back, p.note].slice(-KEEP) : p.back, forward: [] };
}

/** Step back (or forward) in a pane, or null if there's nowhere to go. */
export function step(p: PaneTrail, dir: "back" | "forward"): PaneTrail | null {
  const from = dir === "back" ? p.back : p.forward;
  const to = from.at(-1);
  if (!to) return null;
  const rest = from.slice(0, -1);
  const other = p.note ? [...(dir === "back" ? p.forward : p.back), p.note] : dir === "back" ? p.forward : p.back;
  return dir === "back" ? { note: to, back: rest, forward: other } : { note: to, back: other, forward: rest };
}

/** Forget a note that's gone (deleted, or its ID no longer resolves) from a pane's trail. */
export function forget(p: PaneTrail, note: string): PaneTrail {
  const keep = (l: string[]) => l.filter((n) => n !== note);
  return { note: p.note === note ? null : p.note, back: keep(p.back), forward: keep(p.forward) };
}

/** A pane's (or a tab's) trail read back from storage; anything malformed is empty. */
export function parseTrail(t: any): PaneTrail {
  const ids = (l: unknown) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === "string").slice(-KEEP) : []);
  return { note: typeof t?.note === "string" ? t.note : null, back: ids(t?.back), forward: ids(t?.forward) };
}

/**
 * Where a note dropped at (`fx`, `fy`), each 0 to 1 across the window's notes, splits it: near the
 * top or bottom edge, a pane above or below; anywhere else, beside it on the half it's dropped on.
 */
export function dropDock(fx: number, fy: number): Dock {
  if (fy < 0.25 && fy < Math.min(fx, 1 - fx)) return "top";
  if (fy > 0.75 && 1 - fy < Math.min(fx, 1 - fx)) return "bottom";
  return fx < 0.5 ? "left" : "right";
}

// ------------------------------------------------------------------ pages, the browser's history, places

/**
 * A page (Notes, Tasks, History…) in a pane's trail, by its address. A page goes in only when you
 * went to it, so back from a note you followed a link to is the note with the link.
 */
export const pageEntry = (url: string) => `page:${url}`;
/** The page an entry in a trail is, by its address, or null for a note. */
export const pageOf = (entry: string) => (entry.startsWith("page:") ? entry.slice(5) : null);

/**
 * Which way the browser moved, from the app's history entry `at` to `to` (each entry the app
 * pushes is numbered): a step back or forward in the focused pane, as many as it moved. Null if it
 * didn't move, or `to` isn't one of the app's entries.
 */
export function historyStep(at: number, to: unknown): { dir: "back" | "forward"; steps: number } | null {
  if (typeof to !== "number" || to === at) return null;
  return { dir: to < at ? "back" : "forward", steps: Math.abs(to - at) };
}

/** Where you were in a note: the cursor, and the view: the line at its top and how far into that line. */
export interface Place {
  pos: number;
  top: number;
  off: number;
}
/** Remember a note's place (by its ID, so renames keep it), keeping the latest `keep` notes. */
export function rememberPlace(places: Record<string, Place>, id: string, place: Place, keep = 200): Record<string, Place> {
  const rest = Object.entries(places).filter(([k]) => k !== id);
  return Object.fromEntries([...rest.slice(Math.max(0, rest.length - keep + 1)), [id, place]]);
}

/**
 * The entries that way in a pane's trail, nearest first, without the ones a step would skip (`ok`
 * says which it wouldn't: a note that's gone, or one the other pane shows).
 */
export function trailAhead(p: PaneTrail, dir: "back" | "forward", ok: (entry: string) => boolean): string[] {
  return [...(dir === "back" ? p.back : p.forward)].reverse().filter(ok);
}
