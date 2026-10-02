import { test } from "node:test";
import assert from "node:assert/strict";
import { targetOf } from "../web/src/taskCommand.ts";

test("Tab's target: today's journal note or the note it was opened from, and → [[Note]] beats both", () => {
  assert.deepEqual(targetOf(null, false, "Projects/Launch.md", "2026-09-28"), { label: "Journal/2026-09-28", to: undefined });
  assert.deepEqual(targetOf(null, true, "Projects/Launch.md", "2026-09-28"), { label: "Launch", to: "Projects/Launch.md" });
  assert.deepEqual(targetOf("Other", true, "Projects/Launch.md", "2026-09-28"), { label: "Other", to: undefined });
  assert.deepEqual(targetOf(null, true, undefined, "2026-09-28"), { label: "Journal/2026-09-28", to: undefined });
});
