import { test } from "node:test";
import assert from "node:assert/strict";
import { runTaskCommand, targetOf } from "../web/src/taskCommand.ts";

test(":task adds the parsed line straight away, and its toast's Undo removes it; bare :task opens the bar", async () => {
  const calls: string[] = [];
  let undo: (() => void) | undefined;
  const deps = {
    add: async (text: string) => (calls.push(`add ${text}`), { path: "Journal/2026-09-28.md", line: 5, text: "Call mom due:2026-09-29" }),
    remove: async (r: { path: string; line: number; text: string }) => void calls.push(`remove ${r.path}:${r.line} ${r.text}`),
    openBar: () => void calls.push("open"),
    toast: (t: { text: string; actionLabel?: string; action?: () => void }) => ((undo = t.action), calls.push(`toast ${t.text} [${t.actionLabel}]`)),
  };
  await runTaskCommand("  call mom tomorrow ", deps);
  assert.deepEqual(calls, ["add call mom tomorrow", 'toast Added "- [ ] Call mom due:2026-09-29" to Journal/2026-09-28 [Undo]']);
  await undo!();
  assert.equal(calls.at(-1), "remove Journal/2026-09-28.md:5 Call mom due:2026-09-29");
  await runTaskCommand("", deps);
  assert.equal(calls.at(-1), "open");
});

test("Tab's target: today's daily note or the note it was opened from, and → [[Note]] beats both", () => {
  assert.deepEqual(targetOf(null, false, "Projects/Launch.md", "2026-09-28"), { label: "Journal/2026-09-28", to: undefined });
  assert.deepEqual(targetOf(null, true, "Projects/Launch.md", "2026-09-28"), { label: "Launch", to: "Projects/Launch.md" });
  assert.deepEqual(targetOf("Other", true, "Projects/Launch.md", "2026-09-28"), { label: "Other", to: undefined });
  assert.deepEqual(targetOf(null, true, undefined, "2026-09-28"), { label: "Journal/2026-09-28", to: undefined });
});
