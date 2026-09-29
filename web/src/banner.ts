// The strip above the note, for something about it you may need to act on. A conflict is an
// alert, read out at once; anything else is a status, read out when the reader is free.
import { $, el, icon } from "./dom.ts";

export type BannerAction = [label: string, run: () => void, title?: string];

/** What goes away with the banner showing now (a conflict's Compare dialog). */
let withIt = () => {};

export function showBanner(text: string, ...actions: BannerAction[]) {
  show("status", text, actions);
}

export function showAlert(text: string, ...actions: BannerAction[]) {
  show("alert", text, actions);
}

export function hideBanner() {
  $("#banner").hidden = true;
  endIt();
}

/** Run `fn` when the banner showing now goes, hidden or replaced. */
export function onBannerGone(fn: () => void) {
  withIt = fn;
}

function endIt() {
  const fn = withIt;
  withIt = () => {};
  fn();
}

function show(role: "status" | "alert", text: string, actions: BannerAction[]) {
  endIt();
  const b = $("#banner");
  b.hidden = false;
  b.className = "";
  b.setAttribute("role", role);
  b.replaceChildren(
    icon("info", 15),
    el("span", { class: "banner-text" }, text),
    ...actions.map(([label, fn, title]) => el("button", { class: "banner-btn", type: "button", title, onclick: fn }, label)),
    el("button", { class: "banner-x", type: "button", title: "Dismiss", "aria-label": "Dismiss", onclick: hideBanner }, "×"),
  );
}
