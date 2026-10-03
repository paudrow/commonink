// One ::view for every kind of live list: `show=` picks the kind (none is notes), the kind's own
// widget draws it with the rest of the args, and the settings form starts with Show, swapping in
// the kind's fields when it changes.
process.env.TZ = "America/New_York";
import { after, test } from "node:test";
import assert from "node:assert/strict";

await import("./dom.ts");
const { renderWidget, specFor, formResult, formValues, switchKind } = await import("../web/src/widgets/core.ts");
const { view, VIEWS } = await import("../web/src/widgets/view.ts");
const { WIDGETS } = await import("../web/src/widgets/index.ts");
const { calendarChanged } = await import("../web/src/calendar/data.ts");
const { parseDirective, serializeDirective, viewShow, VIEW_SHOWS } = await import("../src/core/directive.ts");

const now = new Date();
const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString();
const SOURCES = [{ id: "work", kind: "ics", name: "Work", color: "blue", owner: null, url: null, host: "x.test", editable: true, writeBack: null, calendar: null, status: "ok", error: null, syncedAt: 1, events: 1, createdBy: "you", createdAt: 1 }];
const EVENTS = [{ id: "e1aaaaaaaaaa", source: "work", title: "Standup", start: at(9), end: at(10), allDay: false, timeZone: null, location: null, description: null, url: null, organizer: null, attendees: [], status: "confirmed", recurring: false, note: null }];

globalThis.fetch = (async (input: string) => {
  const url = new URL(input, "http://localhost");
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/api/calendar/sources") return json(SOURCES);
  if (url.pathname === "/api/calendar/events") return json(EVENTS);
  if (url.pathname === "/api/notes") return json([]);
  return new Response("{}", { status: 404 });
}) as typeof fetch;
after(() => window.close());

const settle = () => new Promise((r) => setTimeout(r, 20));

/** A ::view line drawn as the editor draws it; `updates` collects what it writes back. */
function draw(line: string, openConfig = false) {
  const { name, args } = parseDirective(line)!;
  const updates: string[] = [];
  const { dom, destroy } = renderWidget(WIDGETS[name], {
    args,
    note: "Note.md",
    openConfig,
    update: (next) => updates.push(serializeDirective({ name, args: next })),
    withId() {},
    focusEditor() {},
    remeasure() {},
    open() {},
    openTag() {},
    saveSmartFolder() {},
    sources: { tags: () => [], folders: () => [] },
    openPerson() {},
  });
  document.body.append(dom);
  return { dom, destroy, updates };
}

test("a ::view's show= picks its kind: none is notes, and one that names no kind is null", () => {
  assert.deepEqual(VIEW_SHOWS, ["notes", "tasks", "month", "agenda", "today", "board"]);
  assert.equal(viewShow({}), "notes");
  assert.equal(viewShow({ show: "Tasks" }), "tasks");
  assert.equal(viewShow({ show: "board", note: "Launch" }), "board");
  assert.equal(viewShow({ show: "calendar" }), null);
  for (const show of VIEW_SHOWS) assert.equal(specFor(view, { show }), VIEWS[show]);
  assert.equal(specFor(view, {}), VIEWS.notes);
  assert.equal(specFor(WIDGETS.timer, { show: "tasks" }), WIDGETS.timer); // a widget of one kind is itself
});

test("the old widget names are gone: only ::view and the tools are widgets", () => {
  assert.deepEqual(Object.keys(WIDGETS).sort(), ["guide", "stopwatch", "streak", "timer", "view"]);
});

test("a ::view draws as its kind, with that kind's header, and the kind reads its args without show", async () => {
  calendarChanged();
  const { dom, destroy } = draw('::view{show=agenda days=1 label="Week"}');
  await settle();
  assert.ok(dom.classList.contains("qw-agenda"));
  assert.equal(dom.querySelector(".qw-kind")!.textContent, "Agenda");
  assert.equal(dom.querySelector(".qw-label")!.textContent, "Week");
  assert.deepEqual([...dom.querySelectorAll(".cal-row-title, .cal-chip-title")].map((t) => t.textContent), ["Standup"]);
  destroy();
  dom.remove();

  const odd = draw("::view{show=calendar}");
  assert.match(odd.dom.textContent!, /no view called “calendar”/);
  assert.ok(odd.dom.querySelector("button[title=Settings]"), "its settings are there to pick a kind");
  odd.dom.remove();
});

test("a ::view's settings start with Show; changing it swaps the fields and drops args the new kind doesn't read", async () => {
  calendarChanged();
  const { dom, destroy, updates } = draw('::view{show=agenda days=7 label="Mine" id=k3x9q}', true);
  await settle();
  const form = dom.querySelector<HTMLFormElement>(".qw-config")!;
  const labels = () => [...form.querySelectorAll(".qw-field-label")].map((l) => l.textContent);
  const preview = () => form.querySelector(".qw-md")!.textContent;
  const show = () => form.querySelector<HTMLSelectElement>("select")!;
  const choose = (v: string) => {
    show().value = v;
    show().dispatchEvent(new window.Event("change"));
  };
  assert.deepEqual(labels(), ["Show", "Title", "Days", "Calendars"]);
  assert.deepEqual([...show().options].map((o) => o.textContent), ["Notes", "Tasks", "Month", "Agenda", "Today", "Board"]);
  assert.equal(show().value, "agenda");
  assert.equal(preview(), '::view{show=agenda label=Mine days=7 id=k3x9q}');

  choose("month");
  assert.deepEqual(labels(), ["Show", "Title", "Folder", "Show events", "Calendars"]);
  assert.equal(preview(), "::view{show=month label=Mine folder=Journal id=k3x9q}");

  choose("notes");
  assert.equal(labels()[0], "Show");
  assert.ok(labels().includes("Matching") && labels().includes("How many"));
  assert.equal(preview(), "::view{label=Mine limit=6 id=k3x9q}"); // notes is the default: no show=
  assert.ok([...form.querySelectorAll("button")].some((b) => b.textContent === "Save as smart folder"));

  choose("board");
  assert.deepEqual(labels(), ["Show", "Title", "Note", "Board"]);
  assert.ok(![...form.querySelectorAll("button")].some((b) => b.textContent === "Save as smart folder"));
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
  assert.deepEqual(updates, ["::view{show=board label=Mine id=k3x9q}"]);
  destroy();
  dom.remove();
});

test("the form's values keep what the new kind reads too, under its own defaults", () => {
  const notes = formValues(view, { folder: "Projects", tag: "work", sort: "title", label: "Mine" });
  assert.equal(notes.limit, "6");
  const tasks = switchKind(view, notes, "tasks");
  assert.deepEqual(tasks, { show: "tasks", label: "Mine", folder: "Projects", tag: "work" });
  // A month's folder is the journal's, so it starts from its default rather than the list's folder.
  assert.deepEqual(switchKind(view, tasks, "month"), { show: "month", folder: "Journal", label: "Mine" });
  assert.deepEqual(formResult(view, tasks, "abc"), { show: "tasks", label: "Mine", folder: "Projects", tag: "work", id: "abc" });
  assert.deepEqual(formResult(view, { show: "notes", q: "plan" }), { q: "plan" });
});
