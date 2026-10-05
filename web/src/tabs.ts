// Tabs, like an editor's: each pane is a group of tabs, with a tab strip over it. A tab is a note
// (by ID, so renames don't lose it) or, in the main pane where pages show, a page (Notes, Today, a
// folder… by its address, see pageEntry). Each tab has its own back and forward (a PaneTrail), so
// following a link changes the tab you're on and back comes back, as in a browser; a new tab (⌘-click,
// a middle-click, ⌘T, a drop on the strip) keeps the one you were on. Pinned tabs stay first and
// keep their note: what you open from one opens in a new tab. No DOM here: main.ts draws the strips,
// and the layout of the window (split, where, how big) is kept here with the tabs.
//
// As in VS Code, a tab you only looked at is a preview (its name in italics): the next thing you
// open replaces it, so clicking down the sidebar doesn't pile up tabs or write over the tab you
// were working in. Editing the note, double-clicking the tab, pinning it or moving it keeps it.

import { clampSide, DOCKS, forget, pageOf, parseTrail, visit, type Dock, type PaneTrail } from "./panes.ts";

export interface Tab extends PaneTrail {
  pinned?: boolean;
  /** Only looked at: the next note or page opened here takes its place. A pane has at most one. */
  preview?: boolean;
}
/** A pane's tabs, pinned ones first, and which one shows (`at`, -1 with none). */
export interface Group {
  tabs: Tab[];
  at: number;
}

/** A pane keeps at most this many tabs: past it, the leftmost that isn't pinned or showing closes. */
export const MAX_TABS = 40;
export const emptyGroup = (): Group => ({ tabs: [], at: -1 });
/** The tab showing, if any. */
export const currentTab = (g: Group): Tab | null => g.tabs[g.at] ?? null;
/** Where the tab for a note (by ID) or page (by its entry) is, or -1. */
export const tabIndex = (g: Group, entry: string) => g.tabs.findIndex((t) => t.note === entry);
const pinnedCount = (tabs: Tab[]) => tabs.filter((t) => t.pinned).length;
/** A tab with only its trail and its pin: a preview becomes a tab that's kept. */
const trailOf = (t: Tab): Tab => (t.pinned ? { note: t.note, back: t.back, forward: t.forward, pinned: true } : { note: t.note, back: t.back, forward: t.forward });
/** A tab's trail changed, keeping its pin and whether it's a preview. */
const withTrail = (t: Tab, trail: PaneTrail): Tab => ({ note: trail.note, back: trail.back, forward: trail.forward, ...(t.pinned && { pinned: true }), ...(t.preview && { preview: true }) });
/** Where the pane's preview tab is, or -1. */
export const previewIndex = (g: Group) => g.tabs.findIndex((t) => t.preview);
/** Keep the tab at `i`: it's no longer a preview. */
export function keepTab(g: Group, i: number): Group {
  const t = g.tabs[i];
  return t?.preview ? { ...g, tabs: g.tabs.map((x, j) => (j === i ? trailOf(x) : x)) } : g;
}

/** A position to put a tab at, kept so pinned tabs stay first: a pinned tab among the pinned, any other after them. */
function clampIndex(tabs: Tab[], index: number, pinned: boolean): number {
  const n = pinnedCount(tabs);
  return pinned ? Math.min(Math.max(0, index), n) : Math.min(Math.max(n, index), tabs.length);
}

/** Show `tab` as a new tab before position `index` (by default, after the one showing). A new preview tab replaces the old one. */
export function insertTab(g: Group, tab: Tab, index = g.at >= 0 ? g.at + 1 : g.tabs.length): Group {
  const i = clampIndex(g.tabs, index, !!tab.pinned);
  const tabs = [...g.tabs.slice(0, i), tab, ...g.tabs.slice(i)].map((t) => (t !== tab && t.preview && tab.preview ? trailOf(t) : t));
  let at = i;
  while (tabs.length > MAX_TABS) {
    const drop = tabs.findIndex((t, j) => !t.pinned && j !== at);
    if (drop < 0) break;
    tabs.splice(drop, 1);
    if (drop < at) at--;
  }
  return { tabs, at };
}

/** Show the tab at `i`. */
export const showTab = (g: Group, i: number): Group => (g.tabs[i] ? { ...g, at: i } : g);

/**
 * Show a note or page (`entry`) in a group. A tab that has it already shows (moved to `index`, if
 * given, as a drop on the strip does). Otherwise `here` opens it as a preview, as VS Code does: in
 * the preview tab (the one showing if it's a preview, else the pane's other preview tab), with
 * what that showed on its back list; with no preview tab, in a new preview tab after the one
 * showing, whose back goes to the tab you were on. `new` (or a drop, with `index`) opens a tab
 * that's kept, before `index` (by default after the one showing).
 */
