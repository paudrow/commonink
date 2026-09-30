// Export a note as a file to download: its Markdown as it is, or one self-contained HTML page (the
// static render, with its stylesheet, pictures and diagrams inside, and math as MathML, which browsers
// draw without fonts).
import { staticDoc } from "./print.ts";
import { renderStatic } from "./static.ts";
import { appSources } from "./sources.ts";
import { STATIC_CSS } from "./staticCss.ts";
import { escapeHtml } from "../dom.ts";
import type { Printable } from "./print.ts";

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

/** The note's markdown, exactly as it's stored. */
export function exportMarkdown(note: Printable) {
  download(fileName(note.path, "md"), new Blob([note.content], { type: "text/markdown;charset=utf-8" }));
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
