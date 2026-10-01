import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctDays, earnedInks, INKS, progressText, unlockToast, type InkStats } from "../web/src/inks.ts";

const none: InkStats = { guideFinished: null, notes: null, ticked: null, agentEdited: null, days: null };
const ink = (id: string) => INKS.find((i) => i.id === id)!;

test("Indigo is always yours; each other ink comes at its milestone", () => {
  assert.deepEqual(earnedInks(none), ["indigo"]);
  assert.deepEqual(earnedInks({ guideFinished: false, notes: 9, ticked: 24, agentEdited: false, days: 6 }), ["indigo"]);
  assert.deepEqual(earnedInks({ guideFinished: true, notes: 10, ticked: 25, agentEdited: true, days: 7 }), ["indigo", "sepia", "viridian", "vermilion", "cobalt", "iron-gall"]);
  assert.deepEqual(earnedInks({ ...none, notes: 40, ticked: 3 }), ["indigo", "viridian"]);
});

test("progress reads as a count only while one is under way", () => {
  const s: InkStats = { guideFinished: false, notes: 3, ticked: 30, agentEdited: false, days: 2 };
  assert.equal(progressText(ink("viridian"), s), "3 of 10");
  assert.equal(progressText(ink("iron-gall"), s), "2 of 7");
  assert.equal(progressText(ink("vermilion"), s), null, "earned");
  assert.equal(progressText(ink("sepia"), s), null, "yes or no");
  assert.equal(progressText(ink("viridian"), null), null, "not counted yet");
  assert.equal(progressText(ink("viridian"), { ...s, notes: null }), null);
});

test("days are counted in the given time zone, up to a cap", () => {
  const at = (iso: string) => ({ ts: Date.parse(iso) });
  const changes = [at("2026-10-01T23:30:00Z"), at("2026-10-02T00:30:00Z"), at("2026-10-02T09:00:00Z"), at("2026-10-05T12:00:00Z")];
  assert.equal(distinctDays(changes, "UTC"), 3);
  assert.equal(distinctDays(changes, "Asia/Tokyo"), 2, "late on the 1st in UTC is the morning of the 2nd in Tokyo");
  assert.equal(distinctDays(changes, "UTC", 2), 2);
  assert.equal(distinctDays([], "UTC"), 0);
});

test("one ink gets its own toast; several at once, one that names them all", () => {
  assert.deepEqual(unlockToast(["vermilion"]), { text: "New ink: Vermilion", detail: "You ticked 25 tasks." });
  assert.deepEqual(unlockToast(["sepia", "viridian", "cobalt"]), { text: "New inks: Sepia, Viridian and Cobalt", detail: "Pick one in Settings → Appearance." });
  assert.equal(unlockToast([]), null);
  assert.equal(unlockToast(["indigo"]), null, "Indigo is never news");
});
