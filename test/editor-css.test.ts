// CodeMirror measures a block widget's height without its margins, and a height it gets wrong sends
// the cursor past the blocks around it on the way up or down (j/k and the arrows). So the outer
// element of every block widget spaces itself with padding, never a vertical margin.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** The outer element of each block widget the editor draws (blocks.ts, mathWidgets.ts). */
const BLOCK_WIDGETS = ["cm-code-widget", "cm-diagram-block", "cm-embed-block", "cm-table-block", "cm-widget", "cm-properties-block"];

test("block widgets in the editor space themselves with padding, never a vertical margin", () => {
  const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    const margin = /(^|;)\s*margin(-top|-bottom)?\s*:\s*([^;]+)/.exec(m[2]);
    if (!margin) continue;
    const value = margin[3].trim().split(/\s+/);
    const vertical = margin[2] ? value[0] : [value[0], value[2] ?? value[0]].find((v) => v !== "0" && v !== "auto");
    if (!vertical || vertical === "0") continue;
    for (const sel of selectors) {
      // The selector's last compound names the element styled; flag it when that's a widget root.
      const last = sel.split(/\s+|>/).filter(Boolean).pop() ?? "";
      if (BLOCK_WIDGETS.some((w) => new RegExp(`\\.${w}(?![\\w-])`).test(last) && !/::?(before|after)/.test(last))) offenders.push(`${sel} { margin: ${margin[3].trim()} }`);
    }
  }
  assert.deepEqual(offenders, []);
});
