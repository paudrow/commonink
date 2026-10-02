import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderMarkdown } = await import("../web/src/render.ts");

test("[[links]], ![[embeds]] and relative images inside code stay as written", () => {
  assert.equal(
    renderMarkdown("Link with `[[Note name]]`, embed with `![[pic.png]]`, or ``![x](pic.png)``.", "a.md"),
    "<p>Link with <code>[[Note name]]</code>, embed with <code>![[pic.png]]</code>, or <code>![x](pic.png)</code>.</p>\n",
  );
  assert.equal(renderMarkdown("```\n[[Note name]]\n![[Other]]\n```", "a.md"), "<pre data-code-info=\"\"><code>[[Note name]]\n![[Other]]\n</code></pre>\n");
  assert.equal(renderMarkdown("Text\n\n    [[Note name]]", "a.md"), "<p>Text</p>\n<pre data-code-info=\"\"><code>[[Note name]]\n</code></pre>\n");
});

test("links outside code still render, on the same line as code and after a fence closes", () => {
  assert.equal(renderMarkdown("[[A|see A]] then `[[B]]` then [[C#Plan]]", "a.md"), '<p><a href="commonink:A">see A</a> then <code>[[B]]</code> then <a href="commonink:C%23Plan">C › Plan</a></p>\n');
  assert.equal(renderMarkdown("~~~\n[[B]]\n~~~\n\n![[D]]", "a.md"), '<pre data-code-info=""><code>[[B]]\n</code></pre>\n<p><a href="commonink:D">↳ D</a></p>\n');
  assert.equal(renderMarkdown("An unclosed ` backtick and [[E]]", "a.md"), '<p>An unclosed ` backtick and <a href="commonink:E">E</a></p>\n');
  assert.equal(renderMarkdown("| Note | Why |\n| - | - |\n| [[F|the F]] | `[[G]]` |", "a.md").replace(/\n/g, ""), '<table><thead><tr><th>Note</th><th>Why</th></tr></thead><tbody><tr><td><a href="commonink:F">the F</a></td><td><code>[[G]]</code></td></tr></tbody></table>');
});

test("relative images with a title, angle brackets or a data: URL render where the editor shows them", () => {
  assert.equal(renderMarkdown('![a](pic.png "A title")', "n/a.md"), '<p><img src="/api/file-resolve?target=pic.png&amp;from=n%2Fa.md" alt="a" title="A title"></p>\n');
  assert.equal(renderMarkdown("![a](<my pic.png>)", "a.md"), '<p><img src="/api/file-resolve?target=my%20pic.png&amp;from=a.md" alt="a"></p>\n');
  assert.equal(renderMarkdown("![a](data:image/png;base64,iVBORw0KGgo=)", "a.md"), '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="a"></p>\n');
});

test("a link or embed target with a parenthesis stays whole", () => {
  assert.equal(renderMarkdown("[[a)b]]", "a.md"), '<p><a href="commonink:a%29b">a)b</a></p>\n');
  assert.equal(renderMarkdown("![[weird).png]]", "a.md"), '<p><img src="/api/file-resolve?target=weird%29.png&amp;from=a.md" alt="weird).png"></p>\n');
  assert.equal(renderMarkdown("![[(note]]", "a.md"), '<p><a href="commonink:%28note">↳ (note</a></p>\n');
});
