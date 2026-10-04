// Fenced code blocks outside the source view: one renderer for the editor (a block the cursor
// isn't in) and for rendered markdown (embeds, Notes cards), so both look the same. Highlighting
// uses the editor's own Lezer grammars and colors, each language loaded the first time a block
// needs it. The info string's settings (nowrap, title, lines to highlight) are in core/fence.ts.
import type { Language, LanguageDescription } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags as t, type Highlighter } from "@lezer/highlight";
import { el, icon } from "./dom.ts";
import { commonInkHighlight } from "./editor/language.ts";
import { codeLanguage, languageNames, shortName } from "./codeLanguage.ts";
import { fuzzyRank, listPicker } from "./picker.ts";
import { diffLine, parseFence, setFenceLang, toggleWrap, wraps, type Fence } from "../../src/core/fence.ts";

/** One line of highlighted code: runs of text, each with its highlight classes ("" for none). */
export type CodeLine = Array<[text: string, cls: string]>;

const loading = new Map<LanguageDescription, Promise<Language>>();

/**
 * Highlighting for paper and files (print, exports): the editor's colors as stable class names
 * (`c-keyword`…), which the export stylesheet colors, since the editor's generated classes only
 * exist in the app.
 */
export const staticHighlight = tagHighlighter([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.tagName, t.angleBracket], class: "c-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "c-string" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "c-comment" },
  { tag: [t.number, t.bool, t.null], class: "c-number" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.definition(t.variableName)], class: "c-fn" },
  { tag: [t.typeName, t.className, t.namespace], class: "c-type" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], class: "c-prop" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], class: "c-punct" },
  { tag: [t.heading, t.strong], class: "c-strong" },
  { tag: t.emphasis, class: "c-em" },
]);

/** The code in lines of highlighted runs, in `lang`'s grammar; plain lines when there's none. */
export async function highlight(code: string, lang: string, style: Highlighter = commonInkHighlight): Promise<CodeLine[]> {
  const desc = codeLanguage(lang);
  if (!desc) return plainLines(code);
  let pending = loading.get(desc);
  if (!pending) loading.set(desc, (pending = desc.load().then((s) => s.language)));
  const language = await pending.catch(() => null);
  if (!language) return plainLines(code);
  const runs: Array<[number, number, string]> = [];
  highlightTree(language.parser.parse(code), style, (from, to, cls) => runs.push([from, to, cls]));
  const lines: CodeLine[] = [[]];
  let at = 0;
  const push = (to: number, cls: string) => {
    const parts = code.slice(at, to).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push([part, cls]);
    });
    at = to;
  };
  for (const [from, to, cls] of runs) {
    if (from > at) push(from, "");
    push(to, cls);
  }
  push(code.length, "");
  return lines;
}

const plainLines = (code: string): CodeLine[] => code.split("\n").map((l) => (l ? [[l, ""]] : []));

/** What a rendered block can do beyond showing its code. The editor passes these; rendered markdown doesn't. */
export interface CodeActions {
  /** Change the fence's info string (language, wrapping); absent where the note can't change. */
  setInfo?(info: string): void;
  /** Put the cursor at this line (from 0) and column of the code. */
  edit(line: number, column: number): void;
}

/** Read and write the reader's default for blocks that don't say: wrap long lines, or scroll. */
export const codeWrapByDefault = () => {
  try {
    return localStorage.getItem("commonink.codeNowrap") !== "true";
  } catch {
    return true;
  }
};
export function setCodeWrapByDefault(wrap: boolean) {
  try {
    localStorage.setItem("commonink.codeNowrap", String(!wrap));
  } catch {}
}

/**
 * A code block: a header with its title and language, and copy (and, in the editor, wrap and
 * language) on hover; then its lines, highlighted once the grammar loads.
 */
