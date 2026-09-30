import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { detailsIn, wrapInDetails } from "../src/core/details.ts";

const { renderMarkdown } = await import("../web/src/render.ts");

const NOTE = `# Meeting

<details>
<summary>Transcript</summary>

Long **talk**.

<details open><summary>Aside</summary>

- a list

</details>

</details>

\`\`\`html
<details>
<summary>Not a section</summary>
</details>
\`\`\`

<details>
No summary here.
</details>

<details><summary>One line</summary>tiny</details>

<details>
<summary>Transcript</summary>
never closed
`;

test("a <details> block with its summary, nested ones, and one without a summary; code and unclosed ones don't count", () => {
  assert.deepEqual(
    detailsIn(NOTE).map((d) => [d.from, d.close, d.summaryLine, d.summary, d.open, d.depth, d.key]),
    [
      [2, 13, 3, "Transcript", false, 0, "Transcript"],
      [7, 11, 7, "Aside", true, 1, "Aside"],
      [21, 23, null, "Details", false, 0, "Details"],
    ],
  );
});

test("two sections with the same summary are told apart, so each is remembered open or closed", () => {
  const md = "<details>\n<summary>Log</summary>\na\n</details>\n\n<details>\n<summary>**Log**</summary>\nb\n</details>\n";
  assert.deepEqual(detailsIn(md).map((d) => d.key), ["Log", "**Log**"]);
  assert.deepEqual(detailsIn(md.replace("**Log**", "Log")).map((d) => d.key), ["Log", "Log#2"]);
});

test("wrapping text makes a section GitHub renders, with blank lines around its markdown", () => {
  assert.equal(wrapInDetails("- one\n- two\n"), "<details>\n<summary>Details</summary>\n\n- one\n- two\n\n</details>");
  assert.equal(wrapInDetails("", "Spoiler"), "<details>\n<summary>Spoiler</summary>\n\n\n\n</details>");
});

test("rendered markdown keeps a native <details> with its summary and open, and the markdown inside", () => {
  const html = renderMarkdown("<details open>\n<summary>More</summary>\n\n**bold** and [[Note]]\n\n</details>", "a.md");
  assert.equal(
    html,
    '<details open="">\n<summary>More</summary><p><strong>bold</strong> and <a href="quire:Note">Note</a></p>\n</details>',
  );
  const hostile = renderMarkdown('<details ontoggle="alert(1)" open><summary onclick="x()">s</summary>t</details>', "a.md");
  assert.equal(/ontoggle|onclick/.test(hostile), false, hostile);
});
