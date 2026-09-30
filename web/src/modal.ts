// A modal dialog's keys: Esc closes it, and Tab and Shift-Tab go round its controls without leaving.
const FOCUSABLE = "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function trapKeys(page: HTMLElement, box: HTMLElement, close: () => void) {
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
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
  });
}
