// The help on every template option, in the app: docs/templates.md itself (one page for the repo
// and the app), shown over whatever's open. Loaded only when someone asks for it.
import DOMPurify from "dompurify";
import { marked } from "marked";
import doc from "../../docs/templates.md?raw";
import { el } from "./dom.ts";
import { NOTE_HTML } from "./render.ts";

export function showTemplateHelp() {
  if (document.querySelector(".tpl-help-box")) return;
  const body = el("div", { class: "tpl-help-body cm-rendered", html: DOMPurify.sanitize(marked.parse(doc, { async: false }) as string, NOTE_HTML) });
  const close = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), e.stopImmediatePropagation(), close());
  const overlay = el(
    "div",
    { class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && close() },
    el(
      "div",
      { class: "ask-box tpl-help-box", role: "dialog", "aria-modal": "true", "aria-label": "Templates help", tabindex: "-1" },
      el("button", { type: "button", class: "icon-btn small tpl-help-close", "aria-label": "Close", onclick: close }, "×"),
      body,
    ),
  );
  document.body.append(overlay);
  // On the window, so Escape closes the help first and not the picker it was opened from.
  window.addEventListener("keydown", onKey, true);
  overlay.querySelector<HTMLElement>(".tpl-help-box")!.focus();
}
