// A small right-click menu: a tab's (close, close others, pin…), and "Open in new tab" and "Open to
// the side" on a link, a Notes card, a starred note or a page in the sidebar. Arrow keys move,
// Enter picks, Escape (or a click elsewhere) closes it and puts the focus back.
import { el, icon } from "./dom.ts";
import { formatKeys } from "./keys.ts";

export interface MenuItem {
  label: string;
  run: () => unknown;
  icon?: string;
  /** The shortcut, shown on the right ("Mod-w"). */
  keys?: string;
  disabled?: boolean;
}

let open: (() => void) | null = null;

/** Open a menu at (x, y) (a right-click's point, or under a focused element). `null`s are left out, and "-" draws a line. */
export function openMenu(at: { x: number; y: number }, items: Array<MenuItem | "-" | null | false>, opts: { label?: string } = {}) {
  open?.();
  const back = document.activeElement as HTMLElement | null;
  const list = items.filter((i): i is MenuItem | "-" => !!i).filter((i, n, all) => i !== "-" || (n > 0 && n < all.length - 1 && all[n - 1] !== "-"));
  const buttons: HTMLButtonElement[] = [];
  const close = (refocus = true) => {
    menu.remove();
    document.removeEventListener("mousedown", outside, true);
    window.removeEventListener("blur", blur);
    window.removeEventListener("resize", blur);
    open = null;
    if (refocus && back?.isConnected) back.focus({ preventScroll: true });
  };
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close(false);
  const blur = () => close(false);
  const rows = list.map((item) => {
    if (item === "-") return el("div", { class: "menu-sep", role: "separator" });
    const b = el(
      "button",
      {
        type: "button",
        class: "fp-item",
        role: "menuitem",
        disabled: !!item.disabled,
        onclick: () => {
          close();
          void item.run();
        },
      },
      item.icon ? icon(item.icon, 14) : el("span", { class: "menu-ico" }),
      el("span", {}, item.label),
      item.keys ? el("kbd", { class: "menu-keys" }, formatKeys(item.keys)) : null,
    );
    buttons.push(b);
    return b;
  });
  const menu = el("div", { class: "folder-picker menu", role: "menu", "aria-label": opts.label ?? "Actions" }, el("div", { class: "fp-list" }, ...rows));
  menu.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const live = buttons.filter((b) => !b.disabled);
    const i = live.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      live[(i + (e.key === "ArrowDown" ? 1 : live.length - 1)) % live.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      live[e.key === "Home" ? 0 : live.length - 1]?.focus();
    }
  });
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  Object.assign(menu.style, { left: `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`, top: `${Math.max(8, at.y + r.height > innerHeight - 8 ? at.y - r.height : at.y)}px` });
  document.addEventListener("mousedown", outside, true);
  window.addEventListener("blur", blur);
  window.addEventListener("resize", blur);
  open = () => close(false);
  buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
}

/** Where a menu opened from the keyboard (the context-menu key, Shift+F10) goes: under the element. */
export function under(node: Element): { x: number; y: number } {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
}