export function renderCodeBlock(code: string, info: string, actions?: CodeActions): HTMLElement {
  const fence = parseFence(info);
  const wrap = wraps(fence, codeWrapByDefault());
  const pre = el("pre", { class: "cb-pre" });
  const box = el(
    "div",
    { class: `cb${wrap ? "" : " is-nowrap"}${fence.lineNumbers ? " has-numbers" : ""}`, "data-lang": fence.lang.toLowerCase() },
    el("div", { class: "cb-head" }, fence.title ? el("span", { class: "cb-title" }, fence.title) : null, el("span", { class: "spacer" }), ...tools(code, info, fence.lang, wrap, actions)),
    pre,
  );
  const draw = (lines: CodeLine[]) => pre.replaceChildren(codeLines(code, fence, lines));
  draw(plainLines(code));
  if (codeLanguage(fence.lang)) void highlight(code, fence.lang).then(draw);
  if (actions) {
    pre.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const at = caretIn(pre, e.clientX, e.clientY);
      actions.edit(at.line, at.column);
    });
  }
  return box;
}

/** The `<code>` of a block: a span per line, marked as a diff's added or removed line or as one to highlight. */
function codeLines(code: string, fence: Fence, lines: CodeLine[]): HTMLElement {
  const isDiff = codeLanguage(fence.lang)?.name === "diff";
  const src = code.split("\n");
  return el(
    "code",
    {},
    ...lines.map((runs, i) => {
      const kind = isDiff ? diffLine(src[i] ?? "") : null;
      const cls = `cb-line${kind ? ` is-${kind}` : ""}${fence.highlight.has(i + 1) ? " is-marked" : ""}`;
      const line = el("span", { class: cls, "data-line": String(i) }, ...runs.map(([text, c]) => (c ? el("span", { class: c }, text) : text)));
      if (!runs.length) line.append("\n"); // an empty line keeps its height
      return line;
    }),
  );
}

/**
 * A block for paper and files: its title and language, its lines highlighted with staticHighlight's
 * classes, and no buttons. Long lines always wrap, since paper can't scroll.
 */
export async function staticCodeBlock(code: string, info: string): Promise<HTMLElement> {
  const fence = parseFence(info);
  const lines = codeLanguage(fence.lang) ? await highlight(code, fence.lang, staticHighlight) : plainLines(code);
  return el(
    "div",
    { class: `cb${fence.lineNumbers ? " has-numbers" : ""}`, "data-lang": fence.lang.toLowerCase() },
    el("div", { class: "cb-head" }, fence.title ? el("span", { class: "cb-title" }, fence.title) : null, el("span", { class: "spacer" }), el("span", { class: "cb-lang" }, fence.lang || "code")),
    el("pre", { class: "cb-pre" }, codeLines(code, fence, lines)),
  );
}

function tools(code: string, info: string, lang: string, wrap: boolean, actions?: CodeActions): HTMLElement[] {
  const copy = el("button", { type: "button", class: "cb-btn cb-copy", title: "Copy code", "aria-label": "Copy code" }, icon("copy", 14));
  copy.addEventListener("mousedown", (e) => e.preventDefault());
  copy.addEventListener("click", () => void copyCode(code, copy));
  const label = lang || "code";
  const setInfo = actions?.setInfo;
  if (!setInfo) return [el("span", { class: "cb-lang" }, label), copy];
  const picker = el("button", { type: "button", class: "cb-btn cb-lang", title: "Change the language" }, label);
  picker.addEventListener("mousedown", (e) => e.preventDefault());
  picker.addEventListener("click", () => pickLanguage(picker, info, setInfo));
  const toggle = el("button", { type: "button", class: `cb-btn cb-wrap${wrap ? " is-on" : ""}`, title: wrap ? "Long lines wrap (click to scroll instead)" : "Long lines scroll (click to wrap)", "aria-label": "Wrap long lines", "aria-pressed": String(wrap) }, icon("wrap", 14));
  toggle.addEventListener("mousedown", (e) => e.preventDefault());
  toggle.addEventListener("click", () => setInfo(toggleWrap(info, codeWrapByDefault())));
  return [picker, toggle, copy];
}

