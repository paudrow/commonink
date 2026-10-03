// ::view: one note query, laid out as a list, a table, a board or a month (src/core/view.ts and
// web/src/widgets/view.ts), with a board's drag writing the note's frontmatter.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { boardColumns, calendarDays, dateKeyOf, dayOf, fieldsOf, groupOf, layoutOf, propsWanted, rowsOf, viewArgKeys } from "../src/core/view.ts";
import { withProperty, propsOf } from "../src/core/frontmatter.ts";
import { toQuery } from "../src/core/query.ts";
import { parseAttrs, serializeAttrs } from "../src/core/directive.ts";
import { openTempVault } from "./helpers.ts";
import type { FeedItem, FeedPage } from "../web/src/api.ts";
import type { StaticSources } from "../web/src/export/static.ts";

const { api } = await import("../web/src/api.ts");
const { view, moveTo } = await import("../web/src/widgets/view.ts");
const { fieldValues } = await import("../web/src/widgets/core.ts");
const { toolSource } = await import("../web/src/editor/complete.ts");
const { renderStatic } = await import("../web/src/export/static.ts");

const args = (src: string) => parseAttrs(src);

test("a view's args: its layout, fields, a board's group and a calendar's date, and how many it shows", () => {
  assert.equal(layoutOf({}), "list");
  assert.equal(layoutOf(args("layout=Board")), "board");
  assert.equal(layoutOf(args("layout=gallery")), "list", "a layout that isn't one is a list");
  assert.deepEqual(fieldsOf(args('fields="Status, due,,status, tags"')), ["status", "due", "tags"]);
  assert.equal(groupOf({}), "status");
  assert.equal(groupOf(args("group=Owner")), "owner");
  assert.equal(dateKeyOf({}), "due");
  assert.equal(dateKeyOf(args("date=review")), "review");
  // What the index is asked for: the fields that are properties, and what a board groups by or a calendar dates by.
  assert.deepEqual(propsWanted(args("fields=status,tags,modified,folder,owner")), ["status", "owner"]);
  assert.deepEqual(propsWanted(args("layout=board fields=owner,status")), ["owner", "status"]);
  assert.deepEqual(propsWanted(args("layout=board group=owner fields=due")), ["due", "owner"]);
  assert.deepEqual(propsWanted(args("layout=calendar")), ["due"]);
  // A list or table shows a few; a board or calendar all of them, up to 200.
  assert.deepEqual([rowsOf({}, undefined), rowsOf(args("layout=table"), undefined), rowsOf(args("layout=board"), undefined), rowsOf(args("layout=calendar"), 20), rowsOf({}, 999)], [6, 6, 200, 20, 200]);
});

test("group and date are a view's own only in the layout that reads them; elsewhere they filter", () => {
  assert.deepEqual(viewArgKeys(args("layout=board")), ["label", "id", "layout", "fields", "group"]);
  assert.deepEqual(toQuery(args("tag=work layout=board group=owner fields=due label=Work")), { tag: "work" });
  assert.deepEqual(toQuery(args("layout=calendar date=review status=draft")), { q: "status=draft" });
  assert.deepEqual(toQuery(args("group=owner date=2026-10-01")), { q: "group=owner date=2026-10-01" });
});

test("the settings form writes group only for a board and date only for a calendar", () => {
  const save = (src: string) => serializeAttrs(fieldValues(view.fields, view.formArgs!(args(src))));
  assert.equal(save("tag=work layout=board group=owner fields=due,owner"), 'tag=work layout=board fields="due,owner" group=owner');
  assert.equal(save("layout=calendar date=review"), "layout=calendar date=review");
  // Switched to a list, the board's group goes; a date that was a filter stays one, in Matching.
  assert.equal(save("layout=list group=owner"), 'q="group=owner"');
  assert.equal(save("layout=table group=owner fields=a"), 'q="group=owner" layout=table fields=a');
  const group = view.fields.find((f) => f.key === "group")!;
  assert.deepEqual([group.when!({ layout: "board" }), group.when!({ layout: "list" }), group.when!({})], [true, false, false]);
});

const row = (path: string, props: Record<string, string[]> = {}, date: string | null = null) => ({ path, props, date });

test("a board has a column per value of its property, in the order notes have them, then one for notes without it", () => {
  const rows = [row("a.md", { status: ["Doing"] }), row("b.md", { status: ["todo"] }), row("c.md"), row("d.md", { status: ["doing", "review"] }), row("e.md", { status: ["Todo"] })];
  assert.deepEqual(
    boardColumns(rows, "status").map((c) => [c.value, c.rows.map((r) => r.path)]),
    [
      ["Doing", ["a.md", "d.md"]],
      ["todo", ["b.md", "e.md"]],
      [null, ["c.md"]],
    ],
  );
  assert.deepEqual(boardColumns([row("a.md", { status: ["x"] })], "status").map((c) => c.value), ["x"], "no empty column for notes without it when every note has one");
  assert.deepEqual(boardColumns([], "status").map((c) => c.value), [null], "an empty board still has somewhere to say so");
});

