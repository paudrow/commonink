// The user docs at commonink.app/docs: each page is markdown in docs/guide (readable on GitHub
// too), built into a static page in web/public/docs that the Worker serves like /privacy. Run
// `npm run docs` after changing a page; test/docs.test.ts fails while a built page is out of date.
// The query syntax table is filled in from src/core/queryGrammar.ts, so it can't drift from the app.
//   npm run docs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { SYNTAX } from "../src/core/queryGrammar.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GUIDE = path.join(ROOT, "docs/guide");
export const OUT = path.join(ROOT, "web/public/docs");

/** The pages, in the order the sidebar lists them. */
export const PAGES = ["index", "import", "agents", "notes", "sharing", "cli", "faq"];

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const href = (name: string) => (name === "index" ? "/docs/" : `/docs/${name}`);

/**
 * The query syntax, as a markdown table, from SYNTAX in src/core/queryGrammar.ts: the one list the
 * app's Query syntax page (/query-help) and `commonink help query` draw from too. A guide page puts
 * it between <!-- query-syntax --> and <!-- /query-syntax -->, and `npm run docs` fills it in.
 */
export function querySyntaxMarkdown(): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const code = (s: string) => "`" + cell(s) + "`";
  const rows = SYNTAX.map((e) => `| ${e.group} | ${code(e.syntax)} | ${code(e.example)} | ${cell(e.about)} |`);
  return ["| | Write | Try | What it does |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

const SYNTAX_BLOCK = /(<!-- query-syntax -->)[\s\S]*?(<!-- \/query-syntax -->)/g;

/** A guide page with its generated blocks filled in from the code. */
export const withGenerated = (md: string) => md.replace(SYNTAX_BLOCK, (_m, open: string, close: string) => `${open}\n${querySyntaxMarkdown()}\n${close}`);

function read(name: string) {
  const md = withGenerated(fs.readFileSync(path.join(GUIDE, `${name}.md`), "utf8"));
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  const meta: Record<string, string> = {};
  for (const line of m?.[1].split("\n") ?? []) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { title: meta.title ?? name, description: meta.description ?? "", body: m ? md.slice(m[0].length) : md };
}

/** Each built page, by file name. */
export function renderDocs(): Record<string, string> {
  const pages = PAGES.map((name) => ({ name, ...read(name) }));
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      // Links between pages are written as GitHub reads them (import.md#notion); the site has no .md.
      if (token.type === "link" && /^[\w-]+\.md(#.*)?$/.test(token.href)) {
        const [file, hash = ""] = token.href.split("#");
        token.href = href(file.replace(/\.md$/, "")) + (hash ? `#${hash}` : "");
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = text.replace(/<[^>]+>/g, "").toLowerCase().replace(/&\w+;/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
        return depth === 1 ? `<h1>${text}</h1>\n` : `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
      },
    },
  });
  const out: Record<string, string> = {};
  for (const p of pages) {
    const nav = pages.map((q) => `<a href="${href(q.name)}"${q.name === p.name ? ' aria-current="page"' : ""}>${escape(q.title)}</a>`).join("\n        ");
    out[`${p.name}.html`] = `<!doctype html>
<!-- Built by scripts/docs.ts from docs/guide/${p.name}.md: edit that, then npm run docs. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(p.title)} · Common Ink docs</title>
    <meta name="description" content="${escape(p.description)}" />
    <meta property="og:title" content="${escape(p.title)} · Common Ink docs" />
    <meta property="og:description" content="${escape(p.description)}" />
    <meta property="og:image" content="/social.png" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/docs/docs.css" />
  </head>
  <body>
    <header class="top">
      <a class="brand" href="/"><img src="/favicon.svg" alt="" />Common Ink</a>
      <span class="section">Docs</span>
      <a class="open" href="/">Open Common Ink</a>
    </header>
    <div class="layout">
      <nav aria-label="Docs">
        ${nav}
      </nav>
      <main>
${marked.parse(p.body) as string}
        <footer>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="https://github.com/paudrow/commonink">GitHub</a>
          <a href="mailto:support@commonink.app">support@commonink.app</a>
        </footer>
      </main>
    </div>
  </body>
</html>
`;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of PAGES) {
    const file = path.join(GUIDE, `${name}.md`);
    const md = fs.readFileSync(file, "utf8");
    if (withGenerated(md) !== md) fs.writeFileSync(file, withGenerated(md));
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, html] of Object.entries(renderDocs())) fs.writeFileSync(path.join(OUT, file), html);
  console.log(`Built ${PAGES.length} pages into ${path.relative(ROOT, OUT)}`);
}
