// HTML to markdown, for notes brought in from apps that keep them as HTML: Evernote's ENML and
// Apple Notes' bodies. It reads the HTML into a small tree (forgiving of unclosed tags, as notes'
// HTML often is), then writes each element as the markdown that looks like it. What has no
// markdown form (fonts, colors, spans) keeps its text. No Node or DOM imports: Workers and the app
// run it too. Scans with indexOf, never a backtracking pattern, since the HTML comes from outside.

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  kids: HtmlNode[];
}
export type HtmlNode = HtmlElement | string;

export interface ToMarkdownOptions {
  /** Markdown for an <en-media> or <img>, from its attributes, or null to leave it as the HTML says (an <img>) or out. */
  media?: (el: HtmlElement) => string | null;
}

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "en-media", "en-todo", "col", "area", "source", "wbr", "base"]);
const SKIP = new Set(["script", "style", "head", "title", "noscript", "template"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", times: "×",
};

/** `s` with its character references (&amp;, &#39;, &#x2014;) read. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

/** Read `html` into a tree. Unclosed elements close with their parent; stray closing tags are dropped. */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = { tag: "#root", attrs: {}, kids: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf("<", at);
    if (lt < 0) {
      top().kids.push(decodeEntities(html.slice(at)));
      break;
    }
    if (lt > at) top().kids.push(decodeEntities(html.slice(at, lt)));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      top().kids.push(html.slice(lt + 9, end < 0 ? html.length : end));
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      at = end < 0 ? html.length : end + 1;
      continue;
    }
    const closing = html[lt + 1] === "/";
    let i = lt + (closing ? 2 : 1);
    const nameStart = i;
    while (i < html.length && /[a-zA-Z0-9:-]/.test(html[i])) i++;
    const tag = html.slice(nameStart, i).toLowerCase();
    if (!tag) {
      top().kids.push("<");
      at = lt + 1;
      continue;
    }
    // Attributes, minding quotes so a ">" inside one doesn't end the tag.
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (i < html.length && /\s/.test(html[i])) i++;
      if (i >= html.length) break;
      if (html[i] === ">") {
        i++;
        break;
      }
      if (html[i] === "/") {
        selfClosing = true;
        i++;
        continue;
      }
      const a = i;
      while (i < html.length && !/[\s=>/]/.test(html[i])) i++;
      const name = html.slice(a, i).toLowerCase();
      if (i === a) {
        i++;
        continue;
      }
      while (i < html.length && /\s/.test(html[i])) i++;
      let value = "";
      if (html[i] === "=") {
        i++;
        while (i < html.length && /\s/.test(html[i])) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          value = html.slice(i + 1, end < 0 ? html.length : end);
          i = end < 0 ? html.length : end + 1;
        } else {
          const v = i;
          while (i < html.length && !/[\s>]/.test(html[i])) i++;
          value = html.slice(v, i);
        }
      }
      attrs[name] = decodeEntities(value);
    }
    at = i;
    if (closing) {
      const depth = stack.map((e) => e.tag).lastIndexOf(tag);
      if (depth > 0) stack.length = depth;
      continue;
    }
    const el: HtmlElement = { tag, attrs, kids: [] };
    top().kids.push(el);
    if (SKIP.has(tag)) {
      // Their insides aren't markup to read: skip to the closing tag.
      const end = html.toLowerCase().indexOf(`</${tag}`, at);
      const close = end < 0 ? -1 : html.indexOf(">", end);
      at = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!selfClosing && !VOID.has(tag)) stack.push(el);
  }
  return root.kids;
}

interface Ctx {
  pre: boolean;
  checklist: boolean;
  opts: ToMarkdownOptions;
}

const block = (s: string) => {
  const t = s.trim();
  return t ? `\n\n${t}\n\n` : "";
};

/** Wrap inline text in a mark (**, *, ~~), keeping the spaces around it outside the mark. */
function wrap(inner: string, mark: string): string {
  const lead = inner.length - inner.trimStart().length;
  const core = inner.trim();
  if (!core) return inner;
  return `${inner.slice(0, lead)}${mark}${core}${mark}${inner.slice(lead + core.length)}`;
}

const textOf = (n: HtmlNode): string => (typeof n === "string" ? n : n.kids.map(textOf).join(""));
const linkUrl = (href: string) => href.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
const descendants = (n: HtmlElement, tags: Set<string>): HtmlElement[] =>
  n.kids.flatMap((k) => (typeof k === "string" ? [] : tags.has(k.tag) ? [k] : descendants(k, tags)));
const isChecked = (el: HtmlElement) => el.attrs.checked !== undefined && el.attrs.checked !== "false";

