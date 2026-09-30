import { test } from "node:test";
import assert from "node:assert/strict";
import { blockMathAt, inlineMathAt, MAX_TEX } from "../src/core/math.ts";
import { cpuMs } from "./helpers.ts";

/** Every inline formula in a line, scanning left to right the way the parsers do. */
function formulas(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] !== "(" && text[i + 1] !== "[") {
      i++; // an escaped character
      continue;
    }
    if (text[i] !== "$" && text[i] !== "\\") continue;
    const m = inlineMathAt(text, i);
    if (!m) continue;
    out.push(`${m.display ? "D" : "I"}:${m.tex}`);
    i = m.end - 1;
  }
  return out;
}

test("inline math follows GitHub's dollar rules, so prices stay text", () => {
  assert.deepEqual(formulas("Energy is $E = mc^2$ here."), ["I:E = mc^2"]);
  assert.deepEqual(formulas("It costs $5 and $10."), []);
  assert.deepEqual(formulas("Between $ 1 $ and $2$."), ["I:2"], "no space inside the dollars");
  assert.deepEqual(formulas("From $3 to $4 today"), [], "a closing $ can't come right before a digit");
  assert.deepEqual(formulas("Pay \\$5, then $x$."), ["I:x"]);
  assert.deepEqual(formulas("$a\\$b$"), ["I:a\\$b"], "an escaped $ inside doesn't close it");
  assert.deepEqual(formulas("$`a_{1} * b_{2}`$ and $x_1$"), ["I:a_{1} * b_{2}", "I:x_1"]);
  assert.deepEqual(formulas("$$\\sum_i x_i$$ inline display"), ["D:\\sum_i x_i"]);
});

test("\\( \\) and \\[ \\] render too, since agents write them", () => {
  assert.deepEqual(formulas("Inline \\(x^2\\) and display \\[\\int_0^1 f\\]."), ["I:x^2", "D:\\int_0^1 f"]);
  assert.deepEqual(formulas("Unclosed \\(x and more"), []);
});

test("block math: $$ or \\[ on its own lines, or one line", () => {
  assert.deepEqual(blockMathAt(["$$", "a + b", "= c", "$$"], 0), { endLine: 3, tex: "a + b\n= c" });
  assert.deepEqual(blockMathAt(["\\[", "x", "\\]"], 0), { endLine: 2, tex: "x" });
  assert.deepEqual(blockMathAt(["$$ e^{i\\pi} + 1 = 0 $$"], 0), { endLine: 0, tex: "e^{i\\pi} + 1 = 0" });
  assert.deepEqual(blockMathAt(["$$", "", "x", "$$"], 0), null, "a blank line ends it");
  assert.deepEqual(blockMathAt(["$$", "x"], 0), null, "never closed");
  assert.deepEqual(blockMathAt(["$$x$$ and text"], 0), null, "text after it: inline");
  assert.equal(blockMathAt(["No math"], 0), null);
});

test("scanning hostile text stays linear and bounded", () => {
  const hostile = [
    "$a ".repeat(40_000),
    "\\(".repeat(40_000),
    "$`".repeat(40_000),
    "$$".repeat(40_000),
    `$${"x".repeat(MAX_TEX * 3)}$`,
  ];
  for (const text of hostile) {
    assert.ok(cpuMs(() => formulas(text)) < 300, `slow on ${JSON.stringify(text.slice(0, 12))}`);
    assert.ok(formulas(text).every((f) => f.length <= MAX_TEX + 2));
  }
  const lines = ["$$", ...Array(50_000).fill("x"), "$$"];
  assert.equal(blockMathAt(lines, 0), null, "too long to be one formula");
  assert.ok(cpuMs(() => blockMathAt(lines, 0)) < 100);
});

test("search finds a note by the LaTeX in its math", async () => {
  const { openTempVault } = await import("./helpers.ts");
  const { vault } = openTempVault({ "Physics.md": "# Physics\n\n$$\n\\frac{d}{dt} \\mathbf{p} = \\mathbf{F}\n$$\n" });
  assert.deepEqual(vault.search("mathbf").map((h) => h.path), ["Physics.md"]);
});
