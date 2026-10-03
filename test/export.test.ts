// Print and export (web/src/export): a note as static HTML, the same for paper and files.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { StaticSources } from "../web/src/export/static.ts";

const { renderStatic } = await import("../web/src/export/static.ts");
const { ALERT_ICONS, LIGHT_TOKENS } = await import("../web/src/export/staticCss.ts");

const NOTES: Record<string, string> = {
  "Launch.md": "# Launch\n\nThe plan in short.\n\n## Risks\n\n- Slipping dates\n\n## Later\n\nNot this.",
  "Board.md": ":::kanban\n## Doing\n- [ ] Write copy due:2040-10-02\n\n## Done\n- [x] Pick a name\n:::",
};

const sources = (over: Partial<StaticSources> = {}): StaticSources => ({
  note: async (target) => {
    const path = `${target.replace(/\.md$/, "")}.md`;
    return NOTES[path] ? { path, title: path.replace(/\.md$/, ""), content: NOTES[path], url: `https://ink.test/notes/${path.replace(/\.md$/, "").toLowerCase()}-abcd2345` } : null;
  },
  url: async (target) => (NOTES[`${target.replace(/\.md$/, "")}.md`] ? `https://ink.test/notes/${target.toLowerCase()}-abcd2345` : null),
  tasks: async () => [
    { path: "Launch.md", title: "Launch", line: 3, text: "Ship it due:2040-10-01 !high", summary: "Ship it", done: false, heading: null, meta: { priority: "high", due: "2040-10-01", start: null, rec: null, done: null, until: null, times: null, assignees: [], tags: [] } as never },
    { path: "Launch.md", title: "Launch", line: 4, text: "Done already", summary: "Done already", done: true, heading: null, meta: { priority: null, due: null, start: null, rec: null, done: null, until: null, times: null, assignees: [], tags: [] } as never },
  ],
  feed: async () => [{ id: "abcd2345", path: "Launch.md", kind: "md", title: "Launch", mtime: 0, archived: false, excerpt: "The plan in short.", tags: [], lines: [], lastSource: null, lastBy: null, role: null }],
  today: async () => ({ date: "2026-09-29", sections: [], journal: { path: "Journal/2026-09-29.md", exists: false } }),
  math: () => import("../web/src/mathRender.ts"),
  diagram: async (code) => `<svg xmlns="http://www.w3.org/2000/svg" id="qd-1"><style>#qd-1 .node{fill:#fff}</style><text>${code.length} chars</text></svg>`,
  ...over,
});

const NOTE = `---
status: draft
owner: Audrow
---
# Demo

Some **bold** text and a link to [[Launch]], and one to [[Nowhere]].

- [ ] Call the printer due:2040-10-01 @sam
- [x] Book the room

\`\`\`ts
const answer: number = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x\\,dx
$$

::view{show=tasks folder=Projects}

::view{folder=Projects label="Active"}

::timer{duration=25m label="Focus"}

![[Launch#Risks]]

![[Board]]

https://www.youtube.com/watch?v=dQw4w9WgXcQ

<details><summary>More</summary>

Hidden until opened.

</details>
`;

const parse = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

