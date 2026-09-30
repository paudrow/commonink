// CodeMirror measures lines and block widgets without their margins, so a vertical margin on one
// throws its height map off, and j/k or the arrows skip lines. The folds' lines and widgets keep
// their spacing in padding (or inside a wrapper) instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const CSS = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
/** Editor lines and widgets these features draw. */
const OURS = /\.cm-(details|alert|html-block|html-inline|fn-|heading-link|emoji|br\b)/;

/** The rules in `css` for `ours`, with any vertical margin they set. */
function verticalMargins(css: string, ours: RegExp): string[] {
  const bad: string[] = [];
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!ours.test(selector)) continue;
    for (const [, prop, value] of body.matchAll(/(margin(?:-top|-bottom|-block(?:-start|-end)?)?)\s*:\s*([^;]+)/g)) {
      const v = value.trim().split(/\s+/);
      const vertical = prop === "margin" ? [v[0], v[2] ?? v[0]] : prop === "margin-block" ? [v[0], v[1] ?? v[0]] : [v[0]];
      if (vertical.some((x) => !/^0(px|em|rem)?$/.test(x))) bad.push(`${selector.trim()} { ${prop}: ${value.trim()} }`);
    }
  }
  return bad;
}

test("the folds' lines and widgets have no vertical margins (spacing goes in padding)", () => {
  assert.deepEqual(verticalMargins(CSS, OURS), []);
});

test("the check catches one, and lets horizontal margins by", () => {
  const css = ".cm-details-x { margin: 4px 0; } .cm-details-y { margin: 0 4px 0 -26px; } .cm-alert-z { color: red; margin-bottom: 2px } .other { margin: 9px }";
  assert.deepEqual(verticalMargins(css, OURS), [".cm-details-x { margin: 4px 0 }", ".cm-alert-z { margin-bottom: 2px }"]);
});