export function openEntry(g: Group, entry: string, how: "here" | "new" = "here", index?: number): Group {
  const have = tabIndex(g, entry);
  if (have >= 0) return index === undefined ? showTab(g, have) : moveTab(showTab(g, have), have, index);
  if (how === "new" || index !== undefined) return insertTab(g, { note: entry, back: [], forward: [] }, index);
  const cur = currentTab(g);
  const p = cur?.preview ? g.at : previewIndex(g);
  if (p >= 0) return { tabs: g.tabs.map((t, i) => (i === p ? withTrail(t, visit(t, entry)) : t)), at: p };
  return insertTab(g, { note: entry, back: cur?.note ? [cur.note] : [], forward: [], preview: true });
}

/** The showing tab with its trail changed (a step back or forward), or a new tab with it if none shows. */
export function setTrail(g: Group, trail: PaneTrail): Group {
  const cur = currentTab(g);
  if (!cur) return insertTab(g, { note: trail.note, back: trail.back, forward: trail.forward }, g.tabs.length);
  return { ...g, tabs: g.tabs.map((t, i) => (i === g.at ? withTrail(t, trail) : t)) };
}

/** Move the tab at `from` to before position `before` (as the strip numbers them before the move), keeping pinned tabs first. */
export function moveTab(g: Group, from: number, before: number): Group {
  const t = g.tabs[from];
  if (!t) return g;
  const rest = g.tabs.filter((_, i) => i !== from);
  const i = clampIndex(rest, before > from ? before - 1 : before, !!t.pinned);
  const kept = trailOf(t); // a tab you moved is one you want: no longer a preview
  const tabs = [...rest.slice(0, i), kept, ...rest.slice(i)];
  const shown = g.tabs[g.at] === t ? kept : g.tabs[g.at];
  return { tabs, at: shown ? tabs.indexOf(shown) : -1 };
}
/** Move a tab one place left (-1) or right (1): ⌘⇧PageUp and ⌘⇧PageDown. */
export const nudgeTab = (g: Group, i: number, by: -1 | 1): Group => moveTab(g, i, by < 0 ? i - 1 : i + 2);

/**
 * Close the tabs at these positions. If the one showing closes, the nearest one left open to its
 * right shows, else to its left (none: `at` is -1). `closed` are the tabs that went, to reopen.
 */
export function closeTabs(g: Group, which: number[]): { group: Group; closed: Tab[] } {
  const gone = new Set(which.filter((i) => g.tabs[i]));
  if (!gone.size) return { group: g, closed: [] };
  const tabs = g.tabs.filter((_, i) => !gone.has(i));
  const closed = g.tabs.filter((_, i) => gone.has(i));
  const index = (j: number) => tabs.indexOf(g.tabs[j]);
  let at = g.at < 0 ? -1 : index(g.at);
  if (gone.has(g.at)) {
    let j = g.at + 1;
    while (j < g.tabs.length && gone.has(j)) j++;
    if (j < g.tabs.length) at = index(j);
    else {
      j = g.at - 1;
      while (j >= 0 && gone.has(j)) j--;
      at = j >= 0 ? index(j) : -1;
    }
  }
  return { group: { tabs, at }, closed };
}
/** Close every tab but the one at `i` and the pinned ones; `i` shows. */
export function closeOthers(g: Group, i: number): { group: Group; closed: Tab[] } {
  const keep = g.tabs[i];
  const r = closeTabs(g, g.tabs.flatMap((t, j) => (j === i || t.pinned ? [] : [j])));
  return { ...r, group: { ...r.group, at: keep ? r.group.tabs.indexOf(keep) : r.group.at } };
}
/** Close every tab that isn't pinned (VS Code's Close All). */
export const closeAll = (g: Group): { group: Group; closed: Tab[] } => closeTabs(g, g.tabs.flatMap((t, j) => (t.pinned ? [] : [j])));
/** Close the tabs to the right of `i` that aren't pinned; `i` shows if the one showing closed. */
export function closeToRight(g: Group, i: number): { group: Group; closed: Tab[] } {
  const keep = g.tabs[i];
  const r = closeTabs(g, g.tabs.flatMap((t, j) => (j > i && !t.pinned ? [j] : [])));
  return { ...r, group: g.at > i && !g.tabs[g.at]?.pinned && keep ? { ...r.group, at: r.group.tabs.indexOf(keep) } : r.group };
}

/** Pin (or unpin) the tab at `i`: pinned, it goes to the end of the pinned tabs; unpinned, to the start of the rest. */
export function pinTab(g: Group, i: number, on: boolean): Group {
  const t = g.tabs[i];
  if (!t || !!t.pinned === on) return g;
  const shown = g.tabs[g.at];
  const next: Tab = on ? { ...trailOf(t), pinned: true } : { note: t.note, back: t.back, forward: t.forward };
  const rest = g.tabs.filter((_, j) => j !== i);
  const at = pinnedCount(rest);
  const tabs = [...rest.slice(0, at), next, ...rest.slice(at)];
  return { tabs, at: shown === t ? at : shown ? tabs.indexOf(shown) : -1 };
}

