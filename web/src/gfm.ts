// GitHub-flavored markdown for rendered notes (embeds, Notes cards): alerts, footnotes, heading
// anchors, emoji shortcodes, and the HTML GitHub allows (`<kbd>`, `<sub>`, `<picture>`…). Each is
// turned into plain HTML while marked parses, so DOMPurify still runs last over all of it (see
// renderMarkdown); nothing here is added after sanitizing.
import { Lexer, type MarkedExtension, type Token, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { escapeHtml } from "./dom.ts";
import { assetUrl } from "./api.ts";
import { footnotesIn, headingSlug, parseAlert, type Alert } from "../../src/core/gfm.ts";
import { emojiFor, SHORTCODE } from "../../src/core/emoji.ts";
import { clip } from "../../src/core/depth.ts";

/** The note being rendered, for relative image paths in its HTML. Set by renderMarkdown. */
let from = "";
/** This render's footnotes: their text (for a reference's tooltip), numbers, and rendered definitions. */
let notes = { text: new Map<string, string>(), number: new Map<string, number>(), refs: new Map<string, number>(), html: new Map<string, string>() };

export const renderingFrom = (path: string) => void (from = path);

/** A path in a note's HTML (`<img src>`, `srcset`) that isn't a URL points at one of its assets. */
const relative = (url: string) => !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(url);
function assetPaths(html: string): string {
  return html
    .replace(/(<(?:img|source)\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi, (m, pre, q, url) => (relative(url) ? `${pre}${q}${assetUrl(url, from)}${q}` : m))
    .replace(/(<(?:img|source)\b[^>]*?\ssrcset=)(["'])([^"']+)\2/gi, (_m, pre, q, set: string) =>
      `${pre}${q}${set
        .split(",")
        .map((c) => c.trim().replace(/^\S+/, (url) => (relative(url) ? assetUrl(url, from) : url)))
        .join(", ")}${q}`,
    );
}

type AlertToken = Tokens.Blockquote & { alert?: Alert };

/** Every token, parent before children, as marked's walkTokens visits them. */
function eachToken(tokens: Token[], fn: (t: Token) => void) {
  for (const t of tokens) {
    fn(t);
    if (t.type === "table") {
      for (const cell of (t as Tokens.Table).header) eachToken(cell.tokens, fn);
      for (const row of (t as Tokens.Table).rows) for (const cell of row) eachToken(cell.tokens, fn);
    } else if (t.type === "list") eachToken((t as Tokens.List).items, fn);
    else if ("tokens" in t && t.tokens) eachToken(t.tokens, fn);
  }
}

// Asset paths in HTML, and alerts: a blockquote whose first line is `[!TYPE]`, which becomes its title.
function visit(token: Token) {
  if (token.type === "html") token.text = assetPaths(token.text);
  if (token.type !== "blockquote" || !token.tokens) return;
  const first = token.tokens[0];
  if (first?.type !== "paragraph") return;
  const [line, ...rest] = first.raw.split("\n");
  const alert = parseAlert(`> ${line}`);
  if (!alert) return;
  (token as AlertToken).alert = alert;
  const body = rest.join("\n").trim();
  if (body) {
    first.raw = first.text = body;
    first.tokens = Lexer.lexInline(body, { gfm: true });
  } else token.tokens!.shift();
}

export const gfmMarked: MarkedExtension = {
  hooks: {
    // Not `walkTokens`: marked collects its results with one array concat per token, which is
    // quadratic in a paragraph of tens of thousands of tokens (a long run of `\(`).
    processAllTokens(tokens) {
      eachToken(tokens, visit);
      return tokens;
    },
    preprocess(md) {
      const f = footnotesIn(md);
      notes = { text: new Map([...f.defs].map(([id, d]) => [id, d.text])), number: new Map(), refs: new Map(), html: new Map() };
      return md;
    },
    // The footnotes, as GitHub lays them out: numbered by first reference, each with a way back.
    postprocess(html) {
      if (!notes.number.size) return html;
      const items = [...notes.number].map(([id, n]) => {
        const body = notes.html.get(id) ?? escapeHtml(notes.text.get(id) ?? "");
        return `<li id="fn-${escapeHtml(id)}" value="${n}">${body} <a href="#user-content-fnref-${escapeHtml(id)}" class="footnote-backref" aria-label="Back to reference ${n}">↩</a></li>`;
      });
      return `${html}<section class="footnotes" data-footnotes><h2 class="sr-only">Footnotes</h2><ol>${items.join("")}</ol></section>`;
    },
  },
  extensions: [
    {
      name: "footnoteDef",
      // No `start`: like a link definition, a footnote's can't interrupt a paragraph.
      level: "block",
      tokenizer(src) {
        const m = /^\[\^([^\]\s[]{1,64})\]:[ \t]+([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
        if (!m) return;
        return { type: "footnoteDef", raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(m[2].replace(/\n\s+/g, " ")) };
      },
      renderer(token) {
        notes.html.set(token.id, this.parser.parseInline(token.tokens ?? []));
        return "";
      },
    },
    {
      name: "footnoteRef",
      // No `start`: marked ends a text run at `[` already, and one that scanned ahead would be
      // quadratic (marked asks it again for every run).
      level: "inline",
      tokenizer(src) {
        const m = /^\[\^([^\]\s[]{1,64})\](?!:)/.exec(src);
        return m ? { type: "footnoteRef", raw: m[0], id: m[1] } : undefined;
      },
      renderer(token) {
        const id = token.id as string;
        if (!notes.text.has(id)) return escapeHtml(token.raw);
        if (!notes.number.has(id)) notes.number.set(id, notes.number.size + 1);
        const n = notes.number.get(id)!;
        const k = (notes.refs.get(id) ?? 0) + 1;
        notes.refs.set(id, k);
        const at = k === 1 ? `fnref-${escapeHtml(id)}` : `fnref-${escapeHtml(id)}-${k}`;
        return `<sup class="footnote-ref"><a href="#user-content-fn-${escapeHtml(id)}" id="${at}" title="${escapeHtml(clip(notes.text.get(id)!))}">${n}</a></sup>`;
      },
    },
  ],
  renderer: {
    // Emoji shortcodes, in text only (marked joins a run of text, so a shortcode is never split;
    // code spans and URLs aren't text).
    text(token) {
      if ("tokens" in token && token.tokens) return this.parser.parseInline(token.tokens);
      const html = "escaped" in token && token.escaped ? token.text : escapeHtml(token.text);
      return html.replace(SHORTCODE, (m, _all, name: string) => {
        const emoji = emojiFor(name);
        return emoji ? `<span class="emoji" title=":${name}:">${emoji}</span>` : m;
      });
    },
    blockquote(token) {
      const alert = (token as AlertToken).alert;
      if (!alert) return false;
      const body = this.parser.parse(token.tokens);
      const title = `<span class="markdown-alert-icon" aria-hidden="true"></span>${escapeHtml(alert.title)}`;
      const cls = `markdown-alert markdown-alert-${alert.type}`;
      if (alert.fold) return `<details class="${cls}"${alert.fold === "+" ? " open" : ""}><summary class="markdown-alert-title">${title}</summary>${body}</details>\n`;
      return `<div class="${cls}"><p class="markdown-alert-title">${title}</p>${body}</div>\n`;
    },
    // Headings get GitHub's anchors, so a `[link](#heading)` in a note finds its heading.
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${escapeHtml(headingSlug(text))}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
};

// A `srcset` names several URLs: each must be one a link could be (no javascript: or data:).
const SAFE_SRC = /^(?:https?:|[^a-z\s]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "srcset") return;
  const urls = data.attrValue.split(",").map((c) => c.trim().split(/\s+/)[0]);
  if (!urls.every((u) => u && SAFE_SRC.test(u))) data.keepAttr = false;
});

/**
 * A click on an in-page link in rendered markdown (a footnote, `#heading`): scroll to it inside
 * `root`, since ids there carry DOMPurify's `user-content-` prefix. True if it was one.
 */
export function followInPage(root: HTMLElement, href: string): boolean {
  if (!href.startsWith("#")) return false;
  const id = href.slice(1).replace(/^user-content-/, "");
  let target: Element | null = null;
  try {
    target = root.querySelector(`#user-content-${CSS.escape(decodeURIComponent(id))}`);
  } catch {}
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}
