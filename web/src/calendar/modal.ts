// A calendar dialog: a box over the dimmed app that keeps Tab inside it, closes on Escape or a click
// outside, and gives the focus back to where it was. One at a time: opening one closes the last.
// The Calendars dialog (sources.ts) and the event form (editor.ts) are these.
import { el, icon } from "../dom.ts";

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

let closeOpen: (() => void) | null = null;

export function modal(o: {
  titleId: string;
  title: string;
  icon: string;
  class: string;
  content: Array<Node | null>;
  /** Escape here is the field's own (a rename being typed), not the dialog's. */
  ownsEscape?(target: Element): boolean;
}): { box: HTMLElement; close(): void } {
  closeOpen?.();
  const back = document.activeElement as HTMLElement | null;
  const close = () => {
    page.remove();
    document.removeEventListener("keydown", onKey, true);
    closeOpen = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector(".ask")) return; // a question over the dialog has the keys
    if (e.key === "Escape" && !o.ownsEscape?.(e.target as Element)) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
      e.preventDefault();
      stops[next]?.focus();
    }
  };
  const box = el(
    "div",
    { class: `agents-box ${o.class}`, role: "dialog", "aria-modal": "true", "aria-labelledby": o.titleId, tabindex: "-1" },
    el("div", { class: "agents-head" }, icon(o.icon, 16), el("h2", { id: o.titleId }, o.title), el("button", { class: "icon-btn small", type: "button", title: "Close (Esc)", "aria-label": "Close", onclick: close }, icon("close", 15))),
    ...o.content,
  );
  const page = el("div", { id: "agents-page", onmousedown: (e: Event) => e.target === page && close() }, box);
  document.addEventListener("keydown", onKey, true);
  document.body.append(page);
  closeOpen = close;
  return { box, close };
}
