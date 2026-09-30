// The template picker and the {{ask:…}} form, as someone uses them: type to filter, arrows and
// Enter to pick; the form asks each question (the title too, when making a note), Enter makes it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { askFor, pickTemplate } from "../web/src/templatePicker.ts";
import type { TemplateInfo } from "../src/core/templates.ts";

const t = (name: string, o: Partial<TemplateInfo> = {}): TemplateInfo => ({ path: `Templates/${name}.md`, name, title: null, folder: null, appliesTo: [], asks: [], clipboard: false, ...o });
const LIST = [t("Daily note"), t("Decision", { asks: [{ label: "What", fallback: "" }] }), t("Meeting", { title: "{{date}} {{ask:Client}}", asks: [{ label: "Client", fallback: "" }, { label: "Attendees", fallback: "Sam" }] })];
const key = (k: string) => document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const type = (s: string) => {
  const input = document.activeElement as HTMLInputElement;
  input.value += s;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

test("the picker filters as you type and picks with Enter; Escape picks nothing", async () => {
  let picked = pickTemplate(LIST, "New note from template");
  assert.deepEqual([...document.querySelectorAll(".tpl-item b")].map((b) => b.textContent), ["Daily note", "Decision", "Meeting"]);
  type("mee");
  assert.deepEqual([...document.querySelectorAll(".tpl-item b")].map((b) => b.textContent), ["Meeting"]);
  key("Enter");
  assert.equal((await picked)?.name, "Meeting");
  assert.equal(document.querySelector(".tpl-box"), null, "it closes");
  picked = pickTemplate(LIST, "Insert a template");
  key("ArrowDown");
  key("Enter");
  assert.equal((await picked)?.name, "Decision");
  picked = pickTemplate(LIST, "Insert a template");
  key("Escape");
  assert.equal(await picked, null);
});

test("the form asks the title (when making a note) and each question; blank answers use the default, or stay to fill in", async () => {
  let asked = askFor(LIST[2], { title: true });
  const labels = [...document.querySelectorAll(".tpl-form label span")].map((s) => s.textContent);
  assert.deepEqual(labels, ["Title", "Client", "Attendees"]);
  assert.equal((document.querySelector('.tpl-form input[name="Attendees"]') as HTMLInputElement).placeholder, "Sam");
  assert.equal(document.activeElement?.getAttribute("name"), "Client", "the first question has the keyboard (the title can come from the template)");
  type("Acme");
  key("Enter");
  assert.deepEqual(await asked, { title: undefined, answers: { Client: "Acme" } });
  // Inserting asks only the questions; a template with none isn't asked about at all.
  asked = askFor(LIST[1], { title: false });
  assert.deepEqual([...document.querySelectorAll(".tpl-form label span")].map((s) => s.textContent), ["What"]);
  key("Escape");
  assert.equal(await asked, null);
  assert.deepEqual(await askFor(LIST[0], { title: false }), { title: undefined, answers: {} });
});
