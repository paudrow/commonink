// One header for every page: the page's name at the same size, the page's buttons (New, Upload,
// Import) at its right, and a line under them. A phone keeps the buttons' labels; when they don't fit
// beside the name they take the row under it, still at the right.
import { el } from "./dom.ts";

export interface PageHeaderOptions {
  /** The page's name, or its own h1 when the page renames it (Notes, on a smart folder). */
  title: string | HTMLHeadingElement;
  /** The line under the name: a sentence, or the page's own element (Calendar's dates, Today's ring). */
  sub?: string | HTMLElement;
  /** The page's buttons, the main one last. */
  actions?: Array<HTMLElement | null | false | "">;
  /** The page's own class, beside `page-head`. */
  class?: string;
}

export function pageHeader(o: PageHeaderOptions): HTMLElement {
  const actions = (o.actions ?? []).filter((a): a is HTMLElement => !!a);
  const sub = typeof o.sub === "string" ? el("p", {}, o.sub) : o.sub;
  sub?.classList.add("page-sub");
  return el(
    "header",
    { class: o.class ? `page-head ${o.class}` : "page-head" },
    el("div", { class: "page-head-row" }, typeof o.title === "string" ? el("h1", {}, o.title) : o.title, actions.length ? el("div", { class: "page-actions" }, ...actions) : null),
    sub,
  );
}