/** The words a reader sees in a node: its text with a space between elements, no styles, and a formula as ⟨math⟩. */
function words(n: Node): string {
  const parts: string[] = [];
  const walk = (x: Node) => {
    if (x.nodeType === 3) parts.push(x.nodeValue ?? "");
    if (x.nodeType !== 1) return;
    const e = x as Element;
    if (e.tagName.toLowerCase() === "style") return;
    if (e.classList.contains("katex")) return void parts.push("⟨math⟩ ");
    for (const c of e.childNodes) walk(c);
    parts.push(" ");
  };
  walk(n);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** What a static render holds, top to bottom: each top-level block, by what it is and the words it starts with. */
function outline(html: string): string[] {
  return [...parse(html).children].map((n) => {
    const cls = n.getAttribute("class")?.split(" ")[0];
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ""}: ${words(n).slice(0, 48)}`;
  });
}

test("a note renders as static HTML: markup hidden, widgets and embeds as snapshots, code, math and diagrams drawn", async () => {
  const html = await renderStatic("Demo.md", NOTE, sources());
  assert.deepEqual(outline(html), [
    "h1: Demo",
    "p: Some bold text and a link to Launch , and one to",
    "ul: Call the printer Oct 1, 2040 S sam Book the room",
    "div.cb: ts const answer : number = 42 ;",
    "figure.st-diagram: 22 chars",
    "p: Inline math ⟨math⟩ and a block:",
    "div.math: ⟨math⟩",
    "div.st-widget: Tasks Launch Ship it High Oct 1, 2040",
    "div.st-widget: Notes · Active Launch — The plan in short.",
    "div.st-widget: Timer · Focus 25m timer",
    "section.st-embed: Launch › Risks Risks Slipping dates",
    "section.st-embed: Board Doing 1 Write copy Oct 2, 2040 Done 1 Pick",
    "div.st-card: YouTube youtube.com https://www.youtube.com/watc",
    "details: More Hidden until opened.",
  ]);
  const d = parse(html);
  assert.equal(d.querySelector('a[href^="https://ink.test/notes/launch"]')?.textContent, "Launch", "a link to a note goes to its web address");
  assert.equal(d.querySelector(".st-link")?.textContent, "Nowhere", "a link to no note stays as its words");
  assert.ok([...d.querySelectorAll("input[type=checkbox]")].every((b) => b.hasAttribute("disabled")), "checkboxes are drawn, not live");
  assert.ok(d.querySelector("details")!.hasAttribute("open"), "collapsed sections open for paper");
  assert.ok(d.querySelector(".cb .c-keyword"), "code is highlighted with the stable classes the export stylesheet colors");
  assert.equal(d.querySelector("table.st-props"), null, "properties are left out by default");
  assert.equal(d.querySelector(".st-widget")!.textContent!.includes("Done already"), false, "a tasks ::view shows open tasks, as the widget does");
  assert.ok(d.querySelector("#qd-1 style"), "a diagram keeps the style its SVG scopes to itself");
});

test("properties can be included, closed sections kept closed, and math written as MathML for a file", async () => {
  const d = parse(await renderStatic("Demo.md", NOTE, sources(), { frontmatter: true, keepFolds: true, math: "mathml" }));
  assert.deepEqual([...d.querySelectorAll(".st-props tr")].map((r) => r.textContent), ["statusdraft", "ownerAudrow"]);
  assert.equal(d.querySelector("details")!.hasAttribute("open"), false);
  assert.ok(d.querySelector(".math math"), "MathML is kept");
  assert.equal(d.querySelector(".katex-html"), null, "KaTeX's HTML, which needs its stylesheet and fonts, is left out");
});

test("GitHub's markdown comes through: alerts, footnotes, heading links and emoji, with collapsible alerts open", async () => {
  const md = "# Plan\n\nSee [the risks](#risks) and a note.[^1] :tada:\n\n> [!WARNING]\n> Dates may slip.\n\n> [!NOTE]-\n> Folded by default.\n\n## Risks\n\nSome.\n\n[^1]: The footnote.";
  const d = parse(await renderStatic("Plan.md", md, sources()));
  assert.deepEqual([...d.querySelectorAll(".markdown-alert")].map((a) => [a.tagName, a.className.split(" ").find((c) => c.startsWith("markdown-alert-")), a.hasAttribute("open")]), [
    ["DIV", "markdown-alert-warning", false],
    ["DETAILS", "markdown-alert-note", true],
  ]);
  const risks = d.querySelector<HTMLAnchorElement>('a[href*="risks"]')!;
  assert.ok(d.querySelector(`[id="${risks.getAttribute("href")!.slice(1)}"]`), `the heading link finds its heading: ${risks.getAttribute("href")}`);
  const ref = d.querySelector<HTMLAnchorElement>(".footnote-ref a")!;
  assert.ok(d.querySelector(`[id="${ref.getAttribute("href")!.slice(1)}"]`)?.textContent?.includes("The footnote."), "a footnote reference finds its footnote");
  assert.ok(d.textContent!.includes("🎉"));
});

test("without a diagram renderer (no browser), a diagram shows as its code", async () => {
  const d = parse(await renderStatic("Demo.md", "```mermaid\nflowchart LR\n  A --> B\n```", sources({ diagram: undefined })));
  assert.equal(d.querySelector(".cb")?.getAttribute("data-lang"), "mermaid");
});

test("embeds stop at two levels and never draw a note inside itself", async () => {
  NOTES["Loop.md"] = "# Loop\n\n![[Loop]]\n\n![[Deep]]";
  NOTES["Deep.md"] = "# Deep\n\n![[Deeper]]";
  NOTES["Deeper.md"] = "# Deeper\n\n![[Launch]]";
  const d = parse(await renderStatic("Loop.md", NOTES["Loop.md"], sources()));
  assert.equal(d.querySelectorAll("section.st-embed").length, 2, "Deep, then Deeper inside it");
  assert.deepEqual([...d.querySelectorAll(".st-card .st-card-title")].map((n) => n.textContent), ["Loop", "Launch"], "itself, and the third level, are cards");
});

test("nothing in a note, a diagram or an embed can run in the static HTML", async () => {
  NOTES["Evil.md"] = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><style>body{display:none}</style><form action="https://evil.test"><input name=p></form>';
  const hostile = `# Hi\n\n<script>alert(1)</script>\n\n<svg><script>alert(2)</script><a href="javascript:alert(3)"><text>x</text></a></svg>\n\n<iframe src="https://evil.test"></iframe>\n\n![[Evil]]\n\n\`\`\`mermaid\nflowchart LR\n\`\`\`\n\n[x](javascript:alert(4))`;
  const html = await renderStatic("Hostile.md", hostile, sources({ diagram: async () => '<svg><script>alert(5)</script><foreignObject><img src=x onerror="alert(6)"></foreignObject><a href="javascript:alert(7)"><text>t</text></a></svg>' }));
  const d = parse(html);
  assert.equal(d.querySelector("script, iframe, form, foreignObject, style:not(svg style)"), null, html);
  assert.ok(![...d.querySelectorAll("*")].some((n) => [...n.attributes].some((a) => a.name.startsWith("on") || /javascript:/i.test(a.value))), html);
});

test("the export stylesheet's colors are the app's light theme", () => {
  const css = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  // Every plain `:root {` block (the light theme), not the dark ones.
  const blocks = [...css.matchAll(/^:root \{([^}]*)\}/gm)].map((m) => m[1]);
  const light = Object.fromEntries(blocks.flatMap((b) => [...b.matchAll(/--([\w-]+):\s*([^;]+);/g)]).map((m) => [m[1], m[2].trim()]));
  for (const [k, v] of Object.entries(LIGHT_TOKENS)) assert.equal(v, light[k], `--${k}`);
  for (const [k, url] of Object.entries(ALERT_ICONS)) assert.ok(css.includes(`.markdown-alert-${k}, .cm-alert-${k} { --alert: var(--alert-${k}); --alert-icon: ${url}; }`), `${k}'s icon`);
});

test("a note's title can't break out of the print header or the exported page's <title>", async () => {
  const { cssString, pageRules } = await import("../web/src/export/print.ts");
  const { htmlDocument, fileName } = await import("../web/src/export/files.ts");
  const title = 'Q3 "plan"; } body { display: none } \\ </style><script>alert(1)</script>\nnext';
  const css = cssString(title);
  assert.match(css, /^"[^"]*"$/, "one string: its own quotes are escaped");
  assert.doesNotMatch(css.slice(1, -1), /["\n]|\\(?![0-9a-f]+ )/, "no quote, line break or bare backslash can end the string");
  assert.ok(pageRules(title, new Date("2026-09-29T12:00:00Z")).includes(`@top-left { content: ${css};`));
  const page = htmlDocument(title, "<p>Hi</p>", new Date("2026-09-29T12:00:00Z"));
  assert.ok(page.includes("<title>Q3 &quot;plan&quot;; } body { display: none } \\ &lt;/style&gt;&lt;script&gt;"), "the title is escaped");
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">`), "the file allows nothing to run");
  assert.equal(fileName("Projects/Q3 plan.md", "html"), "Q3 plan.html");
});