test("a calendar places each note on its date property's day, else on its own date", () => {
  assert.equal(dayOf(row("a.md", { due: ["2026-10-05"] }), "due"), "2026-10-05");
  assert.equal(dayOf(row("a.md", { due: ["2026-10-05T09:30"] }), "due"), "2026-10-05");
  assert.equal(dayOf(row("a.md", { due: ["soon"] }, "2026-09-01"), "due"), "2026-09-01", "no date in the property: the note's own");
  assert.equal(dayOf(row("a.md", {}, "2026-09-01"), "due"), "2026-09-01");
  assert.equal(dayOf(row("a.md", { due: ["2026-13-01"] }), "due"), null);
  const rows = [row("a.md", { due: ["2026-10-05"] }), row("b.md", { due: ["2026-10-05"] }), row("c.md", { due: ["2026-11-01"] }), row("d.md"), row("e.md", {}, "2026-10-31")];
  const { days, undated } = calendarDays(rows, "due", "2026-10");
  assert.deepEqual([...days].map(([d, r]) => [d, r.map((x) => x.path)]), [
    ["2026-10-05", ["a.md", "b.md"]],
    ["2026-10-31", ["e.md"]],
  ]);
  assert.equal(undated, 1);
});

test("moving a card writes the property in the note's frontmatter, leaving every other line as it was", () => {
  const md = "---\ntitle: Pricing\nStatus: [review, draft]\nowner: ana # lead\n---\n# Pricing\n\nstatus: not this one\n";
  assert.equal(withProperty(md, "status", "done"), "---\ntitle: Pricing\nStatus: done\nowner: ana # lead\n---\n# Pricing\n\nstatus: not this one\n");
  assert.equal(withProperty(md, "status", null), "---\ntitle: Pricing\nowner: ana # lead\n---\n# Pricing\n\nstatus: not this one\n");
  assert.equal(withProperty(md, "priority", "high"), "---\ntitle: Pricing\nStatus: [review, draft]\nowner: ana # lead\npriority: high\n---\n# Pricing\n\nstatus: not this one\n");
  // One per line under the key is replaced whole.
  assert.equal(withProperty("---\nstatus:\n  - a\n  - b\nx: 1\n---\nBody\n", "status", "c"), "---\nstatus: c\nx: 1\n---\nBody\n");
  // A note without frontmatter gets some; taking out what isn't there changes nothing.
  assert.equal(withProperty("# Plain\n", "status", "todo"), "---\nstatus: todo\n---\n# Plain\n");
  assert.equal(withProperty("# Plain\n", "status", null), "# Plain\n");
  // A value YAML would read as something else is quoted, and reads back as written.
  for (const v of ["in progress", "a: b", "#1", "yes", "- x", "[x]", 'say "hi"']) {
    assert.deepEqual(propsOf(withProperty("# N\n", "status", v)), [{ key: "status", value: v }], v);
  }
  assert.equal(withProperty("---\nstatus: a\n---\nB\n", "status", "in progress"), "---\nstatus: in progress\n---\nB\n");
  // \r\n and a byte-order mark stay.
  assert.equal(withProperty("﻿---\r\nstatus: a\r\nx: 1\r\n---\r\nBody\r\n", "status", "b"), "﻿---\r\nstatus: b\r\nx: 1\r\n---\r\nBody\r\n");
});

test("a board move saves the note against the version it read, and tries again once if it changed", async () => {
  const { note, save } = api;
  let text = "---\nstatus: todo\n---\n# A\n";
  let version = "v1";
  const saves: string[] = [];
  let clash = 1;
  api.note = (async () => ({ path: "A.md", content: text, version })) as never;
  api.save = (async (_p: string, next: string, base?: string) => {
    if (clash-- > 0) {
      // Someone typed in the note meanwhile.
      text = "---\nstatus: todo\n---\n# A\n\nMore.\n";
      version = "v2";
      throw Object.assign(new Error("changed"), { status: 409 });
    }
    assert.equal(base, version);
    saves.push(next);
    return { path: "A.md", version: "v3" };
  }) as never;
  try {
    await moveTo("A.md", "status", "done");
    assert.deepEqual(saves, ["---\nstatus: done\n---\n# A\n\nMore.\n"]);
    await moveTo("A.md", "status", "todo");
    assert.equal(saves.length, 1, "already there: nothing saved");
  } finally {
    Object.assign(api, { note, save });
  }
});

