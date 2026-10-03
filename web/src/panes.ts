// Split view: the notes the two panes show, each with its own back and forward, and how the
// window is divided. Kept per viewer in browser storage; the app works the same without it.
// No DOM here: the app shell (main.ts) draws the panes.

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * A click that opens a note to the side: Cmd-click on a Mac, Ctrl-click elsewhere (CodeMirror's
 * "Mod"). On a Mac, Ctrl-click is the right-click menu, so it never counts.
 */
export const sideClick = (e: { metaKey: boolean; ctrlKey: boolean; button?: number }, mac = IS_MAC) =>
  (e.button ?? 0) === 0 && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey);

/**
 * What a click on a real link to a note (`<a href="/notes/…">`) does: open it here, open it to
 * the side (the same click as everywhere else), or leave it to the browser, which opens a new tab
 * or window for a middle-click, Shift-click and the like.
 */
export const linkClick = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button?: number }, mac = IS_MAC): "open" | "side" | "browser" =>
  sideClick(e, mac) ? "side" : (e.button ?? 0) !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ? "browser" : "open";

/** How that click is written in hints. */
export const SIDE_CLICK = IS_MAC ? "⌘-click" : "Ctrl-click";

/**
 * What Enter does in the palette (⌘K): open the pick in place, open it to the side (⌘Enter on a
 * Mac, Ctrl+Enter elsewhere), open it in a new tab (Alt+Enter), or make a note of what's typed
 * even if notes match (Shift+Enter).
 */
export function paletteEnter(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }, mac = IS_MAC): "open" | "side" | "tab" | "create" {
  if (e.shiftKey) return "create";
  if (e.altKey && !e.metaKey && !e.ctrlKey) return "tab";
  return (mac ? e.metaKey : e.ctrlKey) ? "side" : "open";
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
export interface Layout {
  split: boolean;
  /** Where the side pane is. */
  at: Dock;
  /** The side pane's share of the width (or the height, docked top or bottom), 0.2 to 0.8. */
  side: number;
  /** Which pane has focus: 0 is the main pane, 1 the side pane. */
  focus: 0 | 1;
  panes: [PaneTrail, PaneTrail];
}

const KEEP = 50;
const empty = (): PaneTrail => ({ note: null, back: [], forward: [] });
export const clampSide = (n: number) => Math.min(0.8, Math.max(0.2, n));
export const newLayout = (): Layout => ({ split: false, at: "right", side: 0.5, focus: 0, panes: [empty(), empty()] });

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

/** A layout read back from storage; anything missing or malformed falls back to one pane. */
export function parseLayout(raw: string | null): Layout {
  const out = newLayout();
  let v: any;
  try {
    v = JSON.parse(raw ?? "null");
  } catch {
    return out;
  }
  if (!v || typeof v !== "object") return out;
  const ids = (l: unknown) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === "string").slice(-KEEP) : []);
  const trail = (t: any): PaneTrail => ({ note: typeof t?.note === "string" ? t.note : null, back: ids(t?.back), forward: ids(t?.forward) });
  const panes: [PaneTrail, PaneTrail] = [trail(v.panes?.[0]), trail(v.panes?.[1])];
  const split = v.split === true && !!panes[1].note;
  return { split, at: DOCKS.includes(v.at) ? v.at : out.at, side: typeof v.side === "number" && Number.isFinite(v.side) ? clampSide(v.side) : out.side, focus: split && v.focus === 1 ? 1 : 0, panes };
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
