// KaTeX, loaded only when something on screen has math (see math.ts, which loads its stylesheet and
// fonts beside it, from our own origin like any other asset, so the strict CSP needs nothing new).
//
// A formula is note content, so it's treated like any: KaTeX runs with `trust: false` (no \href,
// \url, \htmlClass, \includegraphics…) and bounded expansion and sizes, and what it produces goes
// through DOMPurify last, with inline styles allowed only for the layout properties KaTeX uses.
import katex from "katex";
import DOMPurify from "dompurify";

/** The longest formula rendered; longer ones show as their source. */
const MAX_TEX = 4000;

/** KaTeX's own inline styles: positions and sizes of glyphs and rules, and \color. Nothing that can move it out of its line. */
const STYLE_PROPS = new Set([
  "background-color", "border", "border-bottom-width", "border-color", "border-right-width", "border-style", "border-top-width", "border-width",
  "bottom", "color", "height", "margin-left", "margin-right", "min-width", "padding-left", "position", "top", "vertical-align", "width",
]);
const STYLE_VALUE = /^[\w\s.#%(),+-]*$/;

/** Keep a style attribute's declarations only if each is a KaTeX layout property with a plain value. */
function safeStyle(style: string): string | null {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    if (!decl.trim()) continue;
    const i = decl.indexOf(":");
    if (i < 0) return null;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !STYLE_VALUE.test(value) || /url|expression|var/i.test(value)) return null;
    if (prop === "position" && value !== "relative") return null;
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

const purify = DOMPurify(window);
purify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return;
  const style = safeStyle(data.attrValue);
  if (style === null) data.keepAttr = false;
  else data.attrValue = style;
});

/** What KaTeX's HTML and MathML may contain: its spans, MathML and the SVG of stretchy glyphs. No links, ids or forms. */
const MATH_HTML = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_ATTR: ["style"],
  FORBID_TAGS: ["a", "img", "image", "iframe", "form", "input", "button", "style", "use", "foreignObject", "script"],
  FORBID_ATTR: ["id", "href", "xlink:href", "src", "action", "popover", "name"],
};

/** KaTeX's settings for note content. */
const OPTIONS = { trust: false, strict: "ignore", maxExpand: 500, maxSize: 30, throwOnError: true, output: "htmlAndMathml" } as const;

export type Rendered = { html: string } | { error: string };

const cache = new Map<string, Rendered>();

/** A formula as safe HTML, or KaTeX's message about why it can't be drawn. */
export function renderTex(tex: string, display: boolean): Rendered {
  const key = `${display ? "D" : "I"}${tex}`;
  let out = cache.get(key);
  if (out) return out;
  if (tex.length > MAX_TEX) out = { error: `This formula is over ${MAX_TEX} characters` };
  else {
    try {
      out = { html: purify.sanitize(katex.renderToString(tex, { ...OPTIONS, displayMode: display }), MATH_HTML) };
    } catch (e) {
      out = { error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : "Can't read this formula" };
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}
