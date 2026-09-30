// Export as a file to download: a note's Markdown as it is (with its pictures and files, as a .zip,
// if it uses any), one self-contained HTML page (the static render, with its stylesheet, pictures and
// diagrams inside, and math as MathML, which browsers draw without fonts), a Word document (docx.ts),
// or notes as a .zip from the server (a selection, a folder, everything: core/export.ts).
import { staticDoc } from "./print.ts";
import { renderStatic } from "./static.ts";
import { appSources } from "./sources.ts";
import { STATIC_CSS } from "./staticCss.ts";
import { escapeHtml } from "../dom.ts";
import { api } from "../api.ts";
import type { Printable } from "./print.ts";
import type { Raster } from "./docx.ts";

/** The file name for a note's export: its own name, with the new extension. */
export const fileName = (path: string, ext: string) => `${(path.split("/").pop() ?? "Note").replace(/\.(md|html?)$/i, "")}.${ext}`;

/** Hand the browser a file to save. */
export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A note that shows pictures or embeds files: its Markdown alone wouldn't carry them. */
export const usesFiles = (md: string) => /!\[\[[^[\]|#\n]+\.[a-z0-9]{1,5}(?:[#|][^[\]\n]*)?\]\]|!\[[^[\]\n]*\]\((?!https?:)[^()\s]+\)/i.test(md);

/**
 * The note's markdown, exactly as it's stored. If it uses pictures or files, they come too: the note
 * and its files as a .zip, laid out as in the workspace so the links still work. Says which it made.
 */
export async function exportMarkdown(note: Printable): Promise<string> {
  if (!usesFiles(note.content)) {
    download(fileName(note.path, "md"), new Blob([note.content], { type: "text/markdown;charset=utf-8" }));
    return fileName(note.path, "md");
  }
  const zip = await api.exportZip({ paths: [note.path] });
  download(zip.name, zip.data);
  return `${zip.name}, with its files`;
}

/** Notes as a .zip: some by path, a folder, or everything. Returns the file's name. */
export async function exportZip(what: { paths?: string[]; folder?: string; all?: boolean }): Promise<string> {
  const zip = await api.exportZip(what);
  download(zip.name, zip.data);
  return zip.name;
}

/** The note as a Word document: its static render, pictures and diagrams drawn in. */
export async function exportDocx(note: Printable, opts: { frontmatter?: boolean } = {}) {
  const [{ toDocx }, body] = await Promise.all([import("./docx.ts"), renderStatic(note.path, note.content, appSources(staticDoc(), { images: true }), { ...opts, math: "katex" })]);
  const data = await toDocx(note.title, body, { raster: rasterize });
  download(fileName(note.path, "docx"), new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
}

/** An SVG drawn as a PNG, at twice its size for sharpness, for Word (which wants a picture it can show anywhere). */
export async function rasterize(svg: string): Promise<Raster | null> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const box = doc.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  // Its size in pixels: width and height when they're lengths, else the viewBox (Mermaid says width="100%").
  const px = (v: string | null) => (v && /^\d+(\.\d+)?(px)?$/.test(v.trim()) ? parseFloat(v) : 0);
  const width = Math.round(px(doc.getAttribute("width")) || box?.[2] || 0);
  const height = Math.round(px(doc.getAttribute("height")) || box?.[3] || 0);
  if (!width || !height || width > 8000 || height > 8000) return null;
  doc.setAttribute("width", String(width));
  doc.setAttribute("height", String(height));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [width * 2, height * 2];
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? { data: new Uint8Array(await blob.arrayBuffer()), type: "png", width, height } : null;
}

/** The note as one HTML file that opens anywhere, with nothing to fetch but pictures from the web. */
export async function exportHtml(note: Printable, opts: { frontmatter?: boolean } = {}) {
  const body = await renderStatic(note.path, note.content, appSources(staticDoc(), { images: true }), { ...opts, math: "mathml" });
  download(fileName(note.path, "html"), new Blob([htmlDocument(note.title, body, new Date())], { type: "text/html;charset=utf-8" }));
}

/**
 * A static render (already sanitized) as a whole page. Its own CSP lets it show styles and pictures
 * and nothing else, so even something that got past sanitizing couldn't run.
 */
export function htmlDocument(title: string, body: string, date: Date): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Common Ink">
<meta name="date" content="${date.toISOString()}">
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0; padding: 48px 24px; background: #fff; }
@media print { body { padding: 0; } }
${STATIC_CSS}
</style>
</head>
<body>
<article class="st-doc">
${body}
</article>
</body>
</html>
`;
}
