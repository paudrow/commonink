// The back and forward arrows: in the top bar and each split pane's bar, stepping a pane's trail.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { navArrows, type Dir } from "../web/src/navArrows.ts";
import { trailAhead } from "../web/src/panes.ts";

function arrows() {
  const went: Array<[Dir, number]> = [];
  const a = navArrows((dir, steps) => void went.push([dir, steps]));
  document.body.replaceChildren(a.el);
  const [back, forward] = [...a.el.querySelectorAll<HTMLButtonElement>("button")];
  return { a, went, back, forward };
}
const labels = { back: "Back (⌘[)", forward: "Forward (⌘])" };

test("two arrows, labelled with their shortcuts; one with nowhere to go is marked disabled and does nothing", () => {
  const { a, went, back, forward } = arrows();
  a.update({ back: ["Flights", "Trip plan"], forward: [], labels });
  assert.deepEqual([back.getAttribute("aria-label"), back.title, forward.getAttribute("aria-label")], ["Back (⌘[)", "Back (⌘[)", "Forward (⌘])"]);
  assert.deepEqual([back.getAttribute("aria-disabled"), forward.getAttribute("aria-disabled")], ["false", "true"]);
  assert.equal(back.disabled || forward.disabled, false, "still reachable with Tab, as aria-disabled asks");
  back.click();
  forward.click();
  assert.deepEqual(went, [["back", 1]]);
});

test("right-click (or a long press) lists the trail that way, nearest first; picking one jumps there", () => {
  const { a, went, back, forward } = arrows();
  a.update({ back: ["Flights", "Trip plan", "Notes"], forward: [], labels });
  back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.querySelector<HTMLElement>(".nav-trail")!;
  assert.equal(menu.getAttribute("role"), "menu");
  const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  assert.deepEqual(items.map((i) => i.textContent), ["Flights", "Trip plan", "Notes"]);
  assert.equal(document.activeElement, items[0], "the nearest is focused, for the keyboard");
  items[1].click();
  assert.deepEqual(went, [["back", 2]]);
  assert.equal(document.querySelector(".nav-trail"), null, "and the menu closes");
  forward.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  assert.equal(document.querySelector(".nav-trail"), null, "nothing that way: no menu");
  back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  document.querySelector(".nav-trail")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector(".nav-trail"), null, "Escape closes it");
});

test("the trail that way, nearest first, without the entries a step skips", () => {
  const trail = { note: "c", back: ["a", "gone", "b"], forward: ["e", "d"] };
  assert.deepEqual(trailAhead(trail, "back", (id) => id !== "gone"), ["b", "a"]);
  assert.deepEqual(trailAhead(trail, "forward", () => true), ["d", "e"]);
});
