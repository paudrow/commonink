// Deleting your own account (cloud/src/account.ts): what it takes with it, what it leaves for others,
// and what stops it (being a team's only owner).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

// Each test has its own server: team() signs in the same people, and an owner of two teams is blocked twice.
let cloud: Cloud;
beforeEach(async () => (cloud = await startCloud()));
afterEach(() => cloud.close());

const me = (cookie: string) => cloud.request(cookie, "GET", "/api/me");
const del = (cookie: string, confirm: string) => cloud.request(cookie, "POST", "/api/me/delete", { confirm });
const names = (ws: Array<{ name: string }>) => ws.map((w) => w.name).sort();

test("someone deletes their account: their own workspaces go, they leave the rest, and what others made stays", async () => {
  const t = await team(cloud);
  const memberIds = async () => (await cloud.call(t.owner, "GET", `${t.base}/members`)).map((m: { name: string }) => m.name);

  // The editor has a team of their own, and wrote a note in the shared team.
  await cloud.call(t.editor, "POST", "/api/workspaces", { name: "Solo" });
  await cloud.call(t.editor, "POST", `${t.base}/note`, { path: "From editor.md", content: "# From editor\n" });

  const plan = await cloud.call(t.editor, "GET", "/api/me/delete");
  assert.deepEqual(names(plan.deletes), ["Editor's notes", "Solo"]);
  assert.deepEqual(names(plan.leaves), ["Team"]);
  assert.deepEqual(plan.blocked, []);

  // Only their own email confirms it, in any case.
  const wrong = await del(t.editor, "someone@else");
  assert.equal(wrong.status, 400);
  assert.match(((await wrong.json()) as { error: string }).error, /Type your email, editor@localhost/);
  assert.equal((await me(t.editor)).status, 200, "nothing happened");

  const done = await del(t.editor, "  EDITOR@localhost ");
  assert.equal(done.status, 200);
  assert.ok(done.headers.getSetCookie().some((c) => c.startsWith("__Host-ci_session=;")), "this browser is signed out");
  assert.equal((await me(t.editor)).status, 401, "the session is gone");

  // The team keeps its notes, the editor's included; it just doesn't have them any more.
  assert.deepEqual(await memberIds(), ["Owner Dev", "Viewer Dev"]);
  const notes = (await cloud.call(t.owner, "GET", `${t.base}/notes`)).map((n: { path: string }) => n.path);
  assert.ok(notes.includes("From editor.md"));

  // Signing in again is someone new, with a new, empty-handed personal workspace.
  const again = await cloud.signIn("editor");
  const fresh = await cloud.call(again, "GET", "/api/me");
  assert.deepEqual(names(fresh.workspaces), ["Editor's notes"]);
  assert.notEqual(fresh.workspaces[0].id, plan.deletes.find((w: { kind: string }) => w.kind === "personal").id);

  // Someone a note was shared with goes, and so does the share.
  await cloud.call(t.owner, "POST", `${t.base}/note`, { path: "Brief.md", content: "# Brief\n" });
  await cloud.call(t.owner, "POST", `${t.base}/shares`, { path: "Brief.md", email: "stranger@localhost", role: "viewer" });
  const sharesOfBrief = async () => (await cloud.call(t.owner, "GET", `${t.base}/shares?path=Brief.md`)).shares.length;
  assert.equal(await sharesOfBrief(), 1);
  assert.equal((await del(t.stranger, "stranger@localhost")).status, 200);
  assert.equal(await sharesOfBrief(), 0);
});

test("a team's only owner can't delete their account until someone else owns it; then the team carries on", async () => {
  const t = await team(cloud);
  const plan = await cloud.call(t.owner, "GET", "/api/me/delete");
  assert.deepEqual(names(plan.blocked), ["Team"]);
  const refused = await del(t.owner, "owner@localhost");
  assert.equal(refused.status, 409);
  assert.match(((await refused.json()) as { error: string }).error, /only owner of Team/);
  assert.equal((await me(t.owner)).status, 200);

  // Someone else becomes an owner; now the owner can go, and the team is the new owner's.
  const members: Array<{ id: string; name: string }> = await cloud.call(t.owner, "GET", `${t.base}/members`);
  await cloud.call(t.owner, "POST", `${t.base}/members/role`, { user: members.find((m) => m.name === "Viewer Dev")!.id, role: "owner" });
  assert.equal((await del(t.owner, "owner@localhost")).status, 200);
  const left = await cloud.call(t.viewer, "GET", `${t.base}/members`);
  assert.deepEqual(left.map((m: { name: string; role: string }) => `${m.name}: ${m.role}`), ["Viewer Dev: owner", "Editor Dev: editor"]);
  // The new owner runs it: invites, and the log says the old owner left.
  assert.ok((await cloud.call(t.viewer, "POST", `${t.base}/invites`, { role: "viewer" })).url);
  const log = await cloud.call(t.viewer, "GET", `${t.base}/workspace/log`);
  assert.ok(log.some((l: { action: string; detail: string }) => l.action === "leave" && l.detail === "account deleted"));
});
