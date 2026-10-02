// The app's own dialogs in place of prompt(), confirm() and alert(): keys, focus, and what they resolve to.
import "./dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

const { askText, confirmAction, copyLink } = await import("../web/src/modal.ts");
const { toast } = await import("../web/src/toast.ts");

const W = window as unknown as typeof globalThis & Window;
const key = (k: string, init: KeyboardEventInit = {}) => (document.activeElement ?? document.body).dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const box = () => document.querySelector<HTMLElement>(".ask .ask-box");
const button = (label: string) => [...box()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
const setClipboard = (writeText: (s: string) => Promise<void>) => Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

afterEach(() => document.querySelectorAll(".ask, body > button").forEach((n) => n.remove()));

test("a confirm asks with a red button that has the focus; Esc calls it off and the focus goes back", async () => {
  const opener = document.body.appendChild(document.createElement("button"));
  opener.focus();
  const sure = confirmAction({ title: "Disconnect Claude?", body: "It stops working right away.", action: "Disconnect", danger: true });
  assert.equal(box()!.getAttribute("role"), "alertdialog");
  assert.equal(box()!.getAttribute("aria-label"), "Disconnect Claude?");
  assert.equal(document.getElementById(box()!.getAttribute("aria-describedby")!)!.textContent, "It stops working right away.");
  assert.equal(document.activeElement, button("Disconnect"));
  assert.ok(button("Disconnect").classList.contains("danger"));
  key("Escape");
  assert.equal(await sure, false);
  assert.equal(box(), null);
  assert.equal(document.activeElement, opener);
});

test("a confirm's button says yes; Tab goes round the dialog's buttons without leaving", async () => {
  const sure = confirmAction({ title: "Merge #a into #b?", action: "Merge" });
  assert.ok(button("Merge").classList.contains("primary"));
  key("Tab");
  assert.equal(document.activeElement, button("Cancel"));
  key("Tab", { shiftKey: true });
  assert.equal(document.activeElement, button("Merge"));
  button("Merge").click();
  assert.equal(await sure, true);
});

test("asking for text starts from the value, takes it with Enter, and can't be taken empty", async () => {
  const name = askText({ title: "Name your team workspace", label: "Workspace name", value: "My team", action: "Create" });
  const input = box()!.querySelector("input")!;
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "My team");
  input.value = "  ";
  input.dispatchEvent(new W.Event("input"));
  assert.ok(button("Create").disabled);
  key("Enter");
  assert.ok(box(), "still asking");
  input.value = " Design ";
  input.dispatchEvent(new W.Event("input"));
  key("Enter");
  assert.equal(await name, "Design");
});

test("a link the browser won't copy is shown selected in a read-only field, with a Copy button", async () => {
  setClipboard(() => Promise.reject(new Error("denied")));
  const copied = copyLink("https://commonink.app/s/abc", { title: "The link" });
  await new Promise((r) => setTimeout(r));
  const field = box()!.querySelector("input")!;
  assert.equal(field.value, "https://commonink.app/s/abc");
  assert.ok(field.readOnly);
  assert.equal(document.activeElement, field);
  assert.equal([field.selectionStart, field.selectionEnd].join(), `0,${field.value.length}`);
  // The browser lets a click copy it.
  let wrote = "";
  setClipboard(async (s) => void (wrote = s));
  button("Copy").click();
  await new Promise((r) => setTimeout(r));
  assert.equal(wrote, "https://commonink.app/s/abc");
  assert.equal(button("Copied").textContent, "Copied");
  button("Done").click();
  assert.equal(await copied, false);
});

test("a link that copies shows no dialog", async () => {
  setClipboard(async () => {});
  assert.equal(await copyLink("https://commonink.app/s/abc", { title: "The link" }), true);
  assert.equal(box(), null);
});

test("an error toast is marked as one and read out at once", () => {
  toast({ error: true, text: "Couldn't change the task" });
  assert.ok(document.querySelector("#toasts .toast.is-error"));
  assert.match(document.getElementById("toast-alert")!.textContent!, /Couldn't change the task/);
  document.querySelector<HTMLElement>("#toasts .toast")!.click(); // gone, and its timer with it
});

test("with a dialog over a dialog, Esc calls off only the one on top", async () => {
  const under = confirmAction({ title: "Leave Design?", action: "Leave", danger: true });
  const over = confirmAction({ title: "Really?", action: "Yes" });
  key("Escape");
  assert.equal(await over, false);
  assert.equal(document.querySelectorAll(".ask").length, 1);
  key("Escape");
  assert.equal(await under, false);
});
