import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

/** Obsidian-style [[wikilinks]] and ![[embeds]] as real syntax nodes. */
export const WikiLinks: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: t.link },
    { name: "Embed", style: t.link },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const bang = next === 33; // !
        const open = bang ? pos + 1 : pos;
        if (cx.char(open) !== 91 || cx.char(open + 1) !== 91) return -1; // [[
        const start = open + 2;
        const rest = cx.slice(start, cx.end);
        const close = rest.indexOf("]]");
        if (close <= 0 || /[[\n]/.test(rest.slice(0, close))) return -1;
        const end = start + close;
        return cx.addElement(
          cx.elt(bang ? "Embed" : "WikiLink", pos, end + 2, [
            cx.elt("WikiLinkMark", pos, start),
            cx.elt("WikiLinkMark", end, end + 2),
          ]),
        );
      },
    },
  ],
};

export const markdownWithFrontmatter = () =>
  yamlFrontmatter({
    content: markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [WikiLinks] }),
  });

export const quireHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "650", color: "var(--heading)" },
  { tag: t.strong, fontWeight: "650", color: "var(--ink-strong)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.processingInstruction, color: "var(--faint)", fontWeight: "400" },
  { tag: t.quote, color: "var(--ink-2)" },
  { tag: t.contentSeparator, color: "var(--faint)" },
  { tag: t.atom, color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.88em" },
  { tag: t.meta, color: "var(--faint)" },
  // code inside fences, yaml frontmatter, html notes
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "var(--c-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--c-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--c-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "var(--c-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: "var(--c-fn)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--c-type)" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: "var(--c-prop)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--c-keyword)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--c-punct)" },
  { tag: t.definition(t.variableName), color: "var(--c-fn)" },
]);
