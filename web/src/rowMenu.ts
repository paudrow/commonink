// A sidebar row's menu: a folder's occasional actions (Export as .zip, Share, Delete) live here rather
// than as buttons on the row. It opens on right-click, from the keyboard with the row focused
// (Shift+F10 or the Menu key), and from the row's ⋯ button on a touch screen, which has neither.
// It looks like the Share menu (share.ts) and moves the same way: arrows, Home/End, Escape.
import { el, icon } from "./dom.ts";

export interface RowMenuItem {
  label: string;
  icon: string;
  run(): unknown;
  /** Set apart at the bottom, in the warning color (Delete). */
  danger?: boolean;
}

let open: { menu: HTMLElement; anchor: HTMLElement; close(refocus: boolean): void } | null = null;

/** Whether the menu is open for `anchor` now. */
export function rowMenuOpenFor(anchor: HTMLElement) {
  return open?.anchor === anchor;
}

/**
 * Open the menu for `anchor` (the row), at the pointer when there is one, else under the row. Focus
 * goes to the first item, and back to the row when Escape closes it.
 */
export function openRowMenu(anchor: HTMLElement, label: string, entries: (RowMenuItem | null)[], at?: { x: number; y: number }) {
  open?.close(false);
  const list = entries.filter((e): e is RowMenuItem => !!e);
  if (!list.length) return;
  const item = (it: RowMenuItem) =>
    el(
      "button",
      {
        type: "button",
        role: "menuitem",
        tabindex: "-1",
        class: `share-item${it.danger ? " is-danger" : ""}`,
        onclick: () => {
          close(false);
          void it.run();
        },
      },
      icon(it.icon, 15),
      el("span", {}, it.label),
    );
  const plain = list.filter((it) => !it.danger);
  const danger = list.filter((it) => it.danger);
  const menu = el(
    "div",
    { class: "share-menu row-menu", role: "menu", "aria-label": label },
    ...plain.map(item),
    plain.length && danger.length ? el("div", { class: "share-sep", role: "separator" }) : null,
    ...danger.map(item),
  );
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>(".share-item")];
  menu.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the sidebar's own keys (and Vim's) stay out of it
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  });
  const outside = (e: Event) => !menu.contains(e.target as Node) && close(false);
  const away = () => close(false);
  function close(refocus: boolean) {
    if (open?.menu !== menu) return;
    open = null;
    menu.remove();
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("blur", away);
    window.removeEventListener("resize", away);
    if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  document.body.append(menu);
  place(menu, anchor, at);
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("blur", away);
  window.addEventListener("resize", away);
  open = { menu, anchor, close };
  items()[0]?.focus({ preventScroll: true });
}

/** At the pointer, or under the row's left edge from the keyboard; kept on screen. */
function place(menu: HTMLElement, anchor: HTMLElement, at?: { x: number; y: number }) {
  const r = anchor.getBoundingClientRect();
  const x = at?.x ?? r.left + 24;
  const y = at?.y ?? r.bottom + 2;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, y + h > window.innerHeight - 8 ? (at ? y - h : r.top - h - 2) : y)}px`;
}

/**
 * Wire `row` to open its menu: right-click (or a long press, where the browser makes one a
 * contextmenu), and Shift+F10 or the Menu key while the row has focus. `entries` is asked each time,
 * so it's what applies now.
 */
export function rowMenu(row: HTMLElement, label: string, entries: () => (RowMenuItem | null)[]) {
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // From the keyboard (the Menu key) there's no pointer: Chrome and Firefox say so with 0, 0.
    const pointer = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined;
    if (!pointer && rowMenuOpenFor(row)) return; // Shift+F10 opened it already
    openRowMenu(row, label, entries(), pointer);
  });
  row.addEventListener("keydown", (e) => {
    if (e.target !== row) return;
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      e.stopPropagation();
      openRowMenu(row, label, entries());
    }
  });
}
