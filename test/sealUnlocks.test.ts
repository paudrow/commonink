// Each seal, earned the way the app earns it: a first this tab sees (sealUnlocks.ts listens for it),
// or a count from the API (stubbed here) after the notes change. One at a time, in order, so each
// step shows that exactly its seal was earned, kept, and announced.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { api } = await import("../web/src/api.ts");
const { did, didFirst, vaultEvents } = await import("../web/src/events.ts");
const { sealState, startSeals } = await import("../web/src/sealUnlocks.ts");
const { SEALS } = await import("../web/src/seals.ts");

// The API the seals count from, empty to start: a fresh workspace.
const stub = api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
const data = {
  guide: { done: [] as string[] },
  smartFolders: [] as unknown[],
  shares: [] as unknown[],
  agents: [] as string[],
  tasks: [] as Array<{ meta: { assignees: string[] } }>,
  history: [] as Array<{ ts: number; path: string; op: string; agent: string | null }>,
};
stub.guide = async () => data.guide;
stub.smartFolders = async () => data.smartFolders;
stub.shares = async () => ({ shares: data.shares });
stub.changeAgents = async () => data.agents;
stub.tasks = async () => data.tasks;
stub.history = async () => data.history;

// The seals wait a moment after notes change before counting; here they count at once.
const later = window.setTimeout.bind(window);
(window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number) => later(fn, ms === 2000 ? 0 : ms);

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => later(r, 5));
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const toasts = () => [...document.querySelectorAll("#toasts .toast-text")].map((n) => n.textContent);
const notesChanged = () => vaultEvents.dispatchEvent(new Event("change"));
const agentEdit = (ts: number) => ({ ts, path: `Note ${ts}.md`, op: "edit", agent: "Claude" });

localStorage.clear();
let opened = 0;
startSeals({ online: () => true, openSeals: () => opened++ }); // main.ts opens /profile, scrolled to Your seals
await settle();

/** Do `act`, then check that `id`, and only it, was just earned, kept for next time, and announced. */
async function earns(id: string, act: () => void) {
  const before = sealState().earned;
  assert.ok(!before.includes(id as never), `${id} isn't earned yet`);
  act();
  await settle();
  const after = sealState().earned;
  assert.deepEqual(after.filter((s) => !before.includes(s)), [id]);
  assert.ok(JSON.parse(localStorage.getItem("commonink.seals")!).includes(id), "kept in this browser");
  const seal = SEALS.find((s) => s.id === id)!;
  assert.equal(toasts().at(-1), `New seal: ${seal.name}`);
}

test("a fresh workspace has no seals, and says nothing", () => {
  assert.deepEqual(sealState().earned, []);
  assert.deepEqual(toasts(), []);
});

test("First link: linking one note to another", () => earns("link", () => did("link")));
test("First backlink: following a backlink", () => earns("backlink", () => didFirst("followedBacklink")));
test("First template: a note from a template", () => earns("template", () => didFirst("usedTemplate")));
test("First board: a kanban board", () => earns("board", () => didFirst("madeBoard")));

test("First smart folder: a saved search", () =>
  earns("smart-folder", () => {
    data.smartFolders = [{ name: "Open tasks" }];
    notesChanged();
  }));

test("First share: a note shared outside the workspace", () =>
  earns("shared", () => {
    data.shares = [{ id: "s1" }];
    notesChanged();
  }));

test("First handoff: a task assigned to an agent", () =>
  earns("agent-task", () => {
    data.agents = ["Claude Code"];
    data.tasks = [{ meta: { assignees: ["Jane"] } }, { meta: { assignees: ["@claude"] } }];
    notesChanged();
  }));

test("First agent edit: an agent's edit kept", () =>
  earns("agent-edit", () => {
    data.history = [agentEdit(1)];
    notesChanged();
  }));

test("Ten agent edits: not at nine, then at ten", async () => {
  data.history = Array.from({ length: 9 }, (_, i) => agentEdit(i + 1));
  notesChanged();
  await settle();
  assert.ok(!sealState().earned.includes("agent-ten"));
  assert.equal(sealState().stats?.agentEdits, 9);
  await earns("agent-ten", () => {
    data.history = Array.from({ length: 10 }, (_, i) => agentEdit(i + 1));
    notesChanged();
  });
});

test("every seal has been earned once, and the toast's button opens your profile, at Your seals", () => {
  assert.deepEqual([...sealState().earned].sort(), SEALS.map((s) => s.id).sort());
  const button = [...document.querySelectorAll<HTMLButtonElement>("#toasts .toast-action")].at(-1)!;
  assert.equal(button.textContent, "See seals");
  button.click();
  assert.equal(opened, 1);
});

test("your profile shows the seals, and hides them while a workspace isn't gamified", async () => {
  const { ProfilePage } = await import("../web/src/profilePage.ts");
  const { setGamified } = await import("../web/src/gamify.ts");
  const root = document.createElement("div");
  root.hidden = true;
  document.body.append(root);
  const page = new ProfilePage(root, null);
  page.show();
  await settle();
  assert.equal(root.querySelector("h1")?.textContent, "You", "locally it's you");
  const seals = root.querySelector<HTMLElement>("#profile-seals")!;
  assert.ok(!seals.hidden);
  assert.equal(seals.querySelectorAll(".seal.is-earned").length, SEALS.length);
  assert.equal(seals.querySelector(".seal-tally")?.textContent, `${SEALS.length} of ${SEALS.length} earned`);
  assert.ok(root.querySelector(".wd-map"), "and the days you wrote");

  // Rewards are kept in the settings note (gamify.ts): stub it so turning them off and on can write it.
  let settings: { content: string; version: number } | null = null;
  stub.note = async () => {
    if (!settings) throw new Error("no settings note");
    return settings;
  };
  stub.create = async (_path, text) => ((settings = { content: text as string, version: 1 }), { version: 1 });
  stub.save = async (_path, text) => ((settings = { content: text as string, version: settings!.version + 1 }), { version: settings!.version });
  await setGamified(false);
  assert.ok(seals.hidden, "no seals without rewards");
  await setGamified(true);
  assert.ok(!seals.hidden, "back, as they were");
  assert.equal(seals.querySelectorAll(".seal.is-earned").length, SEALS.length);
});
