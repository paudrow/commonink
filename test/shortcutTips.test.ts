// Shortcut tips: the third pointer click on a button with a shortcut says, once, which keys do it.
// Once per tip in this browser, one per visit, never from the keyboard, a touch screen or over a dialog.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clickTip, NO_TIPS, tipText, TIPS, watchTips, type Tip, type TipsState } from "../web/src/shortcutTips.ts";
import { appCommands, shortcutSheet, type App } from "../web/src/commands.ts";

/** Every shortcut on the sheet, from an app whose actions do nothing. */
const sheetKeys = () => {
  const app = new Proxy({ note: { kind: "md", starred: false, archived: false }, account: [] } as unknown as App, { get: (t, k) => (k in t ? (t as any)[k] : () => {}) });
  return new Set(shortcutSheet(appCommands(app)).flatMap((a) => a.shortcuts.flatMap((s) => s.keys)));
};

const clicks = (ids: string[], used = false, state: TipsState = NO_TIPS) => {
  const shown: string[] = [];
  for (const id of ids) {
    const r = clickTip(state, id, used || shown.length > 0);
    state = r.state;
    if (r.tip) shown.push(r.tip.id);
  }
  return { state, shown };
};

test("the third click on a button shows its tip, and never again", () => {
  assert.deepEqual(clicks(["search-btn", "search-btn"]).shown, []);
  const { state, shown } = clicks(["search-btn", "search-btn", "search-btn"]);
  assert.deepEqual(shown, ["search-btn"]);
  assert.deepEqual(state, { clicks: {}, shown: ["search-btn"] });
  // Next visit, more clicks on it count for nothing.
  assert.equal(clicks(["search-btn", "search-btn", "search-btn"], false, state).state, state);
});

test("one tip per visit: a second one waits for the next visit, still counted", () => {
  const visit = clicks(["search-btn", "settings-btn", "search-btn", "settings-btn", "search-btn", "settings-btn"]);
  assert.deepEqual(visit.shown, ["search-btn"]);
  assert.equal(visit.state.clicks["settings-btn"], 3);
  assert.deepEqual(clicks(["settings-btn"], false, visit.state).shown, ["settings-btn"]);
});

test("off, and buttons without a tip, count nothing", () => {
  const off = { ...NO_TIPS, off: true };
  assert.equal(clicks(["search-btn", "search-btn", "search-btn"], false, off).state, off);
  assert.equal(clickTip(NO_TIPS, "new-note", false).state, NO_TIPS);
});

test("tips say the keys the platform's way, and only for shortcuts the app has", () => {
  const search = TIPS.find((t) => t.id === "search-btn")!;
  assert.equal(tipText(search, true), "Tip: ⌘K searches from anywhere.");
  assert.equal(tipText(search, false), "Tip: Ctrl+K searches from anywhere.");
  const known = sheetKeys();
  for (const t of TIPS) assert.ok(known.has(t.keys), `${t.id}: ${t.keys} is a shortcut`);
});

function harness(over: { coarse?: boolean; busy?: () => boolean } = {}) {
  (globalThis as any).matchMedia = (q: string) => ({ matches: q === "(pointer: coarse)" && !!over.coarse, addEventListener() {} });
  const doc = document.implementation.createHTMLDocument();
  const button = doc.body.appendChild(doc.createElement("button"));
  button.id = "archive-btn";
  let state: TipsState = NO_TIPS;
  const shown: Tip[] = [];
  watchTips({ load: () => state, save: (s) => (state = s), busy: over.busy ?? (() => false), show: (t) => shown.push(t) }, doc);
  const click = (detail = 1, pointerType = "mouse") => {
    const e = new window.MouseEvent("click", { bubbles: true, detail });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    button.dispatchEvent(e);
  };
  return { click, shown, state: () => state };
}

test("only pointer clicks count: not Enter or Space on the button, not a touch", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  for (let i = 0; i < 3; i++) h.click(0);
  for (let i = 0; i < 3; i++) h.click(1, "touch");
  assert.deepEqual(h.state().clicks, {});
  for (let i = 0; i < 3; i++) h.click();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.shown.map((x) => x.id), ["archive-btn"]);
});

test("never on a touch screen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ coarse: true });
  for (let i = 0; i < 3; i++) h.click();
  t.mock.timers.tick(1000);
  assert.deepEqual(h.state().clicks, {});
  assert.equal(h.shown.length, 0);
});

test("a tip that comes due while a dialog is open waits for it to close", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let busy = true;
  const h = harness({ busy: () => busy });
  for (let i = 0; i < 3; i++) h.click();
  t.mock.timers.tick(5000);
  assert.equal(h.shown.length, 0);
  busy = false;
  t.mock.timers.tick(1000);
  assert.equal(h.shown.length, 1);
});