/** The tab `by` places from the one showing, wrapping around (⌃Tab, ⌃⇧Tab, vim's gt and gT), or -1 with none. */
export function stepIndex(g: Group, by: number): number {
  const n = g.tabs.length;
  if (!n) return -1;
  if (g.at < 0) return 0;
  return (((g.at + by) % n) + n) % n;
}
/** The tab ⌘1…⌘8 picks (the first eight), and ⌘9 (the last), or -1. */
export const jumpIndex = (g: Group, n: number): number => (n === 9 ? g.tabs.length - 1 : n >= 1 && n <= g.tabs.length ? n - 1 : -1);

/**
 * Take the tab at `i` out of one group and show it in another, before `before` (by default after
 * the tab showing there), with its back and forward. If the other group has that note already, its
 * tab shows instead. The first group shows its nearest tab, as closing does.
 */
export function takeTab(from: Group, i: number, to: Group, before?: number): { from: Group; to: Group } {
  const t = from.tabs[i];
  if (!t) return { from, to };
  const rest = closeTabs(from, [i]).group;
  const have = tabIndex(to, t.note ?? "");
  if (have >= 0) return { from: rest, to: before === undefined ? showTab(to, have) : moveTab(showTab(to, have), have, before) };
  return { from: rest, to: insertTab(to, trailOf(t), before) };
}

/** A group without a note that's gone (deleted, or one the other pane now has): its tab closes, and it drops out of the others' back and forward. */
export function forgetEntry(g: Group, entry: string): Group {
  const { group } = closeTabs(
    g,
    g.tabs.flatMap((t, i) => (t.note === entry ? [i] : [])),
  );
  return { ...group, tabs: group.tabs.map((t) => withTrail(t, forget(t, entry))) };
}

// ------------------------------------------------------------------ the layout, kept per workspace

export interface Layout {
  split: boolean;
  /** Where the side pane is. */
  at: Dock;
  /** The side pane's share of the width (or the height, docked top or bottom), 0.2 to 0.8. */
  side: number;
  /** Which pane has focus: 0 is the main pane, 1 the side pane. */
  focus: 0 | 1;
  /** Each pane's tabs: the main pane's, then the side pane's (notes only: pages show in the main pane). */
  groups: [Group, Group];
}
export const newLayout = (): Layout => ({ split: false, at: "right", side: 0.5, focus: 0, groups: [emptyGroup(), emptyGroup()] });

/** A group read back from storage: tabs without an entry, repeats, and (`notesOnly`) pages drop out; pinned tabs go first. */
export function parseGroup(raw: any, notesOnly = false): Group {
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  let at = -1;
  const list: unknown[] = Array.isArray(raw?.tabs) ? raw.tabs : [];
  list.forEach((t: any, i) => {
    const trail = parseTrail(t);
    if (!trail.note || seen.has(trail.note) || (notesOnly && pageOf(trail.note) !== null)) return;
    seen.add(trail.note);
    if (i === raw.at) at = tabs.length;
    tabs.push(t?.pinned === true ? { ...trail, pinned: true } : t?.preview === true && !tabs.some((x) => x.preview) ? { ...trail, preview: true } : trail);
  });
  const shown = tabs[at];
  const sorted = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)].slice(0, MAX_TABS);
  const i = shown ? sorted.indexOf(shown) : -1;
  return { tabs: sorted, at: i >= 0 ? i : sorted.length ? 0 : -1 };
}

/**
 * A layout read back from storage; anything missing or malformed falls back to one pane. One kept
 * before tabs (each pane's back and forward, `panes`) becomes a tab per pane, and `oldTabs` (the
 * notes each pane had as tabs before each tab had its own back and forward) the tabs around it.
 */
export function parseLayout(raw: string | null, oldTabs?: unknown): Layout {
  const out = newLayout();
  let v: any;
  try {
    v = JSON.parse(raw ?? "null");
  } catch {
    return out;
  }
  if (!v || typeof v !== "object") return out;
  const migrate = (i: 0 | 1): Group => {
    const trail = parseTrail(v.panes?.[i]);
    const ids = Array.isArray(oldTabs) && Array.isArray(oldTabs[i]) ? (oldTabs[i] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const tabs: Tab[] = ids.map((id) => (id === trail.note ? trail : { note: id, back: [], forward: [] }));
    if (trail.note && !ids.includes(trail.note)) tabs.push(trail);
    return parseGroup({ tabs, at: trail.note ? tabs.findIndex((t) => t.note === trail.note) : tabs.length - 1 }, i === 1);
  };
  const groups: [Group, Group] = Array.isArray(v.groups) ? [parseGroup(v.groups[0]), parseGroup(v.groups[1], true)] : [migrate(0), migrate(1)];
  const split = v.split === true && !!currentTab(groups[1]);
  return {
    split,
    at: DOCKS.includes(v.at) ? v.at : out.at,
    side: typeof v.side === "number" && Number.isFinite(v.side) ? clampSide(v.side) : out.side,
    focus: split && v.focus === 1 ? 1 : 0,
    groups,
  };
}
