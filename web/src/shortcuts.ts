// The shortcut sheet (? or "Keyboard shortcuts" in ⌘K): every shortcut, by where it works.
import { shortcutSheet, type Command } from "./commands.ts";
import { kbd } from "./keys.ts";
import { el, icon } from "./dom.ts";
import { IS_MAC } from "./panes.ts";
import { trapKeys } from "./modal.ts";

let closeOpen: (() => void) | null = null;

/** Open the sheet, or close it if it's open. Vim's keys fold away while vim is off. */
export function toggleShortcuts(commands: Command[], opts: { vim: boolean; mac?: boolean }) {
  if (closeOpen) return closeOpen();
  const mac = opts.mac ?? IS_MAC;
  const back = document.activeElement as HTMLElement | null;
  const keys = (list: string[]) => list.flatMap((k, i) => [i ? el("span", { class: "sc-or" }, "/") : null, kbd(k, mac)]);
  const sections = shortcutSheet(commands).map(({ area, shortcuts }) => {
    const rows = el("dl", { class: "sc-list" }, ...shortcuts.flatMap((s) => [el("dt", {}, ...keys(s.keys)), el("dd", {}, s.label)]));
    if (area !== "Vim") return el("section", { class: "sc-area" }, el("h3", {}, area), rows);
    return el("details", { class: "sc-area", open: opts.vim }, el("summary", {}, opts.vim ? "Vim" : "Vim (off)"), rows);
  });
  const close = () => {
    page.remove();
    closeOpen = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const box = el(
    "div",
    { class: "sc-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "sc-title", tabindex: "-1" },
    el("div", { class: "sc-head" }, icon("keyboard", 16), el("h2", { id: "sc-title" }, "Keyboard shortcuts"), el("button", { class: "icon-btn small", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: close }, icon("close", 15))),
    el("div", { class: "sc-grid" }, ...sections),
  );
  const page = el("div", { id: "shortcuts", onmousedown: (e: Event) => e.target === page && close() }, box);
  trapKeys(page, box, close);
  document.body.append(page);
  box.focus();
  closeOpen = close;
}