const item = (path: string, props: Record<string, string[]>, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: path,
  path,
  kind: "md",
  title: path.replace(/\.md$/, ""),
  mtime: 0,
  archived: false,
  excerpt: "",
  tags: [],
  lines: [],
  lastSource: null,
  lastBy: null,
  role: null,
  date: null,
  props,
  ...extra,
});

/** The widget mounted with these args over these notes: its body, what it opened, and what the feed was asked for. */
async function mounted(src: string, items: FeedItem[], readOnly = false) {
  const feed = api.feed;
  const asked: Array<Record<string, unknown>> = [];
  api.feed = (async (q: Record<string, unknown>) => (asked.push(q), { items, total: items.length, counts: { active: items.length, archived: 0 }, folders: [] }) as FeedPage) as never;
  const body = document.createElement("div");
  document.body.append(body);
  const opened: string[] = [];
  const stop = view.mount(body, { args: args(src), note: "Dash.md", readOnly, remeasure() {}, open: (p: string) => opened.push(p) } as never, body);
  await new Promise((r) => setTimeout(r, 0));
  api.feed = feed;
  return { body, opened, asked, stop };
}

test("every layout opens the note clicked, and none opens a day", async () => {
  const today = new Date().toLocaleDateString("en-CA");
  const notes = [item("Pricing.md", { status: ["draft"], due: [today], owner: ["ana"] }), item("Logo.md", { status: ["done"] })];
  for (const [layout, sel] of [
    ["list", ".qq-row"],
    ["table", ".qq-cell-title"],
    ["board", ".qv-card-title"],
    ["calendar", ".qv-day-note"],
  ]) {
    const { body, opened, stop } = await mounted(`layout=${layout} fields=owner`, notes);
    (body.querySelector(sel) as HTMLElement).click();
    assert.deepEqual(opened, ["Pricing.md"], layout);
    stop();
  }
});

test("a list shows each note's fields as chips; a table a column per field", async () => {
  const notes = [item("Pricing.md", { status: ["draft"], owner: ["ana", "bo"] }), item("Logo.md", {})];
  const list = await mounted("fields=status,owner", notes);
  assert.equal(list.asked[0].cols, "status,owner");
  assert.deepEqual([...list.body.querySelectorAll(".qq-row")].map((r) => [...r.querySelectorAll(".qv-chip")].map((c) => c.textContent)), [["statusdraft", "ownerana, bo"], []]);
  list.stop();
  const table = await mounted("layout=table fields=status,owner", notes);
  assert.deepEqual([...table.body.querySelectorAll("th")].map((t) => t.textContent), ["Note", "status", "owner"]);
  assert.deepEqual([...table.body.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent)), [
    ["Pricing", "draft", "ana, bo"],
    ["Logo", "–", "–"],
  ]);
  table.stop();
});

test("a board's columns are its group's values; a card dropped in another writes that value to its note", async () => {
  const notes = [item("Pricing.md", { status: ["Draft"], owner: ["ana"] }), item("Logo.md", { status: ["Done"] }), item("Emails.md", {})];
  const { body, asked, stop } = await mounted("layout=board fields=owner", notes);
  assert.equal(asked[0].cols, "owner,status");
  const cols = () => [...body.querySelectorAll(".qv-col")].map((c) => [c.querySelector(".qv-col-name")!.textContent, [...c.querySelectorAll(".qv-card")].map((x) => (x as HTMLElement).dataset.path)]);
  assert.deepEqual(cols(), [
    ["Draft", ["Pricing.md"]],
    ["Done", ["Logo.md"]],
    ["No status", ["Emails.md"]],
  ]);
  // The card shows its fields but not the one its column already says.
  assert.deepEqual([...body.querySelectorAll(".qv-card")][0].querySelectorAll(".qv-chip").length, 1);

  const { note, save } = api;
  const saved: Array<[string, string]> = [];
  api.note = (async (p: string) => ({ path: p, content: "---\nstatus: Draft\nowner: ana\n---\n# Pricing\n", version: "v1" })) as never;
  api.save = (async (p: string, next: string) => (saved.push([p, next]), { path: p, version: "v2" })) as never;
  try {
    const drop = (column: Element, path: string) => {
      const data = { types: ["application/x-commonink-view-card"], getData: () => path, dropEffect: "" };
      for (const type of ["dragover", "drop"]) {
        const e = new window.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "dataTransfer", { value: data });
        column.dispatchEvent(e);
      }
    };
    drop(body.querySelectorAll(".qv-col")[1], "Pricing.md");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(saved, [["Pricing.md", "---\nstatus: Done\nowner: ana\n---\n# Pricing\n"]]);
    assert.deepEqual(cols()[1], ["Done", ["Logo.md", "Pricing.md"]], "it moves at once");
    // Into "No status": the property comes out.
    drop(body.querySelectorAll(".qv-col")[2], "Pricing.md");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(saved[1][1], "---\nowner: ana\n---\n# Pricing\n");
  } finally {
    Object.assign(api, { note, save });
    stop();
  }
  const ro = await mounted("layout=board", notes, true);
  assert.equal((ro.body.querySelector(".qv-card") as HTMLElement).draggable, false, "nothing to drag for someone who can only read");
  ro.stop();
});

