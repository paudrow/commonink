// ```mermaid diagrams drawn in jsdom: what a diagram's own configuration can and can't change.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

// jsdom lays nothing out: Mermaid measures its labels and builds its styles as a CSSStyleSheet.
const w = window as unknown as { CSSStyleSheet: unknown; SVGElement: { prototype: Record<string, unknown> } };
(globalThis as Record<string, unknown>).CSSStyleSheet = w.CSSStyleSheet;
w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
w.SVGElement.prototype.getComputedTextLength = () => 10;

const { drawDiagram } = await import("../web/src/diagram.ts");
const look = { color: () => "#123456", dark: false, font: "Inter" };

test("a diagram can't put its own CSS on the page or change the app's look", async () => {
  const css = "& {position:fixed;inset:0;z-index:9999;background:#fff url(https://evil.example/beacon)}";
  for (const code of [
    `%%{init: {"themeCSS": "${css}", "fontFamily": "Evil", "themeVariables": {"primaryColor": "#ff0000"}}}%%\ngraph TD; A-->B`,
    `---\nconfig:\n  themeCSS: "${css}"\n  theme: dark\n---\ngraph TD; A-->B`,
  ]) {
    const svg = await drawDiagram(code, look);
    assert.match(svg, /<style>/, "the diagram keeps its own styles");
    assert.doesNotMatch(svg, /evil\.example|position:fixed|z-index:9999|Evil|#ff0000/i, svg);
  }
});
