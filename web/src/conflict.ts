// Overlapping edits: someone changed the note while you were typing, and the two can't be merged.
// The banner offers Keep mine, Use theirs, or Compare, which shows the two versions as a diff
// with the same two choices. Whichever side you drop can come back: theirs is saved in History,
// and the toast after either choice has an Undo.
import { el, icon } from "./dom.ts";
import { renderDiff } from "./diff.ts";
import { hideBanner, onBannerGone, showAlert } from "./banner.ts";

export interface Conflict {
  /** Who made the other change: "Claude for Audrow", "Another window". */
  who: string;
  /** "this note", or its name when two notes are open. */
  where: string;
  /** The editor's text now. */
  mine(): string;
  theirs: string;
  keepMine(): void;
  useTheirs(): void;
}

const KEEP_TITLE = "Save your version. Theirs stays in History.";
const USE_TITLE = "Put their version in the editor. Undo brings yours back.";

let open: HTMLDialogElement | null = null;

export function showConflict(c: Conflict) {
  const keep = () => (hideBanner(), c.keepMine());
  const use = () => (hideBanner(), c.useTheirs());
  showAlert(
    `${c.who} changed ${c.where} while you were typing, and the edits overlap.`,
    ["Compare", () => compare(c, keep, use), "Show how the two versions differ"],
    ["Keep mine", keep, KEEP_TITLE],
    ["Use theirs", use, USE_TITLE],
  );
  onBannerGone(closeCompare);
}

function closeCompare() {
  open?.close();
  open?.remove();
  open = null;
}

function compare(c: Conflict, keep: () => void, use: () => void) {
  closeCompare();
  const box = el(
    "div",
    { class: "conflict-box" },
    el(
      "header",
      { class: "conflict-head" },
      icon("info", 16),
      el("h2", { id: "conflict-title" }, `Your version and ${c.who}'s`),
      el("button", { class: "icon-btn small", type: "button", title: "Close", "aria-label": "Close", onclick: closeCompare }, icon("close", 15)),
    ),
    el("p", { class: "conflict-key" }, el("span", { class: "conflict-del" }, "− only in theirs"), el("span", { class: "conflict-add" }, "+ only in yours")),
    el("div", { class: "conflict-diff" }, renderDiff(c.theirs, c.mine())),
    el("p", { class: "conflict-note" }, "Their version is saved in History either way. If you use theirs, Undo brings yours back."),
    el(
      "footer",
      { class: "conflict-foot" },
      el("button", { class: "banner-btn", type: "button", title: KEEP_TITLE, onclick: keep }, "Keep mine"),
      el("button", { class: "banner-btn", type: "button", title: USE_TITLE, onclick: use }, "Use theirs"),
    ),
  );
  const dialog = el("dialog", { class: "conflict-dialog", "aria-labelledby": "conflict-title" }, box);
  dialog.addEventListener("close", () => open === dialog && closeCompare());
  dialog.addEventListener("mousedown", (e) => e.target === dialog && closeCompare()); // the backdrop: the box fills the rest
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
}