test("a calendar shows the month with each note on its day, and moves month by month", async () => {
  const now = new Date();
  const ym = now.toLocaleDateString("en-CA").slice(0, 7);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("en-CA").slice(0, 7);
  const notes = [item("Launch.md", { review: [`${ym}-03`] }), item("Retro.md", {}, { date: `${next}-02` }), item("Someday.md", {})];
  const { body, asked, stop } = await mounted("layout=calendar date=review", notes);
  assert.equal(asked[0].cols, "review");
  assert.equal(asked[0].limit, 201);
  const placed = () => [...body.querySelectorAll(".qv-day")].filter((d) => d.querySelector(".qv-day-note")).map((d) => [d.querySelector(".qv-day-num")!.textContent, d.querySelector(".qv-day-note")!.textContent]);
  assert.deepEqual(placed(), [["3", "Launch"]]);
  assert.match(body.querySelector(".qq-foot")!.textContent!, /1 without a date/);
  (body.querySelector('[title="Next month"]') as HTMLElement).click();
  assert.deepEqual(placed(), [["2", "Retro"]], "a note without the property goes on its own date");
  stop();
});

test("the slash menu's View is found by /view, /query, /table and /board", () => {
  const slash = (q: string) => {
    const doc = `/${q}`;
    const state = EditorState.create({ doc, extensions: [markdown()], selection: { anchor: doc.length } });
    ensureSyntaxTree(state, state.doc.length, 5000);
    return toolSource(new CompletionContext(state, doc.length, false))!.options.map((o) => o.label);
  };
  for (const q of ["view", "query", "table", "board", "calendar"]) assert.ok(slash(q).includes("View"), q);
  assert.equal(slash("query")[0], "View");
});

test("the index gives a view each note's own date and the properties notes have", () => {
  const { vault } = openTempVault({
    "Pricing.md": "---\nstatus: draft\ndue: 2026-10-05\nowner: ana\n---\n# Pricing\n",
    "Logo.md": "---\nStatus: Done\ndate: 2026-09-01\n---\n# Logo\n",
    "Journal/2026-09-30.md": "# 2026-09-30\n",
    "Archive/Old.md": "---\nlegacy: yes\n---\n# Old\n",
  });
  assert.deepEqual(vault.properties(), [
    { key: "status", notes: 2 },
    { key: "date", notes: 1 },
    { key: "due", notes: 1 },
    { key: "owner", notes: 1 },
  ]);
  const items = vault.feed({ sort: "title", cols: "status,due" }).items;
  assert.deepEqual(items.map((i) => [i.title, i.date, i.props]), [
    ["2026-09-30", "2026-09-30", {}],
    ["Logo", "2026-09-01", { status: ["Done"] }],
    ["Pricing", null, { status: ["draft"], due: ["2026-10-05"] }],
  ]);
});

test("an export shows a view as its table, and a board or calendar as the list of its notes with their fields", async () => {
  const notes = [item("Pricing.md", { status: ["draft"], owner: ["ana"] }, { excerpt: "Prices." }), item("Logo.md", {}, { excerpt: "A new logo." })];
  const sources = { feed: async () => notes, note: async () => null, url: async () => null, tasks: async () => [], today: async () => ({}) as never, math: () => import("../web/src/mathRender.ts") } as StaticSources;
  const shown = async (line: string) => {
    const d = document.createElement("div");
    d.innerHTML = await renderStatic("Dash.md", `${line}\n`, sources);
    return d.querySelector(".st-widget")!;
  };
  const table = await shown("::view{layout=table fields=status,owner}");
  assert.deepEqual([...table.querySelectorAll("tr")].map((r) => [...r.children].map((c) => c.textContent)), [
    ["Note", "status", "owner"],
    ["Pricing", "draft", "ana"],
    ["Logo", "", ""],
  ]);
  for (const layout of ["board", "calendar"]) {
    const list = await shown(`::view{layout=${layout} fields=owner label=Work}`);
    assert.deepEqual([...list.querySelectorAll("li")].map((l) => l.textContent), ["Pricing — owner: ana", "Logo — A new logo."], layout);
    assert.equal(list.querySelector(".st-widget-title")!.textContent, "Notes · Work");
  }
});
