// The user docs: each built page in web/public/docs matches its markdown in docs/guide, and links between pages land.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GUIDE, OUT, PAGES, querySyntaxMarkdown, renderDocs, withGenerated } from "../scripts/docs.ts";
import { SYNTAX } from "../src/core/queryGrammar.ts";

test("every docs page is built from its markdown (npm run docs)", () => {
  const built = renderDocs();
  assert.deepEqual(Object.keys(built).sort(), PAGES.map((p) => `${p}.html`).sort());
  for (const [file, html] of Object.entries(built)) {
    const have = fs.existsSync(path.join(OUT, file)) ? fs.readFileSync(path.join(OUT, file), "utf8") : null;
    assert.ok(have === html, `web/public/docs/${file} is out of date: run npm run docs`);
  }
});

test("links between docs pages and to their sections land somewhere", () => {
  const built = renderDocs();
  const ids = (html: string) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const [file, html] of Object.entries(built)) {
    assert.doesNotMatch(html, /href="[\w-]+\.(md|html)/, `${file} links a page by its file name`);
    for (const [, page, hash] of html.matchAll(/href="\/docs\/([\w-]+)?(?:#([\w-]+))?"/g)) {
      const target = built[`${page ?? "index"}.html`];
      assert.ok(target, `${file} links /docs/${page}, which isn't a page`);
      if (hash) assert.ok(ids(target).has(hash), `${file} links /docs/${page ?? ""}#${hash}, which isn't a heading there`);
    }
    assert.match(html, /<title>[^<]+ · Common Ink docs<\/title>/);
    assert.match(html, /aria-current="page"/);
  }
});

test("the query syntax in the guide is the app's, from queryGrammar.ts (npm run docs)", () => {
  for (const name of PAGES) {
    const md = fs.readFileSync(path.join(GUIDE, `${name}.md`), "utf8");
    assert.ok(withGenerated(md) === md, `docs/guide/${name}.md's query syntax is out of date: run npm run docs`);
  }
  const notes = fs.readFileSync(path.join(GUIDE, "notes.md"), "utf8");
  assert.ok(notes.includes(querySyntaxMarkdown()), "notes.md has the query syntax table");
  const html = renderDocs()["notes.html"];
  for (const e of SYNTAX) assert.ok(html.includes(`<code>${e.example.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</code>`), `notes.html shows ${e.example}`);
});
