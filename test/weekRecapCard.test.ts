// The Today page's week card reloads the change log when the vault changes: not in a hidden tab, and
// at most every 30 seconds while an agent keeps editing.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

let loads = 0; // one api.tasks call per load of the card
globalThis.fetch = (async (input: string) => {
  if (String(input).startsWith("/api/tasks")) loads++;
  return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { vaultEvents } = await import("../web/src/events.ts");
const { mountWeekRecap } = await import("../web/src/weekRecapCard.ts");

let hidden = false;
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
const setHidden = (h: boolean) => ((hidden = h), document.dispatchEvent(new window.Event("visibilitychange")));
const edit = () => vaultEvents.dispatchEvent(new Event("change"));

test("a steady run of edits reloads the card at most every 30 seconds, and a hidden tab not at all", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-10-01T12:00:00") });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = mountWeekRecap(host, () => {});
  const tick = async (ms: number) => {
    t.mock.timers.tick(ms);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); // the loads' fetches
  };
  await tick(0);
  assert.equal(loads, 1, "loads once when shown");

  // An agent saves every 5 seconds for a minute.
  for (let i = 0; i < 12; i++) {
    edit();
    await tick(5_000);
  }
  assert.ok(loads <= 3, `at most every 30 seconds (got ${loads})`);
  assert.ok(loads >= 2, "but it does catch up");
  await tick(60_000);
  const settled = loads;

  setHidden(true);
  for (let i = 0; i < 12; i++) {
    edit();
    await tick(5_000);
  }
  assert.equal(loads, settled, "nothing while the tab is hidden");
  setHidden(false);
  await tick(0);
  assert.equal(loads, settled + 1, "one load when it's shown again");
  setHidden(true);
  setHidden(false);
  await tick(0);
  assert.equal(loads, settled + 1, "and none when nothing changed");
  setHidden(true);
  await tick(24 * 3600_000);
  setHidden(false);
  await tick(0);
  assert.equal(loads, settled + 2, "but one on a new day");

  unmount();
  edit();
  await tick(60_000);
  assert.equal(loads, settled + 2, "nothing after it's gone");
});
