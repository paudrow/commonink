// What a page shows with nothing in it: what the page is for, and the one thing to do next.
import { el, icon } from "./dom.ts";

export interface EmptyAction {
  label: string;
  icon?: string;
  run(): void;
}

export function emptyState(o: { icon: string; title: string; text: Array<Node | string>; action?: EmptyAction | null; class?: string }): HTMLElement {
  return el(
    "div",
    { class: `empty-state${o.class ? ` ${o.class}` : ""}` },
    icon(o.icon, 26),
    el("b", {}, o.title),
    el("p", {}, ...o.text),
    o.action
      ? el("button", { type: "button", class: "qw-btn primary", onclick: (e: Event) => (e.stopPropagation(), o.action!.run()) }, o.action.icon ? icon(o.action.icon, 14) : null, o.action.label)
      : null,
  );
}
