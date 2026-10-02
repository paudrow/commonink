// Tabs: the notes kept open in a pane (by ID, so renames don't lose them), in order. Following a
// link or picking a note changes the tab you're on, like a browser; a new tab (⌥↵ in quick open,
// the strip's +, a note dropped on the strip, a middle-click, vim's :tabnew) keeps the one you were
// on. The strip shows once a pane has two.

const KEEP = 30;

/**
 * The tabs once `id` shows in a pane, where `at` is the tab it showed (or showed last, if a page
 * is showing now): a tab it already has stays where it is; a new tab goes after `at`; otherwise
 * `id` takes `at`'s place.
 */
export function openTab(tabs: string[], at: string | null, id: string, asNew: boolean): string[] {
  if (tabs.includes(id)) return tabs;
  const i = at === null ? -1 : tabs.indexOf(at);
  if (i < 0) return [...tabs, id].slice(-KEEP);
  if (asNew) return [...tabs.slice(0, i + 1), id, ...tabs.slice(i + 1)].slice(-KEEP);
  return tabs.map((t, j) => (j === i ? id : t));
}

/** The tabs once `id` closes, and the tab to show instead if it was showing: the one after it, else the one before. */
export function closeTab(tabs: string[], id: string): { tabs: string[]; next: string | null } {
  const i = tabs.indexOf(id);
  if (i < 0) return { tabs, next: null };
  const rest = tabs.filter((t) => t !== id);
  return { tabs: rest, next: rest[Math.min(i, rest.length - 1)] ?? null };
}

/** The tab `by` steps from `id`, wrapping around (vim's gt and gT). */
export function stepTab(tabs: string[], id: string | null, by: number): string | null {
  if (!tabs.length) return null;
  const i = id === null ? -1 : tabs.indexOf(id);
  if (i < 0) return tabs[0];
  return tabs[(((i + by) % tabs.length) + tabs.length) % tabs.length];
}

/** Each pane's tabs read back from storage; anything malformed is none. */
export function parseTabs(raw: unknown): [string[], string[]] {
  const ids = (l: unknown) => (Array.isArray(l) ? [...new Set(l.filter((x): x is string => typeof x === "string"))].slice(-KEEP) : []);
  return Array.isArray(raw) ? [ids(raw[0]), ids(raw[1])] : [[], []];
}
