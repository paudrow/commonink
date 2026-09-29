// Code blocks outside the source view (web/src/code.ts): the same look in the editor and in rendered markdown.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { highlight, hydrateCode, renderCodeBlock } = await import("../web/src/code.ts");
const { codeLanguage } = await import("../web/src/codeLanguage.ts");
const { renderMarkdown } = await import("../web/src/render.ts");

test("fence languages resolve by name, alias or extension, and plain-text names stay plain", () => {
  const name = (n: string) => codeLanguage(n)?.name ?? null;
  assert.deepEqual(
    ["js", "ts", "sh", "bash", "zsh", "py", "yml", "jsonc", "diff", "patch", "dockerfile", "sql", "rs", "md", "Python", "c++"].map(name),
    ["JavaScript", "TypeScript", "Shell", "Shell", "Shell", "Python", "YAML", "JSON", "diff", "diff", "Dockerfile", "SQL", "Rust", "Markdown", "Python", "C++"],
  );
  assert.deepEqual(["", "text", "txt", "plaintext", "console", "nosuchlanguage"].map(name), [null, null, null, null, null, null]);
});

test("highlighting uses the editor's grammar, line by line, and keeps every character", async () => {
  const code = "const a = 1;\n\n// done";
  const lines = await highlight(code, "ts");
  assert.equal(lines.map((l) => l.map(([t]) => t).join("")).join("\n"), code);
  assert.equal(lines.length, 3);
  const keyword = lines[0].find(([t]) => t === "const");
  assert.ok(keyword && keyword[1], "const has a highlight class");
  assert.deepEqual(await highlight("x <y>", "nosuchlanguage"), [[["x <y>", ""]]]);
});

test("rendered markdown keeps a fence's info string, escaped, for the code block to read", () => {
  const html = renderMarkdown('```ts nowrap title="a.ts"\nif (a < b) {}\n```\n', "n.md");
  assert.equal(html, '<pre data-code-info="ts nowrap title=&quot;a.ts&quot;"><code class="language-ts">if (a &lt; b) {}\n</code></pre>\n');
  const hostile = renderMarkdown('```"><img src=x onerror=alert(1)>\n<script>alert(1)</script>\n```\n', "n.md");
  const parsed = document.createElement("div");
  parsed.innerHTML = hostile;
  assert.deepEqual([...parsed.querySelectorAll("*")].map((e) => e.tagName), ["PRE", "CODE"], "only the block, the rest is text");
  assert.equal(parsed.querySelector("pre")!.dataset.codeInfo, '"><img src=x onerror=alert(1)>');
});

test("a rendered block shows its title, language and copy button, and draws nowrap and diff lines", () => {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown('```diff nowrap title="patch"\n+added\n-removed\n kept\n```\n', "n.md");
  hydrateCode(root);
  const box = root.querySelector<HTMLElement>(".cb")!;
  assert.equal(box.className, "cb is-nowrap");
  assert.equal(box.querySelector(".cb-title")!.textContent, "patch");
  assert.equal(box.querySelector(".cb-lang")!.textContent, "diff");
  assert.ok(box.querySelector(".cb-copy"));
  assert.deepEqual([...box.querySelectorAll(".cb-line")].map((l) => `${l.className}|${l.textContent}`), ["cb-line is-add|+added", "cb-line is-del|-removed", "cb-line| kept"]);
  assert.equal(box.querySelector(".cb-wrap"), null, "rendered markdown can't change the note");
});

test("in the editor, a block offers the language picker and the wrap toggle, and marks the lines it's told to", () => {
  const box = renderCodeBlock("a\nb\nc", "js {2} showLineNumbers", { setInfo() {}, edit() {} });
  assert.equal(box.className, "cb has-numbers");
  assert.deepEqual([...box.querySelectorAll(".cb-btn")].map((b) => b.className), ["cb-btn cb-lang", "cb-btn cb-wrap is-on", "cb-btn cb-copy"]);
  assert.deepEqual([...box.querySelectorAll(".cb-line")].map((l) => l.className), ["cb-line", "cb-line is-marked", "cb-line"]);
});

test("the code under the cursor is the block's lines without its fences or their indent", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { ensureSyntaxTree } = await import("@codemirror/language");
  const { markdownWithFrontmatter } = await import("../web/src/editor/language.ts");
  const { codeAt } = await import("../web/src/editor/blocks.ts");
  const doc = "Intro\n\n- item\n\n  ```py\n  def f():\n      return 1\n  ```\n\n```\n```\n";
  const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
  ensureSyntaxTree(state, doc.length, 5000);
  assert.equal(codeAt(state, doc.indexOf("return")), "def f():\n    return 1");
  assert.equal(codeAt(state, doc.indexOf("Intro")), null);
  assert.equal(codeAt(state, doc.lastIndexOf("```")), "");
});

test("the copy-block shortcut goes by the character typed, so Dvorak's c works where the US layout has i", async () => {
  const { EditorState, EditorSelection } = await import("@codemirror/state");
  const { EditorView } = await import("@codemirror/view");
  const { ensureSyntaxTree } = await import("@codemirror/language");
  const { markdownWithFrontmatter } = await import("../web/src/editor/language.ts");
  const { copyCodeKey } = await import("../web/src/editor/blocks.ts");
  const copied: string[] = [];
  // What an EditorView needs that jsdom leaves out.
  Object.assign(globalThis, { MutationObserver: window.MutationObserver });
  Object.assign(window, { requestAnimationFrame: (f: () => void) => setTimeout(f), cancelAnimationFrame: clearTimeout });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (s: string) => void copied.push(s) }, configurable: true });
  const doc = "```js\nconst a = 1;\n```\n";
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.indexOf("const")), extensions: [markdownWithFrontmatter(), copyCodeKey] });
  ensureSyntaxTree(state, doc.length, 5000);
  const view = new EditorView({ state, parent: document.body });
  // Off a Mac it's Ctrl+Shift. On Dvorak, "c" is the key at the US "i" (KeyI, keyCode 73), and the US "c" key types "j".
  const press = (key: string, code: string, keyCode: number) =>
    view.contentDOM.dispatchEvent(new window.KeyboardEvent("keydown", { key, code, keyCode, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  press("J", "KeyC", 67);
  assert.deepEqual(copied, []);
  press("C", "KeyI", 73);
  await Promise.resolve();
  assert.deepEqual(copied, ["const a = 1;"]);
  view.destroy();
});
