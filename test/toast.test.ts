// Toasts, in a jsdom page with a fake clock.
import "./dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const { toast } = await import("../web/src/toast.ts");

const W = window as unknown as typeof globalThis & Window;
const shown = () => [...document.querySelectorAll("#toasts .toast:not(.is-leaving)")].map((n) => n.querySelector(".toast-text")!.textContent);
const key = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new W.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => {
  mock.timers.tick(60_000); // every toast goes
  mock.timers.reset();
  document.getElementById("toasts")!.replaceChildren();
});

test("a toast with an Undo stays 10 seconds, a plain one 5, and an alert 12", () => {
  toast({ text: "Archived Plan", actionLabel: "Undo", action: () => {} });
  toast({ text: "Copied" });
  toast({ text: "Focus is done", alert: true });
  mock.timers.tick(4_999);
  assert.deepEqual(shown(), ["Archived Plan", "Copied", "Focus is done"]);
  mock.timers.tick(1);
  assert.deepEqual(shown(), ["Archived Plan", "Focus is done"]);
  mock.timers.tick(5_000);
  assert.deepEqual(shown(), ["Focus is done"]);
  mock.timers.tick(2_000);
  assert.deepEqual(shown(), []);
});

test("a toast waits while the pointer or the focus is on it, and gets at least 2 seconds after", () => {
  toast({ text: "Archived Plan", actionLabel: "Undo", action: () => {} });
  const node = document.querySelector<HTMLElement>("#toasts .toast")!;
  mock.timers.tick(9_000);
  node.dispatchEvent(new W.MouseEvent("mouseenter"));
  mock.timers.tick(60_000);
  assert.deepEqual(shown(), ["Archived Plan"]);
  node.dispatchEvent(new W.MouseEvent("mouseleave"));
  mock.timers.tick(1_999);
  assert.deepEqual(shown(), ["Archived Plan"]);
  mock.timers.tick(1);
  assert.deepEqual(shown(), []);

  toast({ text: "Moved Plan", actionLabel: "Undo", action: () => {} });
  const button = document.querySelector<HTMLButtonElement>("#toasts .toast:not(.is-leaving) .toast-action")!;
  button.focus();
  mock.timers.tick(60_000);
  assert.deepEqual(shown(), ["Moved Plan"]);
});

test("each toast is read out: politely, or at once for an alert, with the Undo key", () => {
  toast({ text: "Archived Plan", actionLabel: "Undo", action: () => {} });
  assert.equal(document.getElementById("toast-status")!.textContent, "Archived Plan. Undo with Control+Z");
  toast({ text: "Focus is done", detail: "Journal", alert: true });
  assert.equal(document.getElementById("toast-alert")!.textContent, "Focus is done. Journal");
  assert.equal(document.getElementById("toasts")!.getAttribute("role"), "region");
});

test("Ctrl+Z presses the newest Undo, except where you're typing, which has its own undo", () => {
  const undone: string[] = [];
  toast({ text: "Archived A", actionLabel: "Undo", action: () => undone.push("A") });
  toast({ text: "Archived B", actionLabel: "Undo", action: () => undone.push("B") });
  toast({ text: "Added to Journal", actionLabel: "Open", action: () => undone.push("open") });
  const field = document.body.appendChild(document.createElement("input"));
  key(field, { key: "z", ctrlKey: true });
  assert.deepEqual(undone, []);
  key(document.body, { key: "z", ctrlKey: true, shiftKey: true });
  assert.deepEqual(undone, [], "Ctrl+Shift+Z is redo, not undo");
  key(document.body, { key: "z", ctrlKey: true });
  key(document.body, { key: "z", ctrlKey: true });
  key(document.body, { key: "z", ctrlKey: true });
  assert.deepEqual(undone, ["B", "A"]);
  assert.deepEqual(shown(), ["Added to Journal"]);
  field.remove();
});

test("Escape on a focused toast closes it and gives the focus back", () => {
  const before = document.body.appendChild(document.createElement("button"));
  before.focus();
  toast({ text: "Archived Plan", actionLabel: "Undo", action: () => {} });
  document.querySelector<HTMLButtonElement>("#toasts .toast-action")!.focus();
  key(document.activeElement!, { key: "Escape" });
  assert.deepEqual(shown(), []);
  assert.equal(document.activeElement, before);
  before.remove();
});
