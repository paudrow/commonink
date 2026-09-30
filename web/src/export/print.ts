// Print, and PDF through the browser's print dialog ("Save as PDF"): the note rendered static
// (static.ts) into a page of its own, with none of the app around it, in the light theme whatever
// the app's is. Each page carries the note's title and today's date at the top and its number at
// the bottom. Options: the note's properties, and whether collapsed sections stay closed.
import { el, icon } from "../dom.ts";
import { store } from "../store.ts";
import { renderStatic } from "./static.ts";
import { appSources } from "./sources.ts";
import { STATIC_CSS } from "./staticCss.ts";

export interface PrintOptions {
  frontmatter: boolean;
  keepFolds: boolean;
}

/** The note to print. */
export interface Printable {
  path: string;
  title: string;
  content: string;
}

/** The static stylesheet, once, and the element print renders into (a light `.st-doc`, hidden on screen). */
export function staticDoc(): HTMLElement {
  if (!document.getElementById("st-css")) document.head.append(el("style", { id: "st-css" }, STATIC_CSS));
  let root = document.getElementById("print-root");
  if (!root) document.body.append((root = el("article", { id: "print-root", class: "st-doc", "aria-hidden": "true" })));
  return root;
}

const FOLDS = /<details\b/i;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * Print a note. If it has properties or collapsed sections, a small dialog asks about them first
 * (remembered for next time); `pdf` says how to save a PDF from the print dialog.
 */
export async function print(note: Printable, how: { pdf?: boolean } = {}) {
  const asks = { frontmatter: FRONTMATTER.test(note.content), keepFolds: FOLDS.test(note.content) };
  const saved: PrintOptions = { frontmatter: store.get("print.frontmatter", false), keepFolds: store.get("print.keepFolds", false) };
  if (!asks.frontmatter && !asks.keepFolds && !how.pdf) return printNow(note, saved);
  const opts = await askOptions(asks, saved, !!how.pdf);
  if (!opts) return;
  store.set("print.frontmatter", opts.frontmatter);
  store.set("print.keepFolds", opts.keepFolds);
  return printNow(note, opts);
}

/** Render the note into the print page and open the browser's print dialog. */
export async function printNow(note: Printable, opts: PrintOptions) {
  const root = staticDoc();
  cleanUp();
  root.innerHTML = await renderStatic(note.path, note.content, appSources(root), { ...opts, math: "katex" }); // sanitized last, in renderStatic
  document.head.append(el("style", { id: "print-page" }, pageRules(note.title, new Date())));
  await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  await document.fonts.ready;
  document.body.classList.add("is-printing");
  addEventListener("afterprint", cleanUp, { once: true });
  window.print();
}

function cleanUp() {
  document.body.classList.remove("is-printing");
  document.getElementById("print-page")?.remove();
}

/** A string for CSS `content`: every character that could end or bend it escaped. */
export function cssString(s: string): string {
  return `"${[...s.replace(/[\n\r\t]+/g, " ")].map((c) => (/[\w .,:;!?'()&+@#%-]/.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `)).join("")}"`;
}

/** The page box: margins, the title and date at the top, page numbers at the bottom. */
export function pageRules(title: string, date: Date): string {
  const day = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const box = "font: 8.5pt -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: #65615a;";
  return `@page { margin: 18mm 16mm 18mm;
  @top-left { content: ${cssString(title)}; ${box} }
  @top-right { content: ${cssString(day)}; ${box} }
  @bottom-right { content: counter(page) " / " counter(pages); ${box} }
}`;
}

/** The print options, asked in a small dialog. Null if cancelled. */
function askOptions(asks: { frontmatter: boolean; keepFolds: boolean }, saved: PrintOptions, pdf: boolean): Promise<PrintOptions | null> {
  return new Promise((resolve) => {
    const check = (id: string, label: string, on: boolean) => el("label", { class: "pr-opt" }, el("input", { type: "checkbox", id, checked: on }), el("span", {}, label));
    const go = el("button", { class: "banner-btn is-primary", type: "submit" }, icon("printer", 14), pdf ? "Continue" : "Print");
    const form = el(
      "form",
      { class: "pr-box", method: "dialog" },
      el("h2", { id: "pr-title" }, pdf ? "Save as PDF" : "Print"),
      pdf ? el("p", { class: "pr-hint" }, "In the print dialog, choose ", el("b", {}, "Save as PDF"), " as the destination.") : null,
      asks.frontmatter ? check("pr-props", "Include the note's properties", saved.frontmatter) : null,
      asks.keepFolds ? check("pr-folds", "Keep collapsed sections closed", saved.keepFolds) : null,
      el("footer", { class: "pr-foot" }, el("button", { class: "banner-btn", type: "button", value: "cancel", onclick: () => dialog.close("cancel") }, "Cancel"), go),
    );
    const dialog = el("dialog", { class: "pr-dialog", "aria-labelledby": "pr-title" }, form);
    dialog.addEventListener("close", () => {
      const ok = dialog.returnValue !== "cancel" && dialog.returnValue !== "";
      const read = (id: string, fallback: boolean) => form.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? fallback;
      dialog.remove();
      resolve(ok ? { frontmatter: read("pr-props", saved.frontmatter), keepFolds: read("pr-folds", saved.keepFolds) } : null);
    });
    go.value = "print";
    document.body.append(dialog);
    dialog.showModal();
    go.focus();
  });
}
