// Split view: the notes the two panes show, each with its own back and forward, and how the
// window is divided. Kept per viewer in browser storage; the app works the same without it.
// No DOM here: the app shell (main.ts) draws the panes.

/** One pane's place: the note it shows (by ID, so renames don't lose it) and where it's been. */
export interface PaneTrail {
  note: string | null;
  back: string[];
  forward: string[];
}
export interface Layout {
  split: boolean;
  /** The side pane's share of the width, 0.2 to 0.8. */
  side: number;
  /** Which pane has focus: 0 is the main pane, 1 the side pane. */
  focus: 0 | 1;
  panes: [PaneTrail, PaneTrail];
}

const KEEP = 50;
const empty = (): PaneTrail => ({ note: null, back: [], forward: [] });
export const clampSide = (n: number) => Math.min(0.8, Math.max(0.2, n));
export const newLayout = (): Layout => ({ split: false, side: 0.5, focus: 0, panes: [empty(), empty()] });

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
  return { split, side: typeof v.side === "number" && Number.isFinite(v.side) ? clampSide(v.side) : out.side, focus: split && v.focus === 1 ? 1 : 0, panes };
}
