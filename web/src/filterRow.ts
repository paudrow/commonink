// One filter row for every list page: a "Filter <things>…" box with a / hint (and / to reach it), the
// sort at the box's right with the same names on every page, and a segmented control for a short
// pick-one set. The "# Tag" chip beside them is tagPicker.ts's tagFilter.
import { el, icon } from "./dom.ts";
import type { QuerySort } from "../../src/core/query.ts";

/** What the orders every list shares are called. */
export const SORT_NAMES = { newest: "Newest", oldest: "Oldest", name: "Name" } as const;
/** The orders of a list of notes: on Notes, in a view's editor and in a view in a note. */
export const NOTE_SORTS: Array<[QuerySort, string]> = [
  ["modified", "Recently changed"],
  ["created", "Recently created"],
  ["date", SORT_NAMES.newest],
  ["oldest", SORT_NAMES.oldest],
  ["title", SORT_NAMES.name],
];

export interface FilterBoxOptions {
  /** The box's own input, when the page made one (Assets' suggests as you type). */
  input?: HTMLInputElement;
  /** The page's own class, beside `feed-search`. */
  class?: string;
  /** What sits in the box after the input: a help link, the sort (last), a popup. */
  tools?: Array<HTMLElement | null | false | "">;
}

/** The box: a magnifier, "Filter <things>…", the page's tools, then the / hint (hidden on a phone). */
export function filterBox(things: string, o: FilterBoxOptions = {}): { root: HTMLElement; input: HTMLInputElement } {
  const input = o.input ?? el("input", {});
  for (const [k, v] of Object.entries({ placeholder: `Filter ${things}…`, "aria-label": `Filter ${things}`, spellcheck: "false", autocomplete: "off" })) input.setAttribute(k, v);
  const tools = (o.tools ?? []).filter((t): t is HTMLElement => !!t);
  const root = el("label", { class: o.class ? `feed-search ${o.class}` : "feed-search" }, icon("search", 16), input, ...tools, el("kbd", { title: "Press / to filter" }, "/"));
  return { root, input };
}

/** The sort: a borderless menu, for the right of the filter box. */
export function sortSelect<T extends string>(options: ReadonlyArray<readonly [T, string]>, value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el("select", { class: "qt-select feed-sort", "aria-label": "Sort" }, ...options.map(([v, label]) => el("option", { value: v }, label)));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value as T));
  return s;
}

/** A segmented control: a few choices, one of them on. */
export function segmented<T extends string>(o: {
  label: string;
  class?: string;
  current: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string; icon?: string }>;
  onPick(v: T): void;
}): HTMLElement {
  return el(
    "div",
    { class: o.class ? `seg ${o.class}` : "seg", role: "group", "aria-label": o.label },
    ...o.options.map((x) =>
      el(
        "button",
        { type: "button", class: x.value === o.current ? "is-on" : "", "aria-pressed": String(x.value === o.current), ...(x.title && { title: x.title }), onclick: () => x.value !== o.current && o.onPick(x.value) },
        x.icon ? icon(x.icon, 12) : null,
        x.label,
      ),
    ),
  );
}

/**
 * / goes to the page's filter box, from anywhere on the page that isn't a field. A page opens with
 * its list in focus, not the box (on a phone that would raise the keyboard), so / is how to reach it.
 * Returns how to stop, for a page that draws itself again on each visit (Tasks).
 */
export function slashToFilter(root: HTMLElement, input: HTMLInputElement): () => void {
  return pageKey(root, "/", () => input.isConnected && (input.focus(), true));
}

/**
 * A plain key (no ⌘, Ctrl or Alt) on a page, from anywhere on it that isn't a field: `run` says
 * whether it took the key. Returns how to stop listening.
 */
export function pageKey(root: HTMLElement, key: string, run: () => boolean): () => void {
  const on = (e: KeyboardEvent) => {
    if (e.key !== key || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || root.hidden) return;
    const at = e.target as HTMLElement | null;
    if (!at || (at !== document.body && !root.contains(at)) || at.closest("input, textarea, select, [contenteditable]")) return;
    if (run()) e.preventDefault();
  };
  document.addEventListener("keydown", on);
  return () => document.removeEventListener("keydown", on);
}
