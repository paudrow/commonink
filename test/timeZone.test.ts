import { test } from "node:test";
import assert from "node:assert/strict";
import { localDate } from "../src/core/tasks.ts";
import { fmtTrash } from "../src/core/format.ts";
import fs from "node:fs";
import path from "node:path";
import { openVault } from "../src/core/local.ts";
import { openTempVault, tempVault } from "./helpers.ts";

// 21:00 CDT on Tuesday 2026-09-29 is 02:00 UTC on the 30th, as a Worker's clock has it.
const CHICAGO_EVENING = Date.parse("2026-09-30T02:00:00Z");
// 07:30 JST on Wednesday 2026-09-30 is 22:30 UTC on the 29th.
const TOKYO_MORNING = Date.parse("2026-09-29T22:30:00Z");

const VAULT = {
  "Inbox.md": "# Inbox\n\n- [ ] Pay rent due:2026-09-29\n- [ ] Renew passport due:2026-09-30\n",
  "Board.md": "# Board\n\n:::kanban\n## Doing\n\n- [ ] Draft the post\n\n## Done\n\n:::\n",
};

test("localDate gives the calendar day in a time zone", () => {
  assert.equal(localDate(CHICAGO_EVENING, "America/Chicago"), "2026-09-29");
  assert.equal(localDate(CHICAGO_EVENING, "UTC"), "2026-09-30");
  assert.equal(localDate(TOKYO_MORNING, "Asia/Tokyo"), "2026-09-30");
  assert.equal(localDate(TOKYO_MORNING, "UTC"), "2026-09-29");
});

test("at 9pm in Chicago, an agent's today, tomorrow and done dates are still Chicago's, whatever the server's clock zone", () => {
  const { vault } = openTempVault(VAULT, { now: () => CHICAGO_EVENING, timeZone: "America/Chicago" });

  const added = vault.addTask("call mom tomorrow", "agent");
  assert.equal(added.path, "Journal/2026-09-29.md");
  assert.equal(added.text, "call mom due:2026-09-30");

  const today = vault.today();
  assert.equal(today.date, "2026-09-29");
  assert.equal(today.journal.path, "Journal/2026-09-29.md");
  assert.deepEqual(
    today.sections.map((s) => [s.id, s.tasks.map((t) => t.text)]),
    [
      ["overdue", []],
      ["due", ["Pay rent due:2026-09-29"]],
      ["starting", []],
    ],
  );
  assert.deepEqual(vault.tasks({ due: "tomorrow" }).map((t) => t.text), ["Renew passport due:2026-09-30", "call mom due:2026-09-30"]);

  const ticked = vault.updateTask("Inbox", 3, "Pay rent due:2026-09-29", { checked: true }, "agent");
  assert.equal(ticked.text, "Pay rent due:2026-09-29 done:2026-09-29");

  vault.editCard("Board", "Draft the post", { done: true }, "agent");
  assert.match(vault.read("Board").content, /- \[x\] Draft the post done:2026-09-29/);
});

test("at 7:30am in Tokyo, an agent's today is already Tokyo's new day while UTC is still on yesterday", () => {
  const { vault } = openTempVault(VAULT, { now: () => TOKYO_MORNING, timeZone: "Asia/Tokyo" });

  const added = vault.addTask("call mom tomorrow", "agent");
  assert.equal(added.path, "Journal/2026-09-30.md");
  assert.equal(added.text, "call mom due:2026-10-01");

  const ticked = vault.updateTask("Inbox", 4, "Renew passport due:2026-09-30", { checked: true }, "agent");
  assert.equal(ticked.text, "Renew passport due:2026-09-30 done:2026-09-30");

  assert.equal(vault.today().date, "2026-09-30");
  assert.deepEqual(vault.tasks({ due: "<today" }).map((t) => t.text), ["Pay rent due:2026-09-29"]);
});

/** Run `fn` with this process's clock zone set to `zone`, as on a machine there. */
function onMachineIn<T>(zone: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test("locally, with no zone given, today is the machine's day", () => {
  const { vault } = openTempVault(VAULT, { now: () => CHICAGO_EVENING });
  assert.equal(onMachineIn("America/Chicago", () => vault.today().date), "2026-09-29");
  assert.equal(onMachineIn("Asia/Tokyo", () => vault.addTask("call mom tomorrow", "cli").text), "call mom due:2026-10-01");
});

test("Trash says when an item went and when it goes for good in the machine's time", () => {
  const item = { id: "1-1", path: "Old.md", kind: "md" as const, size: 1, deletedAt: CHICAGO_EVENING, expiresAt: CHICAGO_EVENING + 30 * 86_400_000, by: null, excerpt: "" };
  assert.equal(onMachineIn("America/Chicago", () => fmtTrash([item])), "1-1  Old.md — deleted 2026-09-29 21:00, gone for good 2026-10-29");
});

test("at 9pm in Chicago, notes made from templates and the journal note have Chicago's date and time, on a server in UTC", () => {
  const { vault } = openTempVault(
    {
      "Templates/Standup.md": '---\ntitle: "{{date}} Standup"\n---\n# Standup {{date}} {{time}}\n',
      "Templates/Journal.md": "# {{date}} at {{time}}\n",
    },
    { now: () => CHICAGO_EVENING, timeZone: "America/Chicago" },
  );
  onMachineIn("UTC", () => {
    assert.equal(vault.renderTemplate("Standup").text, "# Standup 2026-09-29 21:00\n");
    const made = vault.createFromTemplate("Standup", {}, "agent");
    assert.equal(made.path, "2026-09-29 Standup.md");
    assert.match(vault.read(made.path).content, /# Standup 2026-09-29 21:00/);
    const daily = vault.dailyNote(vault.today().date, "agent");
    assert.equal(daily.path, "Journal/2026-09-29.md");
    assert.match(vault.read(daily.path).content, /# 2026-09-29 at 21:00/);
  });
});

test("sort=date takes an undated note's day from its last edit in the vault's time zone, not UTC's", () => {
  const dir = tempVault({ "A.md": "---\ndate: 2026-10-02\n---\n# A\n", "B.md": "# B\n" });
  // 23:00 and 22:00 PDT on Friday 2026-10-02 are already the 3rd in UTC.
  fs.utimesSync(path.join(dir, "A.md"), new Date("2026-10-03T06:00:00Z"), new Date("2026-10-03T06:00:00Z"));
  fs.utimesSync(path.join(dir, "B.md"), new Date("2026-10-03T05:00:00Z"), new Date("2026-10-03T05:00:00Z"));
  const vault = openVault(dir, { timeZone: "America/Los_Angeles" });
  // Both are the 2nd, so the later edit comes first.
  assert.deepEqual(vault.feed({ sort: "date" }).items.map((n) => n.path), ["A.md", "B.md"]);
});
