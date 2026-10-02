// The help on every template option, in the app: docs/templates.md itself (one page for the repo
// and the app), shown over whatever's open. Loaded only when someone asks for it.
import DOMPurify from "dompurify";
import { marked } from "marked";
import doc from "../../docs/templates.md?raw";
import { el } from "./dom.ts";
import { openModal } from "./modal.ts";
import { NOTE_HTML } from "./render.ts";

export function showTemplateHelp() {
  if (document.querySelector(".tpl-help-box")) return;
  const body = el("div", { class: "tpl-help-body cm-rendered", html: DOMPurify.sanitize(marked.parse(doc, { async: false }) as string, NOTE_HTML) });
  // Over the picker it was opened from, Escape closes the help first. The page's own title is the header's.
  body.querySelector(":scope > h1:first-child")?.remove();
  openModal({ title: "Templates", content: [body], boxClass: "ask-box tpl-help-box" });
}
