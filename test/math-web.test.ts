// Math in rendered markdown and KaTeX's output, which is note content like any other.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderMarkdown } = await import("../web/src/render.ts");
const { renderTex } = await import("../web/src/mathRender.ts");

const parse = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

test("rendered markdown marks each formula for drawing, with its source showing until then", () => {
  assert.equal(renderMarkdown("Energy $E=mc^2$, prices $5 and $10.", "n.md"), '<p>Energy <span class="math" data-tex="E=mc^2">$E=mc^2$</span>, prices $5 and $10.</p>\n');
  const html = renderMarkdown("$$\n\\frac{a}{b}\n$$\n\n```math\nx^2\n```\n\n\\[\\int f\\] and \\(y\\) and $`a*b*c`$ and \\$5", "n.md");
  const d = parse(html);
  assert.deepEqual(
    [...d.querySelectorAll<HTMLElement>(".math")].map((m) => `${m.tagName}:${m.dataset.display !== undefined ? "D" : "I"}:${m.dataset.tex}`),
    ["DIV:D:\\frac{a}{b}", "DIV:D:x^2", "SPAN:D:\\int f", "SPAN:I:y", "SPAN:I:a*b*c"],
  );
  assert.ok(d.textContent!.trimEnd().endsWith("and $5"), "an escaped dollar is a dollar");
  assert.equal(renderMarkdown("a $$x$$ b", "n.md"), '<p>a <span class="math" data-tex="x" data-display="">x</span> b</p>\n', "display math in a sentence stays in it");
  assert.equal(renderMarkdown("`$x$` is code", "n.md"), "<p><code>$x$</code> is code</p>\n");
});

test("a $$ block right under a line of text is still display math, and reading math stays linear", () => {
  assert.equal(renderMarkdown("Text above\n$$\na + b\n$$\nand after", "n.md"), '<p>Text above\n<span class="math" data-tex="a + b" data-display="">a + b</span>\nand after</p>\n');
  // Twice the input takes about twice as long; a scan from every position would take four times.
  // Timed by growth, not a fixed bound, which a slow CI machine can cross.
  const time = (src: string) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      renderMarkdown(src, "n.md");
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };
  for (const [unit, n] of [["[", 50_000], ["![[", 16_000], ["$a ", 16_000], ["\\(", 25_000], ["para\n\n", 10_000]] as const) {
    const [once, twice] = [time(unit.repeat(n)), time(unit.repeat(2 * n))];
    assert.ok(twice < 3 * once + 20, `${JSON.stringify(unit)} grows faster than its input: ${Math.round(once)} ms, then ${Math.round(twice)} ms`);
  }
});

test("a formula's source can't break out of its placeholder", () => {
  const d = parse(renderMarkdown('$"><img src=x onerror=alert(1)>$ and $$</div><script>alert(1)</script>$$', "n.md"));
  assert.equal(d.querySelector("img, script, [onerror]"), null);
  // DOMPurify drops an attribute that holds a closing tag, so that formula stays as its text.
  assert.deepEqual([...d.querySelectorAll<HTMLElement>(".math")].map((m) => [m.dataset.tex ?? null, m.textContent]), [
    ['"><img src=x onerror=alert(1)>', '$"><img src=x onerror=alert(1)>$'],
    [null, "</div><script>alert(1)</script>"],
  ]);
});

test("KaTeX draws math, and says why when it can't", () => {
  const ok = renderTex("\\frac{a}{b}", false);
  assert.ok("html" in ok && ok.html.includes('class="katex"') && ok.html.includes("<math"));
  const bad = renderTex("\\frac{a}{", false);
  assert.ok("error" in bad && /expected '}'/.test(bad.error), JSON.stringify(bad));
});

test("KaTeX can't link, name, class, embed or restyle anything outside the formula", () => {
  for (const tex of [
    "\\href{javascript:alert(1)}{x}",
    "\\url{javascript:alert(1)}",
    "\\htmlClass{app-overlay}{x}",
    "\\htmlId{backlinks}{x}",
    "\\htmlData{foo=bar}{x}",
    "\\htmlStyle{position:fixed;inset:0;z-index:99}{x}",
    "\\includegraphics{https://evil.example/a.png}",
  ]) {
    const out = renderTex(tex, true);
    const html = "html" in out ? out.html : "";
    const d = parse(html);
    assert.equal(d.querySelector("a, img, [href], [id], [data-foo], .app-overlay, [src]"), null, tex);
    for (const node of d.querySelectorAll<HTMLElement>("[style]")) {
      assert.ok(!/fixed|inset|z-index|url\(/i.test(node.getAttribute("style")!), `${tex}: ${node.getAttribute("style")}`);
    }
  }
});

test("macros that expand forever, huge sizes and long input are refused, not drawn", () => {
  const t = performance.now();
  const bomb = renderTex("\\def\\a{\\a\\a}\\a", false);
  assert.ok("error" in bomb, "expansion is capped");
  const huge = renderTex("\\rule{100000em}{100000em}", false);
  assert.ok("html" in huge);
  const drawn = parse(huge.html).querySelector(".katex-html")!.innerHTML;
  assert.ok(drawn.includes("30em") && !drawn.includes("100000em"), `sizes are capped: ${drawn}`);
  assert.ok("error" in renderTex("x".repeat(5000), false));
  assert.ok(performance.now() - t < 2000);
});

test("the editor reads math with the same rules: inline, one-line and multi-line blocks, and not prices", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { ensureSyntaxTree } = await import("@codemirror/language");
  const { markdownWithFrontmatter } = await import("../web/src/editor/language.ts");
  const doc = "It costs $5 or $10.\n\nA $x^2$, \\(y\\) and `$code$`.\n\n$$\na + b\n$$\n\n$$ c $$\n\n$$\nnever closed\n\nAfter.";
  const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
  const found: string[] = [];
  ensureSyntaxTree(state, doc.length, 5000)!.iterate({
    enter: (n) => {
      if (n.name === "InlineMath" || n.name === "BlockMath") found.push(`${n.name}:${doc.slice(n.from, n.to)}`);
    },
  });
  assert.deepEqual(found, ["InlineMath:$x^2$", "InlineMath:\\(y\\)", "BlockMath:$$\na + b\n$$", "BlockMath:$$ c $$"]);
});
