// The template picker and the {{ask:…}} form, as someone uses them: type to filter, arrows and
// Enter to pick; the form asks each question (the title too, when making a note), Enter makes it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { askFor, peopleOffers, pickTemplate } from "../web/src/templatePicker.ts";
import type { TemplateInfo } from "../src/core/templates.ts";
import { emptyContact } from "../src/core/contacts.ts";

const t = (name: string, o: Partial<TemplateInfo> = {}): TemplateInfo => ({ path: `Templates/${name}.md`, name, title: null, folder: null, appliesTo: [], asks: [], clipboard: false, ...o });
const ask = (label: string, o: Partial<TemplateInfo["asks"][number]> = {}) => ({ label, fallback: "", type: "text" as const, choices: [], ...o });
const LIST = [t("Daily note"), t("Decision", { asks: [ask("What")] }), t("Meeting", { title: "{{date}} {{ask:Client}}", asks: [ask("Client"), ask("Attendees", { fallback: "Sam" })] })];
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
  assert.match((document.querySelector('.tpl-form input[name="__title"]') as HTMLInputElement).placeholder, /^Blank for “\d{4}-\d\d-\d\d ‹Client›”$/);
  assert.equal(document.activeElement?.getAttribute("name"), "Client", "the first question has the keyboard (the title can come from the template)");
  type("Acme");
  key("Enter");
  assert.deepEqual(await asked, { title: undefined, answers: { Client: "Acme" }, picks: {} });
  // Inserting asks only the questions; a template with none isn't asked about at all.
  asked = askFor(LIST[1], { title: false });
  assert.deepEqual([...document.querySelectorAll(".tpl-form label span")].map((s) => s.textContent), ["What"]);
  key("Escape");
  assert.equal(await asked, null);
  assert.deepEqual(await askFor(LIST[0], { title: false }), { title: undefined, answers: {}, picks: {} });
});

test("typed questions: a people picker (members, or someone new), a date picker, and a choice menu", async () => {
  const typed = t("Kickoff", {
    asks: [
      ask("Attendees", { type: "people" }),
      ask("Due", { type: "date" }),
      ask("Priority", { type: "choice", choices: ["low", "medium", "high"], fallback: "medium" }),
    ],
  });
  const people = [{ name: "Sam Dev" }, { name: "Priya Shah" }, { name: "Sam Lee" }];
  const asked = askFor(typed, { title: false, people });
  // People: type to find someone, Enter picks them; a name no one has is someone new.
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Attendees");
  type("pri");
  assert.deepEqual([...document.querySelectorAll(".tpl-people-opt")].map((o) => o.textContent), ["Priya Shah@Priya", "Add “pri”new"]);
  key("Enter");
  type("Lee Chang");
  assert.deepEqual([...document.querySelectorAll(".tpl-people-opt")].map((o) => o.textContent), ["Add “Lee Chang”new"]);
  key("Enter");
  assert.deepEqual([...document.querySelectorAll(".tpl-chip")].map((c) => c.textContent?.replace("×", "")), ["Priya Shah", "Lee Chang"]);
  key("Backspace"); // on an empty field: the last one goes
  assert.deepEqual([...document.querySelectorAll(".tpl-chip")].map((c) => c.textContent?.replace("×", "")), ["Priya Shah"]);
  type("sam");
  key("ArrowDown");
  key("Enter"); // the second Sam
  const due = document.querySelector('.tpl-form input[name="Due"]') as HTMLInputElement;
  assert.equal(due.type, "date");
  due.value = "2026-10-05";
  const pick = document.querySelector('.tpl-form select[name="Priority"]') as HTMLSelectElement;
  assert.deepEqual([...pick.options].map((o) => o.value), ["", "low", "medium", "high"], "blank, to leave it unanswered");
  assert.equal(pick.value, "medium", "the default is chosen");
  (document.querySelector(".tpl-box .qw-btn.primary") as HTMLButtonElement).click();
  assert.deepEqual(await asked, {
    title: undefined,
    answers: { Due: "2026-10-05", Priority: "medium" },
    picks: { Attendees: [{ name: "Priya Shah", handle: "Priya" }, { name: "Sam Lee", handle: "Sam-Lee" }] },
  });
});

test("a people question offers the people @ knows, with the handle a task uses and a link to a contact's note", async () => {
  const contact = (name: string, o: { email?: string[]; aliases?: string[] } = {}) => ({ ...emptyContact(name), ...o, path: `People/${name}.md`, id: name, mentions: 0, lastContacted: null });
  const member = (name: string, email: string) => ({ id: email, name, email });
  const offers = peopleOffers([contact("Jane Doe", { email: ["jane@acme.com"] }), contact("Tom Wu", { aliases: ["TW"] })], [member("Jane D.", "JANE@acme.com"), member("Sam Dev", "sam@x.org")]);
  // Jane is a member too (the same email): offered once, as her contact. Tom goes by his alias.
  assert.deepEqual(offers, [
    { name: "Jane Doe", handle: "Jane", link: "[[People/Jane Doe]]" },
    { name: "Sam Dev", handle: "Sam" },
    { name: "Tom Wu", handle: "TW", link: "[[People/Tom Wu]]" },
  ]);
  const asked = askFor(t("Call", { asks: [ask("Who", { type: "people" })] }), { title: false, people: offers });
  type("tom");
  assert.deepEqual([...document.querySelectorAll(".tpl-people-opt")].map((o) => o.textContent), ["Tom Wu@TW", "Add “tom”new"]);
  key("Enter");
  type("jane");
  key("Enter");
  (document.querySelector(".tpl-box .qw-btn.primary") as HTMLButtonElement).click();
  assert.deepEqual((await asked)?.picks, {
    Who: [
      { name: "Tom Wu", handle: "TW", link: "[[People/Tom Wu]]" },
      { name: "Jane Doe", handle: "Jane", link: "[[People/Jane Doe]]" },
    ],
  });
});

test("the picker's ? opens the help on every template option", async () => {
  let opened = 0;
  const picked = pickTemplate(LIST, "New note from template", { help: () => opened++ });
  (document.querySelector(".tpl-help") as HTMLButtonElement).click();
  assert.equal(opened, 1);
  assert.equal((document.querySelector(".tpl-help") as HTMLElement).title, "Every template option: placeholders, questions, frontmatter");
  key("Escape");
  await picked;
});
