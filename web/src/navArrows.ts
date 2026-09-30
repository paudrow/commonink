// Back and forward arrows, like a browser's: in the top bar (for the focused pane) and in each split
// pane's bar. They step a pane's trail the way ⌘[ ⌘] and vim's Ctrl-O Ctrl-I do. With nowhere to
// go one is marked aria-disabled, and stays reachable with Tab. Right-click or a long press lists
// the trail that way, nearest first, to jump several steps at once.
import { el, icon, setLabel } from "./dom.ts";

export type Dir = "back" | "forward";
export interface NavState {
  /** What's that way, nearest first (titles). */
  back: string[];
  forward: string[];
  /** Each arrow's label, with its shortcut. */
  labels: Record<Dir, string>;
}
export interface NavArrows {
  el: HTMLElement;
  update(state: NavState): void;
}

const LONG_PRESS = 500;
const MAX_ITEMS = 12;

/**
 * The two arrows. `go` steps the pane `steps` times that way (resolving once it's there). `small` is
 * the split panes' size.
 */
export function navArrows(go: (dir: Dir, steps: number) => unknown, opts: { small?: boolean } = {}): NavArrows {
  let state: NavState = { back: [], forward: [], labels: { back: "Back", forward: "Forward" } };
  const arrow = (dir: Dir) => {
    const button = el("button", { type: "button", class: `icon-btn nav-arrow${opts.small ? " small" : ""}`, "data-dir": dir }, icon(dir === "back" ? "arrowLeft" : "arrowRight", opts.small ? 14 : 16));
    let timer = 0;
    let pressed = false; // a long press opened the menu: the click that ends it isn't a step
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pressed) return void (pressed = false);
      if (!state[dir].length) return;
      // From the keyboard (Enter or Space: no pointer, so no click count), the focus comes back to
      // the arrow once the note has opened, so the next press steps again.
      const keyboard = e.detail === 0;
      void Promise.resolve(go(dir, 1)).then(() => keyboard && button.isConnected && button.focus({ preventScroll: true }));
    });
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      trail(button, dir);
    });
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        pressed = true;
        trail(button, dir);
      }, LONG_PRESS);
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(type, () => clearTimeout(timer));
    return button;
  };
  const back = arrow("back");
  const forward = arrow("forward");

  /** The trail that way, under the arrow; picking one goes there. */
  function trail(anchor: HTMLElement, dir: Dir) {
    document.querySelector(".nav-trail")?.remove();
    const titles = state[dir].slice(0, MAX_ITEMS);
    if (!titles.length) return;
    const close = () => {
      menu.remove();
      document.removeEventListener("mousedown", outside, true);
    };
    const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close();
    const items = titles.map((title, i) =>
      el("button", { type: "button", class: "fp-item", role: "menuitem", onclick: () => (close(), anchor.focus({ preventScroll: true }), go(dir, i + 1)) }, title),
    );
    const menu = el("div", { class: "folder-picker chip-pop nav-trail", role: "menu", "aria-label": dir === "back" ? "Go back to" : "Go forward to" }, el("div", { class: "fp-list" }, ...items));
    menu.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        close();
        anchor.focus({ preventScroll: true });
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    });
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(12, Math.min(r.left, window.innerWidth - 272))}px` });
    document.addEventListener("mousedown", outside, true);
    document.body.append(menu);
    items[0].focus();
  }

  return {
    el: el("span", { class: "nav-arrows" }, back, forward),
    update(next) {
      state = next;
      for (const [button, dir] of [[back, "back"], [forward, "forward"]] as const) {
        setLabel(button, state.labels[dir]);
        button.setAttribute("aria-disabled", String(!state[dir].length));
      }
    },
  };
}
