import { test } from "node:test";
import assert from "node:assert/strict";
import { clampWidth, dragTo, PANEL, SIDEBAR } from "../web/src/sideBars.ts";

test("a side bar's width stays within its bounds; a stored width that isn't a number is the starting one", () => {
  assert.equal(clampWidth(100, SIDEBAR), SIDEBAR.min);
  assert.equal(clampWidth(9999, SIDEBAR), SIDEBAR.max);
  assert.equal(clampWidth(300.4, PANEL), 300);
  assert.equal(clampWidth("wide", SIDEBAR), SIDEBAR.initial);
  assert.equal(clampWidth(null, PANEL), PANEL.initial);
});

test("dragged under half its narrowest, a side bar snaps shut; dragged out again, it opens at least that wide", () => {
  assert.deepEqual(dragTo(SIDEBAR.min / 2 - 1, SIDEBAR), { open: false, width: SIDEBAR.min });
  assert.deepEqual(dragTo(SIDEBAR.min / 2 + 1, SIDEBAR), { open: true, width: SIDEBAR.min });
  assert.deepEqual(dragTo(350, SIDEBAR), { open: true, width: 350 });
  assert.deepEqual(dragTo(5000, PANEL), { open: true, width: PANEL.max });
});
