// The strip above a note, for something about it you may need to act on. Each pane has its own,
// so split, it shows over the note it's about (the main pane's is #banner, the side pane's
// #side-banner). A conflict is an alert, read out at once; anything else is a status, read out
// when the reader is free.
import { $, el, icon } from "./dom.ts";

export type BannerAction = [label: string, run: () => void, title?: string];
export interface BannerOpts {
  /** The pane's banner to show it in; the main pane's by default. */
  in?: HTMLElement;
  /** About the note rather than a problem with it (archived, the agents note): drawn in the accent color. */
  info?: boolean;
}

/** What goes away with each banner's message showing now (a conflict's Compare dialog). */
const withIt = new WeakMap<HTMLElement, () => void>();
const main = () => $("#banner");

export function showBanner(text: string, actions: BannerAction[] = [], opts: BannerOpts = {}) {
  show("status", text, actions, opts);
}

export function showAlert(text: string, actions: BannerAction[] = [], opts: BannerOpts = {}) {
  show("alert", text, actions, opts);
}

export function hideBanner(b = main()) {
  b.hidden = true;
  endIt(b);
  fit(b);
}

/** Run `fn` when the message showing now in banner `b` goes, hidden or replaced. */
export function onBannerGone(fn: () => void, b = main()) {
  withIt.set(b, fn);
}

function endIt(b: HTMLElement) {
  const fn = withIt.get(b);
  withIt.delete(b);
  fn?.();
}

/**
 * The note under a banner starts below it: its pane is told how tall the banner is (--banner-h),
 * now and whenever it wraps to a new height.
 */
const fitting = new WeakSet<HTMLElement>();
function fit(b: HTMLElement) {
  const set = () => {
    const css = getComputedStyle(b);
    const h = b.hidden ? 0 : b.offsetHeight + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
    b.parentElement?.style.setProperty(b.id === "banner" ? "--main-banner" : "--side-banner", `${Math.ceil(h)}px`);
  };
  set();
  if (!fitting.has(b) && typeof ResizeObserver !== "undefined") {
    fitting.add(b);
    new ResizeObserver(set).observe(b);
  }
}

function show(role: "status" | "alert", text: string, actions: BannerAction[], opts: BannerOpts) {
  const b = opts.in ?? main();
  endIt(b);
  b.hidden = false;
  b.className = `banner${opts.info ? " is-info" : ""}`;
  b.setAttribute("role", role);
  b.replaceChildren(
    icon("info", 15),
    el("span", { class: "banner-text" }, text),
    ...actions.map(([label, fn, title]) => el("button", { class: "banner-btn", type: "button", title, onclick: fn }, label)),
    el("button", { class: "banner-x", type: "button", title: "Dismiss", "aria-label": "Dismiss", onclick: () => hideBanner(b) }, "×"),
  );
  fit(b);
}
