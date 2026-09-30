// A note as a Word document (.docx), from its static render (static.ts): the same content as print,
// in Word's own structure, so it edits well in Word, Google Docs, Pages and LibreOffice. Headings are
// Word headings, lists are Word lists, tables are tables, code keeps its colors in a shaded block.
// What Word can't hold becomes something it can: task checkboxes are ☐ and ☑, a formula is its LaTeX
// (Word's own equations are later), a diagram is a picture where there's a browser to draw it (and its
// code where there isn't), widgets and boards are the lists and tables of their snapshot, and videos
// are links. Built with the `docx` library, which the app loads only when you export.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { LIGHT_TOKENS } from "./staticCss.ts";

/** A picture for Word: PNG, JPEG or GIF bytes and their size in pixels. */
export interface Raster {
  data: Uint8Array;
  type: "png" | "jpg" | "gif";
  width: number;
  height: number;
}

export interface DocxEnv {
  /** Draw an SVG (a diagram, an .svg picture) as a PNG. In a browser, a canvas does; without one, SVGs become their alt text. */
  raster?(svg: string): Promise<Raster | null>;
}

type Block = Paragraph | Table;
const hex = (token: string) => LIGHT_TOKENS[token].replace("#", "");
const MONO = "Consolas";
/** The widest a picture is drawn, in pixels (Word's default page, inside its margins). */
const MAX_WIDTH = 600;

/** The note (its static render, already sanitized) as .docx bytes. */
export async function toDocx(title: string, html: string, env: DocxEnv = {}): Promise<Uint8Array> {
  const root = document.createElement("div");
  root.innerHTML = html; // sanitized last, in renderStatic
  const ctx = new Context(env);
  const children = await ctx.blocks(root, 0);
  const doc = new Document({
    title,
    creator: "Common Ink",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: hex("ink") } } },
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [0, 1, 2, 3, 4, 5].map((level) => ({ level, format: LevelFormat.BULLET, text: ["•", "◦", "▪"][level % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) },
        ...Array.from({ length: ctx.lists }, (_, i) => ({
          reference: `numbers-${i}`,
          levels: [0, 1, 2, 3, 4, 5].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 300 } } } })),
        })),
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.pack(doc, "uint8array");
}

/** How a run looks: the formatting the elements around a piece of text give it. */
type Look = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; color?: string; size?: number; superScript?: boolean; subScript?: boolean; highlight?: boolean };

class Context {
  /** Numbered lists so far: each gets its own numbering, so each starts at 1. */
  lists = 0;
  constructor(private env: DocxEnv) {}

