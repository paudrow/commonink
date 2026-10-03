// The shortcut sheet (? or "Keyboard shortcuts" in ⌘K): every shortcut, by where it works.
import { shortcutSheet, type Command } from "./commands.ts";
import { kbd } from "./keys.ts";
import { el } from "./dom.ts";
import { IS_MAC } from "./panes.ts";
import { openModal } from "./modal.ts";

let closeOpen: (() => void) | null = null;

/** Open the sheet, or close it if it's open. Vim's keys fold away while vim is off. */
export function toggleShortcuts(commands: Command[], opts: { vim: boolean; mac?: boolean }) {
  if (closeOpen) return closeOpen();
  const mac = opts.mac ?? IS_MAC;
  const keys = (list: string[]) => list.flatMap((k, i) => [i ? el("span", { class: "sc-or" }, "/") : null, kbd(k, mac)]);
  const sections = shortcutSheet(commands).map(({ area, shortcuts }) => {
    const rows = el("dl", { class: "sc-list" }, ...shortcuts.flatMap((s) => [el("dt", {}, ...keys(s.keys)), el("dd", {}, s.label)]));
    if (area !== "Vim") return el("section", { class: "sc-area" }, el("h3", {}, area), rows);
    return el("details", { class: "sc-area", open: opts.vim }, el("summary", {}, opts.vim ? "Vim" : "Vim (off)"), rows);
  });
  const m = openModal({
    title: "Keyboard shortcuts",
    icon: "keyboard",
    content: [el("div", { class: "sc-grid" }, ...sections)],
    id: "shortcuts",
    pageClass: "",
    boxClass: "sc-box",
    headClass: "sc-head",
    titleId: "sc-title",
    onClose: () => (closeOpen = null),
  });
  closeOpen = m.close;
}