function render(n: HtmlNode, c: Ctx): string {
  if (typeof n === "string") return c.pre ? n : n.replace(/\s+/g, " ");
  const kids = (cc: Ctx = c) => n.kids.map((k) => render(k, cc)).join("");
  switch (n.tag) {
    case "br":
      return "\n";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const text = kids().replace(/\s+/g, " ").trim();
      return text ? block(`${"#".repeat(Number(n.tag[1]))} ${text}`) : "";
    }
    case "strong": case "b":
      return wrap(kids(), "**");
    case "em": case "i":
      return wrap(kids(), "*");
    case "s": case "del": case "strike":
      return wrap(kids(), "~~");
    case "code":
      return c.pre ? kids() : wrap(kids(), "`");
    case "a": {
      const text = kids();
      const href = n.attrs.href?.trim();
      if (!href || href.startsWith("#") || /^(evernote|javascript|applenotes):/i.test(href)) return text;
      if (!text.trim() || text.trim() === href) return `<${href}>`;
      return `[${text.trim()}](${linkUrl(href)})`;
    }
    case "img": {
      const own = c.opts.media?.(n);
      if (own != null) return own;
      const src = n.attrs.src?.trim();
      // A picture held inside the HTML (data:) can be megabytes of text: it's left out, not pasted into the note.
      return src && !src.startsWith("data:") ? `![${(n.attrs.alt ?? "").replace(/[[\]]/g, "")}](${linkUrl(src)})` : "";
    }
    case "en-media":
      return c.opts.media?.(n) ?? "";
    case "en-todo":
      return isChecked(n) ? "- [x] " : "- [ ] ";
    case "input":
      return n.attrs.type === "checkbox" ? (isChecked(n) ? "- [x] " : "- [ ] ") : "";
    case "hr":
      return block("---");
    case "pre": {
      const text = textOf(n).replace(/\n$/, "");
      return block(`\`\`\`\n${text}\n\`\`\``);
    }
    case "blockquote": {
      const inner = kids().trim().replace(/\n{3,}/g, "\n\n");
      return block(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    }
    case "ul": case "ol": {
      const ordered = n.tag === "ol";
      const checklist = /\bchecklist\b/.test(n.attrs.class ?? "") || n.attrs["data-checklist"] !== undefined;
      let num = Number(n.attrs.start) || 1;
      const items: string[] = [];
      for (const k of n.kids) {
        if (typeof k === "string") continue;
        const inner = k.tag === "li" ? k.kids.map((x) => render(x, { ...c, checklist })).join("") : render(k, c);
        let body = inner.replace(/\n{2,}/g, "\n").trim();
        if (!body && k.tag !== "li") continue;
        if (k.tag === "li" && checklist && !body.startsWith("- [")) body = `${/\bchecked\b/.test(k.attrs.class ?? "") ? "[x]" : "[ ]"} ${body}`;
        if (k.tag !== "li") {
          // A list nested straight in a list (not in an item): indent it under the last item.
          if (items.length) items[items.length - 1] += `\n${body.split("\n").map((l) => `  ${l}`).join("\n")}`;
          else items.push(body);
          continue;
        }
        if (body.startsWith("- [")) body = body.slice(2); // a checkbox in the item: "- [ ] " is the item's own bullet
        const marker = ordered ? `${num++}. ` : "- ";
        const [first, ...rest] = body.split("\n");
        items.push([marker + first, ...rest.map((l) => " ".repeat(marker.length) + l)].join("\n"));
      }
      return block(items.join("\n"));
    }
    case "li":
      return block(`- ${kids().trim()}`);
    case "table": {
      const rows = descendants(n, new Set(["tr"])).map((tr) =>
        descendants(tr, new Set(["td", "th"])).map((cell) => cell.kids.map((x) => render(x, c)).join("").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")),
      );
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width) return "";
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return block([line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
    }
    case "p": case "div": case "section": case "article": case "main": case "header": case "footer":
    case "body": case "html": case "en-note": case "figure": case "figcaption": case "dl": case "dt": case "dd": case "address":
      return block(kids());
    default:
      return kids();
  }
}

/** Markdown that reads like `html`. */
export function htmlToMarkdown(html: string, opts: ToMarkdownOptions = {}): string {
  const ctx: Ctx = { pre: false, checklist: false, opts };
  const out = parseHtml(html).map((n) => render(n, ctx)).join("");
  const lines = out.split("\n").map((l) => l.trimEnd());
  // A stray space between two blocks would start the next line; fences keep theirs.
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) fenced = !fenced;
    else if (!fenced && /^ [^ ]/.test(lines[i])) lines[i] = lines[i].slice(1);
  }
  // Evernote puts each to-do in its own <div>: one after another, they're one list.
  const md = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^(- \[[ x]\] .*)\n\n(?=- \[[ x]\] )/gm, "$1\n").trim();
  return md ? `${md}\n` : "";
}