/** Copy a block's code, and say so on its button for a moment. */
export async function copyCode(code: string, button?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return;
  }
  if (!button) return;
  button.classList.add("is-done");
  button.replaceChildren(icon("check", 14), el("span", {}, "Copied"));
  setTimeout(() => {
    button.classList.remove("is-done");
    button.replaceChildren(icon("copy", 14));
  }, 1400);
}

/** The line (from 0) and column of the code under a point in a rendered block. */
function caretIn(pre: HTMLElement, x: number, y: number): { line: number; column: number } {
  const lines = [...pre.querySelectorAll<HTMLElement>(".cb-line")];
  const doc = pre.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const hit = doc.caretPositionFromPoint?.(x, y) ?? (doc.caretRangeFromPoint ? rangeToPosition(doc.caretRangeFromPoint(x, y)) : null);
  const line = hit ? lines.find((l) => l.contains(hit.offsetNode)) : undefined;
  if (!line || !hit) {
    // Below or beside the text: the nearest line by height, at its start.
    const i = lines.findIndex((l) => l.getBoundingClientRect().bottom >= y);
    return { line: i < 0 ? Math.max(0, lines.length - 1) : i, column: 0 };
  }
  const r = doc.createRange();
  r.setStart(line, 0);
  r.setEnd(hit.offsetNode, hit.offset);
  return { line: Number(line.dataset.line), column: r.toString().replace(/\n$/, "").length };
}

const rangeToPosition = (r: Range | null) => (r ? { offsetNode: r.startContainer, offset: r.startOffset } : null);

/** A small picker under the language label: type or choose a language, and the fence gets it. */
function pickLanguage(anchor: HTMLElement, info: string, setInfo: (info: string) => void) {
  document.querySelector(".cb-picker")?.remove();
  const input = el("input", { class: "cb-picker-input", placeholder: "Language…", spellcheck: "false", autocomplete: "off", value: parseFence(info).lang });
  const list = el("div", { class: "fp-list" });
  const box = el("div", { class: "folder-picker cb-picker", role: "dialog", "aria-label": "Code language" }, el("div", { class: "fp-head" }, icon("code", 14), input), list);
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { top: `${Math.min(r.bottom + 6, innerHeight - 320)}px`, left: `${Math.max(12, Math.min(r.right - 240, innerWidth - 252))}px` });
  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (e: MouseEvent) => !box.contains(e.target as Node) && close();
  const choose = (name: string) => {
    close();
    setInfo(setFenceLang(info, name));
  };
  const row = (label: string, name: string) => el("button", { type: "button", class: "fp-item", onclick: () => choose(name) }, el("span", {}, label));
  const rows = (typed: string) => {
    const q = typed.trim();
    // The language a short name stands for ("py") comes first, then the names that fit what's typed.
    const named = codeLanguage(q)?.name;
    const names = languageNames();
    const shown = [...(named ? [named] : []), ...fuzzyRank(q, names, (n) => n).filter((n) => n !== named)].slice(0, 8);
    // A name no language has is written as typed.
    return [...shown.map((n) => row(n, shortName(n))), !shown.length && q ? row(`Use “${q}”`, q) : null, row("No language", "")];
  };
  input.addEventListener("keydown", (e) => e.stopPropagation());
  // With nothing typed no row is lit: Enter on an empty box shouldn't pick the first language of the alphabet.
  listPicker({ input, list, rows, close, start: (_rows, q) => (q.trim() ? 0 : -1) });
  document.addEventListener("mousedown", outside, true);
  document.body.append(box);
  input.focus();
  input.select();
}

/** Rendered markdown's code blocks (`pre[data-code-info]`, see codeRenderer): drawn like the editor's. */
export function hydrateCode(root: ParentNode) {
  for (const pre of root.querySelectorAll<HTMLElement>("pre[data-code-info]")) {
    const code = pre.textContent ?? "";
    pre.replaceWith(renderCodeBlock(code.replace(/\n$/, ""), pre.dataset.codeInfo ?? ""));
  }
}
