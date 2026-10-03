// The keys every list page shares, in one table: j/k move, g/G jump to the ends, Enter opens,
// x selects, / filters, Delete deletes, Esc clears. A page hands listKey the actions it has
// (History deletes nothing, Tags selects nothing) and the shortcut sheet lists the same ones
// (listShortcuts, from commands.ts), so a key can't work on a page without being on the sheet.
import { typingIn } from "./dom.ts";

export type ListAction = "next" | "prev" | "first" | "last" | "open" | "select" | "filter" | "delete" | "clear";

/** What each key does, by the character typed. J and K are j and k with Shift held (History extends its selection with them). */
const ACTION: Record<string, ListAction> = {
  j: "next",
  J: "next",
  ArrowDown: "next",
  k: "prev",
  K: "prev",
  ArrowUp: "prev",
  g: "first",
  G: "last",
  Enter: "open",
  x: "select",
  "/": "filter",
  Delete: "delete",
  Backspace: "delete",
  Escape: "clear",
};

export type ListHandlers = Partial<Record<ListAction, (e: KeyboardEvent) => void>>;

/**
 * Run a list key: true if `e` was one the page has an action for. Never while typing in a field or
 * with ⌘, Ctrl or Alt held, and Enter on a link or button does what that says (a row that is a
 * button opens itself).
 */
export function listKey(e: KeyboardEvent, handlers: ListHandlers): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return false;
  const action = ACTION[e.key];
  const fn = action && handlers[action];
  if (!fn) return false;
  if (action === "open" && (e.target as HTMLElement).closest("a, button, [role=checkbox]")) return false;
  e.preventDefault();
  fn(e);
  return true;
}

/** The sheet's rows for a list's keys, in the order every page lists them. `what` is the thing in the list ("note"). */
const ROWS: Array<{ keys: string[]; actions: ListAction[]; label: (what: string) => string }> = [
  { keys: ["j", "k"], actions: ["next", "prev"], label: (what) => `Next / previous ${what}` },
  { keys: ["g", "G"], actions: ["first", "last"], label: (what) => `First / last ${what}` },
  { keys: ["Enter"], actions: ["open"], label: (what) => `Open the ${what}` },
  { keys: ["x"], actions: ["select"], label: () => "Select" },
  { keys: ["Delete", "Backspace"], actions: ["delete"], label: (what) => `Delete the ${what}` },
  { keys: ["/"], actions: ["filter"], label: () => "Filter" },
  { keys: ["Escape"], actions: ["clear"], label: () => "Clear the selection" },
];

/** The shared keys a page has, as the sheet shows them. `labels` rewords an action's row for the page. */
export function listShortcuts(what: string, actions: ListAction[], labels: Partial<Record<ListAction, string>> = {}): Array<{ keys: string[]; label: string }> {
  return ROWS.filter((r) => r.actions.every((a) => actions.includes(a))).map((r) => ({ keys: r.keys, label: labels[r.actions[0]] ?? r.label(what) }));
}

/**
 * Move the keyboard focus through a list whose rows are focusable (buttons, checkboxes): to the
 * next or previous one, or an end. From outside the list, the first row.
 */
export function stepFocus(rows: HTMLElement[], to: 1 | -1 | "first" | "last") {
  if (!rows.length) return;
  const at = rows.findIndex((r) => r === document.activeElement || r.contains(document.activeElement));
  const i = to === "first" ? 0 : to === "last" ? rows.length - 1 : at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + to));
  rows[i].focus();
  rows[i].scrollIntoView?.({ block: "nearest" });
}
