// Word export (web/src/export/docx.ts): the static render as a .docx, checked by unzipping it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import type { StaticSources } from "../web/src/export/static.ts";

const { renderStatic } = await import("../web/src/export/static.ts");
const { toDocx, imageSize } = await import("../web/src/export/docx.ts");

/** A 3×2 red PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEklEQVR4nGP4z8DAwMDAxAAABhQBAUcS9wMAAAAASUVORK5CYII=";

const sources: StaticSources = {
  note: async () => null,
  url: async () => null,
  tasks: async () => [],
  feed: async () => [],
  today: async () => ({ date: "2040-01-01", sections: [], journal: { path: "", exists: false } }),
  math: () => import("../web/src/mathRender.ts"),
  image: async () => `data:image/png;base64,${PNG}`,
};

const NOTE = `# Report

Some **bold**, *italic* and \`code\`, and [a link](https://example.com).

## Tasks

- [ ] Open task
- [x] Done task

1. First
2. Second
   - nested

| Name | Count |
| --- | --- |
| Apples | 3 |

\`\`\`ts
const x = 1;
\`\`\`

> [!WARNING]
> Be careful.

Area $A = \\pi r^2$.

![chart](chart.png)
`;

async function word(md: string) {
  const html = await renderStatic("Report.md", md, sources);
  const files = unzipSync(await toDocx("Report", html));
  return { doc: strFromU8(files["word/document.xml"]), rels: strFromU8(files["word/_rels/document.xml.rels"]), files: Object.keys(files) };
}

test("a note becomes a Word document with Word's own headings, lists, tables, links and pictures", async () => {
  const { doc, rels, files } = await word(NOTE);
  const text = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");
  for (const s of ["Report", "bold", "italic", "code", "a link", "☐ ", "Open task", "☑ ", "Done task", "First", "nested", "Apples", "const", "Be careful.", "A = \\pi r^2"]) assert.ok(text.includes(s), `has ${s}: ${text}`);
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(doc, /<w:b\/>[\s\S]*?<w:t[^>]*>bold</, "bold stays bold");
  assert.match(doc, /<w:numPr>/, "lists are Word lists");
  assert.match(doc, /<w:tbl>/, "tables are Word tables");
  assert.match(doc, /w:ascii="Consolas"/, "code is monospace");
  assert.match(doc, /<w:color w:val="8a3fd1"\/>[\s\S]*?<w:t[^>]*>const</, "code keeps its keyword color");
  assert.match(doc, /<w:color w:val="9a6700"\/>[\s\S]*?<w:t[^>]*>Warning</, "an alert's title has its color");
  assert.match(rels, /Target="https:\/\/example.com"/, "links go where they did");
  assert.ok(files.some((f) => /^word\/media\/.+\.png$/.test(f)), "the picture is inside the file");
});

test("without a browser to draw them, SVG pictures and diagrams are named in their place", async () => {
  const html = '<figure class="st-diagram"><svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg></figure><p><img src="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E" alt="Logo"></p>';
  const doc = strFromU8(unzipSync(await toDocx("T", html))["word/document.xml"]);
  assert.ok(doc.includes("[Diagram]") && doc.includes("[Logo]"));
});

test("a picture's size is read from its header", () => {
  const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  assert.deepEqual(imageSize(png), { width: 3, height: 2 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});
