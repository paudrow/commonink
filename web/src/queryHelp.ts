// The "?" beside every place a note query is typed (the Notes filter, a ::view's settings, the
// smart folder editor). It's a link to /query-help, so it opens in a new tab too; a plain click
// asks the app to show the page (main.ts listens for QUERY_HELP).
import { el } from "./dom.ts";

export const QUERY_HELP = "commonink:query-help";

export function queryHelpLink(): HTMLAnchorElement {
  return el(
    "a",
    {
      class: "query-help-link",
      href: "/query-help",
      title: "Query syntax: AND, OR, ( ), -, tag=, folder=, dates and sort",
      "aria-label": "Query syntax",
      onmousedown: (e: MouseEvent) => e.preventDefault(), // keep the focus in the box being typed in
      onclick: (e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        window.dispatchEvent(new Event(QUERY_HELP));
      },
    },
    "?",
  );
}