  /** A container's children as Word blocks. `level` is the list depth inside a list item. */
  async blocks(node: Element, level: number, quote = false): Promise<Block[]> {
    const out: Block[] = [];
    let inline: ChildNode[] = [];
    const flush = async () => {
      if (inline.some((n) => n.textContent?.trim() || (n as Element).tagName === "IMG")) out.push(this.para(await this.runs(inline, {}), { quote }));
      inline = [];
    };
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3 || (child.nodeType === 1 && isInline(child as Element))) {
        inline.push(child);
        continue;
      }
      if (child.nodeType !== 1) continue;
      await flush();
      out.push(...(await this.block(child as Element, level, quote)));
    }
    await flush();
    return out;
  }

  async block(e: Element, level: number, quote: boolean): Promise<Block[]> {
    const tag = e.tagName.toLowerCase();
    const cls = e.classList;
    const h = tag.match(/^h([1-6])$/);
    if (h) return [new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][+h[1] - 1], children: await this.runs([...e.childNodes], {}) })];
    if (cls.contains("sr-only")) return [];
    if (tag === "p") return [this.para(await this.runs([...e.childNodes], {}), { quote })];
    if (tag === "ul" || tag === "ol") return this.list(e, tag === "ol" ? `numbers-${this.lists++}` : "bullets", level);
    if (tag === "table") return [await this.table(e)];
    if (tag === "hr") return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex("line"), space: 1 } }, children: [] })];
    if (cls.contains("cb")) return this.code(e);
    if (tag === "pre") return this.code(e);
    if (cls.contains("math-display")) return [new Paragraph({ alignment: AlignmentType.CENTER, children: [this.tex(e)] })];
    if (tag === "figure" && cls.contains("st-diagram")) return [await this.picture(e.querySelector("svg")?.outerHTML ?? null, "Diagram")];
    if (tag === "blockquote" || cls.contains("markdown-alert")) {
      // An alert: its title in its color, then its text, down a bar.
      const body = e.cloneNode(true) as Element;
      const title = body.querySelector(":scope > .markdown-alert-title");
      title?.remove();
      const head = title ? [new Paragraph({ indent: { left: 360 }, border: bar(alertColor(e)), children: [new TextRun({ text: title.textContent?.trim() ?? "", bold: true, color: alertColor(e) })] })] : [];
      return [...head, ...(await this.blocks(body, level, true))];
    }
    if (tag === "details") {
      const summary = e.querySelector(":scope > summary");
      const rest = [...e.childNodes].filter((n) => n !== summary);
      const box = document.createElement("div");
      box.append(...rest.map((n) => n.cloneNode(true)));
      return [...(summary ? [new Paragraph({ children: await this.runs([...summary.childNodes], { bold: true }) })] : []), ...(await this.blocks(box, level, quote))];
    }
    if (cls.contains("st-widget-title") || cls.contains("st-embed-title") || cls.contains("st-card-kind")) return [small(e.textContent ?? "")];
    if (cls.contains("st-board")) return [await this.board(e)];
    if (cls.contains("st-card")) {
      const kind = e.querySelector(".st-card-kind")?.textContent ?? "";
      const name = e.querySelector(".st-card-title")?.textContent ?? "";
      const a = e.querySelector("a");
      return [new Paragraph({ border: bar(hex("line-strong")), indent: { left: 240 }, children: [new TextRun({ text: `${kind}: `, bold: true, color: hex("muted") }), new TextRun({ text: name }), ...(a ? [new TextRun({ text: " " }), link(a.getAttribute("href") ?? "", [new TextRun({ text: a.textContent ?? "", style: "Hyperlink" })])] : [])] })];
    }
    if (tag === "section" && cls.contains("footnotes")) return [small("Footnotes"), ...(await this.blocks(e, level, quote))];
    return this.blocks(e, level, quote || tag === "section");
  }

  para(children: ParagraphChild[], opts: { quote?: boolean } = {}): Paragraph {
    return new Paragraph(opts.quote ? { children, indent: { left: 360 }, border: bar() } : { children });
  }

  /** A list's items, each a numbered or bulleted paragraph; a task shows its box instead of a bullet. */
  async list(e: Element, ref: string, level: number): Promise<Block[]> {
    const out: Block[] = [];
    for (const li of [...e.children].filter((c) => c.tagName === "LI")) {
      const box = li.querySelector(":scope > input[type=checkbox]") as HTMLInputElement | null;
      const nested = [...li.children].filter((c) => c.tagName === "UL" || c.tagName === "OL");
      const own = [...li.childNodes].filter((n) => n !== box && !nested.includes(n as Element));
      const textRuns = await this.runs(own, box?.hasAttribute("checked") ? { color: hex("muted") } : {});
      const lead = box ? [new TextRun({ text: box.hasAttribute("checked") ? "☑ " : "☐ " })] : [];
      out.push(
        new Paragraph(
          box ? { indent: { left: 360 * (level + 1), hanging: 280 }, children: [...lead, ...textRuns] } : { numbering: { reference: ref, level: Math.min(level, 5) }, children: textRuns },
        ),
      );
      for (const n of nested) out.push(...(await this.list(n, n.tagName === "OL" ? `numbers-${this.lists++}` : "bullets", level + 1)));
    }
    return out;
  }

  async table(e: Element): Promise<Table> {
    const rows = [...e.querySelectorAll("tr")];
    const cols = Math.max(1, ...rows.map((r) => r.children.length));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: await Promise.all(
        rows.map(async (r) =>
          new TableRow({
            tableHeader: r.parentElement?.tagName === "THEAD",
            children: await Promise.all(
              [...r.children].map(async (c) =>
                new TableCell({
                  width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
                  shading: c.tagName === "TH" ? { type: ShadingType.CLEAR, fill: hex("bg-side"), color: "auto" } : undefined,
                  children: [new Paragraph({ children: await this.runs([...c.childNodes], c.tagName === "TH" ? { bold: true } : {}) })],
                }),
              ),
            ),
          }),
        ),
      ),
    });
  }

  /** A board: its columns side by side, as a table with a cell per column. */
  async board(e: Element): Promise<Table> {
    const columns = [...e.querySelectorAll(".st-column")];
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: await Promise.all(
            columns.map(async (c) =>
              new TableCell({
                shading: { type: ShadingType.CLEAR, fill: hex("bg-side"), color: "auto" },
                children: [
                  new Paragraph({ children: [new TextRun({ text: c.querySelector(".st-column-title")?.textContent?.trim() ?? "", bold: true })] }),
                  ...(await Promise.all([...c.querySelectorAll(".st-cardline")].map(async (card) => new Paragraph({ children: await this.runs([...card.childNodes], card.classList.contains("is-done") ? { strike: true, color: hex("muted") } : {}) })))),
                ],
              }),
            ),
          ),
        }),
      ],
    });
  }

  /** A code block: its title, then its lines in a shaded block, each run in its highlight color. */
  code(e: Element): Block[] {
    const title = e.querySelector(".cb-title")?.textContent;
    const lines = e.querySelectorAll(".cb-line").length ? [...e.querySelectorAll(".cb-line")] : (e.textContent ?? "").replace(/\n$/, "").split("\n").map((t) => Object.assign(document.createElement("span"), { textContent: t }));
    const shade = { type: ShadingType.CLEAR, fill: hex("code-bg"), color: "auto" };
    return [
      ...(title ? [new Paragraph({ shading: shade, children: [new TextRun({ text: title, font: MONO, bold: true, size: 18, color: hex("muted") })] })] : []),
      ...lines.map((line) => {
        const kind = line.classList.contains("is-add") ? "ok-ink" : line.classList.contains("is-del") ? "bad-ink" : null;
        const runs = [...line.childNodes].map((n) => {
          const c = n.nodeType === 1 ? [...(n as Element).classList].find((x) => x.startsWith("c-")) : undefined;
          const color = kind ? hex(kind) : c && LIGHT_TOKENS[c] ? hex(c) : undefined;
          return new TextRun({ text: (n.textContent ?? "").replace(/\n$/, ""), font: MONO, size: 19, color, italics: c === "c-comment" });
        });
        return new Paragraph({ shading: shade, spacing: { before: 0, after: 0 }, children: runs.length ? runs : [new TextRun({ text: "", font: MONO })] });
      }),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    ];
  }

  /** A formula as its LaTeX, in a math font. */
  tex(e: Element): TextRun {
    return new TextRun({ text: e.getAttribute("data-latex") ?? e.textContent ?? "", font: "Cambria Math", italics: true, color: e.classList.contains("math-error") ? hex("bad-ink") : undefined });
  }

  /** A picture paragraph from an SVG, or its name where there's nothing to draw it with. */
  async picture(svg: string | null, alt: string): Promise<Paragraph> {
    const raster = svg && this.env.raster ? await this.env.raster(svg).catch(() => null) : null;
    return new Paragraph({ alignment: AlignmentType.CENTER, children: [raster ? image(raster, alt) : new TextRun({ text: `[${alt}]`, italics: true, color: hex("muted") })] });
  }

  /** Inline content as runs: text with its formatting, links, pictures, formulas, chips and line breaks. */
  async runs(nodes: ChildNode[], look: Look): Promise<ParagraphChild[]> {
    const out: ParagraphChild[] = [];
    for (const n of nodes) {
      if (n.nodeType === 3) {
        const text = (n.nodeValue ?? "").replace(/\s+/g, " ");
        if (text) out.push(run(text, look));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const tag = e.tagName.toLowerCase();
      if (tag === "br") out.push(new TextRun({ text: "", break: 1 }));
      else if (tag === "input") continue;
      else if (e.classList.contains("math")) out.push(this.tex(e));
      else if (tag === "img") out.push(await this.image(e as HTMLImageElement));
      else if (tag === "svg") continue; // a chip's icon
      else if (e.classList.contains("tk")) out.push(run(` ${e.textContent?.trim()} `, { ...look, size: 17, color: hex("muted") }));
      else if (tag === "a") {
        const href = e.getAttribute("href") ?? "";
        const outside = /^(https?|mailto):/i.test(href);
        // A link out is a Word hyperlink; an in-page one (a footnote, a heading) is just its text.
        const inner = await this.runs([...e.childNodes], outside ? { ...look, color: hex("accent-ink") } : look);
        if (outside) out.push(link(href, inner));
        else out.push(...inner);
      } else {
        const next: Look = { ...look };
        if (tag === "strong" || tag === "b") next.bold = true;
        if (tag === "em" || tag === "i") next.italics = true;
        if (tag === "del" || tag === "s" || e.classList.contains("is-done-text")) next.strike = true;
        if (tag === "code" || tag === "kbd") next.code = true;
        if (tag === "sup") next.superScript = true;
        if (tag === "sub") next.subScript = true;
        if (tag === "mark") next.highlight = true;
        out.push(...(await this.runs([...e.childNodes], next)));
      }
    }
    return out;
  }

  /** A picture: PNG, JPEG and GIF as they are; an SVG drawn by `raster`. Only pictures carried in the document (data: URLs). */
  async image(img: HTMLImageElement): Promise<ParagraphChild> {
    const src = img.getAttribute("src") ?? "";
    const alt = img.getAttribute("alt") || "Picture";
    const m = src.match(/^data:image\/(png|jpeg|gif|svg\+xml)(;base64)?,(.*)$/i);
    if (!m) return new TextRun({ text: `[${alt}]`, italics: true, color: hex("muted") });
    const bytes = m[2] ? base64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
    if (m[1].toLowerCase() === "svg+xml") {
      const raster = this.env.raster ? await this.env.raster(new TextDecoder().decode(bytes)).catch(() => null) : null;
      return raster ? image(raster, alt) : new TextRun({ text: `[${alt}]`, italics: true, color: hex("muted") });
    }
    const type = m[1].toLowerCase() === "jpeg" ? "jpg" : (m[1].toLowerCase() as "png" | "gif");
    const size = imageSize(bytes);
    return size ? image({ data: bytes, type, ...size }, alt) : new TextRun({ text: `[${alt}]`, italics: true, color: hex("muted") });
  }
}

