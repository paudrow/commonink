// What every "type to find one, then pick it" list shares: the fuzzy match, the arrow keys, Enter
// and Escape, the row that's lit, and what the list says when nothing fits. The folder, tag,
// template, contact, code-language and task pickers each draw their own rows (and their own
// "New …" row) and hand them here. Also the arrow keys of a popover that's only buttons.
import { el } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";

/**
 * The `items` that `query` fits, best match first; with nothing typed, all of them as they came.
 * `text` is what an item is matched on (several, and the best one counts: a contact's name and
 * emails). `tie` orders equal matches; without it they stay in the order given.
 */
export function fuzzyRank<T>(query: string, items: readonly T[], text: (item: T) => string | string[], tie?: (a: T, b: T) => number): T[] {
  const q = query.trim();
  if (!q) return [...items];
  return items
    .map((item, at) => ({ item, at, s: Math.max(-1, ...[text(item)].flat().map((t) => fuzzyScore(q, t))) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || tie?.(a.item, b.item) || a.at - b.at)
    .map((x) => x.item);
}

/** Where an arrow key goes from row `active` of `count`: round the ends, and from no row (-1) to the first or last. */
export function stepActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (!count) return -1;
  if (active < 0) return key === "ArrowDown" ? 0 : count - 1;
  return (active + (key === "ArrowDown" ? 1 : count - 1)) % count;
}

let made = 0;

export interface ListPickerOptions {
  /** The box that's typed in. It keeps the focus; the lit row is told to screen readers through it. */
  input: HTMLInputElement;
  list: HTMLElement;
  /** The rows for what's typed. Buttons are the options (a click picks one); anything else (a line) is drawn and skipped. */
  rows(q: string): Array<HTMLElement | null | false>;
  /** What the list says when there's no option. */
  empty?(q: string): string | HTMLElement | null;
  /** Which option is lit first (0). -1 lights none until an arrow key, so a bare Enter picks nothing. */
  start?(options: HTMLElement[], q: string): number;
  /** Enter, with the lit option if there is one. Left out, Enter clicks it. */
  enter?(option: HTMLElement | undefined): void;
  /** Escape. Left out, Escape is someone else's (the dialog the list is in). */
  close?(): void;
}

/**
 * Wire `input` and `list` up as a picker: Down and Up move the lit row (round the ends, and into
 * view), Enter picks it, Escape closes, and the pointer lights the row it's over. `render` draws
 * the rows again and keeps the lit one where it was; typing starts again from the top.
 */
export function listPicker(o: ListPickerOptions): { render(): void; active(): HTMLElement | undefined } {
  const id = `picker-${++made}`;
  let options: HTMLElement[] = [];
  let active = 0;
  o.list.id ||= `${id}-list`;
  o.list.setAttribute("role", "listbox");
  for (const [k, v] of Object.entries({ role: "combobox", "aria-autocomplete": "list", "aria-expanded": "true", "aria-controls": o.list.id })) o.input.setAttribute(k, v);

  const light = (i: number, show = false) => {
    active = i;
    options.forEach((row, n) => {
      row.classList.toggle("is-active", n === i);
      row.setAttribute("aria-selected", String(n === i));
    });
    const row = options[i];
    if (row) o.input.setAttribute("aria-activedescendant", row.id);
    else o.input.removeAttribute("aria-activedescendant");
    if (show) row?.scrollIntoView?.({ block: "nearest" });
  };
  const draw = (fresh: boolean) => {
    const q = o.input.value;
    const rows = o.rows(q).filter((r): r is HTMLElement => !!r);
    options = rows.filter((r) => r.tagName === "BUTTON");
    options.forEach((row, i) => {
      row.id = `${id}-${i}`;
      row.setAttribute("role", "option");
      row.addEventListener("mousemove", () => i !== active && light(i));
    });
    const none = options.length ? null : (o.empty?.(q) ?? null);
    o.list.replaceChildren(...rows, ...(none === null ? [] : [typeof none === "string" ? el("div", { class: "fp-empty" }, none) : none]));
    light(fresh ? (o.start?.(options, q) ?? 0) : Math.min(active, options.length - 1));
  };

  o.input.addEventListener("input", () => draw(true));
  o.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      light(stepActive(active, options.length, e.key), true);
    } else if (e.key === "Enter") {
      e.preventDefault(); // the Enter is the pick's, not whatever takes the focus next
      if (o.enter) o.enter(options[active]);
      else options[active]?.click();
    } else if (e.key === "Escape" && o.close) {
      e.preventDefault();
      e.stopPropagation(); // closes the picker, not the dialog it's over
      o.close();
    }
  });
  draw(true);
  return { render: () => draw(false), active: () => options[active] };
}

/**
 * The arrow keys of a popover that's only buttons (a menu, a chip's quick picks): Down and Up move
 * the focus round the buttons matching `selector`, Home and End go to the first and last, and with
 * `sideways` Right and Left move too (a row of swatches). A key a field handles itself (a date's
 * arrows, a picker's) is left to it. True if the key was used.
 */
export function arrowFocus(box: HTMLElement, e: KeyboardEvent, selector = "button", o: { sideways?: boolean } = {}): boolean {
  const at = e.target as HTMLElement | null;
  if (e.defaultPrevented || (at && /^(INPUT|SELECT|TEXTAREA)$/.test(at.tagName))) return false;
  const next = e.key === "ArrowDown" || (o.sideways && e.key === "ArrowRight");
  const back = e.key === "ArrowUp" || (o.sideways && e.key === "ArrowLeft");
  if (!next && !back && e.key !== "Home" && e.key !== "End") return false;
  const live = [...box.querySelectorAll<HTMLButtonElement>(selector)].filter((b) => !b.disabled);
  if (!live.length) return false;
  e.preventDefault();
  const i = live.indexOf(document.activeElement as HTMLButtonElement);
  const to = e.key === "Home" ? 0 : e.key === "End" ? live.length - 1 : i < 0 ? (next ? 0 : live.length - 1) : (i + (next ? 1 : live.length - 1)) % live.length;
  live[to].focus();
  return true;
}