const INLINE = new Set(["a", "abbr", "b", "br", "code", "del", "em", "i", "img", "input", "kbd", "mark", "s", "small", "span", "strong", "sub", "sup", "u", "svg"]);
const isInline = (e: Element) => INLINE.has(e.tagName.toLowerCase()) && !e.classList.contains("math-display") && !e.classList.contains("st-card");

function run(text: string, look: Look): TextRun {
  const opts: IRunOptions = {
    text,
    bold: look.bold,
    italics: look.italics,
    strike: look.strike,
    color: look.color,
    size: look.size,
    superScript: look.superScript,
    subScript: look.subScript,
    highlight: look.highlight ? "yellow" : undefined,
    ...(look.code ? { font: MONO, shading: { type: ShadingType.CLEAR, fill: hex("code-bg"), color: "auto" } } : {}),
  };
  return new TextRun(opts);
}

const link = (href: string, children: ParagraphChild[]) => new ExternalHyperlink({ link: href, children: children as TextRun[] });
const small = (text: string) => new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 16, color: hex("muted") })] });
const bar = (color = hex("line-strong")) => ({ left: { style: BorderStyle.SINGLE, size: 18, color, space: 8 } });
const alertColor = (e: Element) => {
  const kind = [...e.classList].find((c) => c.startsWith("markdown-alert-"))?.slice("markdown-alert-".length);
  return kind && LIGHT_TOKENS[`alert-${kind}`] ? hex(`alert-${kind}`) : hex("accent-ink");
};

function image(r: Raster, alt: string): ImageRun {
  const scale = Math.min(1, MAX_WIDTH / r.width);
  return new ImageRun({ type: r.type, data: r.data, transformation: { width: Math.round(r.width * scale), height: Math.round(r.height * scale) }, altText: { name: alt, description: alt, title: alt } });
}

function base64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A PNG's, JPEG's or GIF's size in pixels, read from its header. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number, le = false) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32(16), height: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16(6, true), height: u16(8, true) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = u16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16(i + 7), height: u16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
