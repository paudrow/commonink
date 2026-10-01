import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

const names = (list: Array<{ name: string; role: string }>) => list.map((m) => `${m.name}: ${m.role}`);

test("everyone sees who's in a workspace; owners change roles and remove people, but never the last owner", async () => {
  const t = await team(cloud);
  const members = await cloud.call(t.viewer, "GET", `${t.base}/members`);
  assert.deepEqual(names(members), ["Owner Dev: owner", "Editor Dev: editor", "Viewer Dev: viewer"]);
  const id = (n: string) => members.find((m: { name: string }) => m.name === n).id;

  const post = (who: string, route: string, body: unknown) => cloud.request(who, "POST", `${t.base}${route}`, body);
  assert.equal((await post(t.owner, "/members/role", { user: id("Owner Dev"), role: "editor" })).status, 409, "the last owner can't be demoted");
  assert.equal((await post(t.owner, "/members/role", { user: id("Editor Dev"), role: "boss" })).status, 400);
  assert.equal((await post(t.owner, "/members/role", { user: "someone-else", role: "viewer" })).status, 404);
  assert.equal((await post(t.owner, "/members/role", { user: id("Editor Dev"), role: "viewer" })).status, 200);
  assert.equal((await cloud.request(t.editor, "PUT", `${t.base}/note`, { path: "x.md", content: "x" })).status, 403, "a demoted editor can't edit");
  assert.equal((await post(t.owner, "/members/remove", { user: id("Viewer Dev") })).status, 200);
  assert.equal((await cloud.request(t.viewer, "GET", `${t.base}/notes`)).status, 404, "someone removed can't open it");
  assert.equal((await post(t.owner, "/members/remove", { user: id("Owner Dev") })).status, 400);

  const log = await cloud.call(t.owner, "GET", `${t.base}/workspace/log`);
  assert.deepEqual(
    log.slice(0, 2).map((l: { actor: string; action: string; target: string; detail: string }) => `${l.actor} ${l.action} ${l.target} ${l.detail}`),
    ["Owner Dev remove Viewer Dev viewer", "Owner Dev role Editor Dev editor → viewer"],
  );
});

test("members can leave; the only owner can't until someone else owns it, and no one leaves their own workspace", async () => {
  const t = await team(cloud);
  assert.equal((await cloud.request(t.editor, "POST", `${t.base}/leave`, {})).status, 200);
  assert.equal((await cloud.request(t.editor, "GET", `${t.base}/notes`)).status, 404);
  const leave = await cloud.request(t.owner, "POST", `${t.base}/leave`, {});
  assert.deepEqual([leave.status, ((await leave.json()) as { error: string }).error], [409, "You're its only owner. Make someone else an owner first, or delete the workspace."]);
  const viewerId = (await cloud.call(t.owner, "GET", `${t.base}/members`)).find((m: { name: string }) => m.name === "Viewer Dev").id;
  await cloud.call(t.owner, "POST", `${t.base}/members/role`, { user: viewerId, role: "owner" });
  assert.equal((await cloud.request(t.owner, "POST", `${t.base}/leave`, {})).status, 200);
  assert.deepEqual(names(await cloud.call(t.viewer, "GET", `${t.base}/members`)), ["Viewer Dev: owner"]);
  const mine = (await cloud.call(t.viewer, "GET", "/api/me")).workspaces.find((w: { kind: string }) => w.kind === "personal");
  assert.equal((await cloud.request(t.viewer, "POST", `/api/w/${mine.id}/leave`, {})).status, 409);
});

test("two owners demoting each other, removing each other or leaving at once still leave an owner", async () => {
  const owners = async (t: Awaited<ReturnType<typeof team>>) =>
    (await cloud.call(t.viewer, "GET", `${t.base}/members`)).filter((m: { role: string }) => m.role === "owner").map((m: { name: string }) => m.name);
  /** A team with two owners: the owner and the editor, made an owner. */
  const twoOwners = async () => {
    const t = await team(cloud);
    const members = await cloud.call(t.owner, "GET", `${t.base}/members`);
    const id = (n: string) => members.find((m: { name: string }) => m.name === n).id as string;
    await cloud.call(t.owner, "POST", `${t.base}/members/role`, { user: id("Editor Dev"), role: "owner" });
    return { t, owner: id("Owner Dev"), editor: id("Editor Dev") };
  };
  // One goes through; the other finds them the last owner (409), or itself no longer an owner (403) or member (404).
  const race = async (...reqs: ReturnType<Cloud["request"]>[]) => (await Promise.all(reqs)).filter((r) => r.status === 200).length;

  // Many rounds, as most interleavings may happen to be safe; whoever's left an owner promotes the other again.
  const a = await twoOwners();
  for (let i = 0; i < 40; i++) {
    const demoted = await race(
      cloud.request(a.t.owner, "POST", `${a.t.base}/members/role`, { user: a.editor, role: "editor" }),
      cloud.request(a.t.editor, "POST", `${a.t.base}/members/role`, { user: a.owner, role: "editor" }),
    );
    const left = await owners(a.t);
    assert.deepEqual([demoted, left.length], [1, 1], "demoting each other");
    const [by, other] = left[0] === "Owner Dev" ? [a.t.owner, a.editor] : [a.t.editor, a.owner];
    await cloud.call(by, "POST", `${a.t.base}/members/role`, { user: other, role: "owner" });
  }

  const b = await twoOwners();
  const removed = await race(
    cloud.request(b.t.owner, "POST", `${b.t.base}/members/remove`, { user: b.editor }),
    cloud.request(b.t.editor, "POST", `${b.t.base}/members/remove`, { user: b.owner }),
  );
  assert.deepEqual([removed, (await owners(b.t)).length], [1, 1], "removing each other");

  const c = await twoOwners();
  const left = await race(cloud.request(c.t.owner, "POST", `${c.t.base}/leave`, {}), cloud.request(c.t.editor, "POST", `${c.t.base}/leave`, {}));
  assert.deepEqual([left, (await owners(c.t)).length], [1, 1], "both leaving");
});

test("invite links list who used them; an unused one can be revoked, and then it doesn't work", async () => {
  const t = await team(cloud);
  const newcomer = await cloud.signIn("newcomer");
  const used = await cloud.call(t.owner, "POST", `${t.base}/invites`, { role: "viewer" });
  await cloud.request(newcomer, "POST", new URL(used.url).pathname);
  const unused = await cloud.call(t.owner, "POST", `${t.base}/invites`, { role: "editor" });
  const invites = await cloud.call(t.owner, "GET", `${t.base}/invites`);
  assert.deepEqual(
    invites.map((i: { role: string; createdBy: string; usedBy: string | null }) => `${i.role} by ${i.createdBy}, used by ${i.usedBy ?? "no one"}`),
    ["editor by Owner Dev, used by no one", "viewer by Owner Dev, used by Newcomer Dev", "viewer by Owner Dev, used by Viewer Dev", "editor by Owner Dev, used by Editor Dev"],
  );
  assert.equal((await cloud.request(t.owner, "GET", new URL(used.url).pathname)).status, 410, "a used link is spent");
  const other = await team(cloud); // another workspace's owner can't revoke this one's links
  assert.equal((await cloud.request(other.owner, "POST", `${other.base}/invites/revoke`, { id: invites[0].id })).status, 404);
  assert.equal((await cloud.request(t.owner, "POST", `${t.base}/invites/revoke`, { id: invites[1].id })).status, 404, "a used link can't be revoked");
  assert.equal((await cloud.request(t.owner, "POST", `${t.base}/invites/revoke`, { id: invites[0].id })).status, 200);
  assert.equal((await cloud.request(await cloud.signIn("latecomer"), "GET", new URL(unused.url).pathname)).status, 410);
});

test("owners rename a workspace, and delete a team one only by typing its name: its notes, files, members and links go", async () => {
  const t = await team(cloud);
  assert.deepEqual(await cloud.call(t.owner, "POST", `${t.base}/workspace/rename`, { name: "  Launch crew " }), { ok: true, name: "Launch crew" });
  assert.equal((await cloud.call(t.editor, "GET", "/api/me")).workspaces.find((w: { id: string }) => w.id === t.id).name, "Launch crew");
  await cloud.request(t.owner, "POST", `${t.base}/upload?name=f.txt`, new TextEncoder().encode("bytes"), { "content-type": "text/plain" });
  const invite = await cloud.call(t.owner, "POST", `${t.base}/invites`, { role: "viewer" });
  const env = await cloud.server.getWorker().getEnv();
  const blobs = async () => (await env.FILES.list({ prefix: `ws/${t.id}/` })).objects.length;
  assert.ok((await blobs()) > 0);

  assert.equal((await cloud.request(t.owner, "POST", `${t.base}/workspace/delete`, { confirm: "Team" })).status, 400);
  assert.equal((await cloud.request(t.owner, "POST", `${t.base}/workspace/delete`, { confirm: "Launch crew" })).status, 200);
  for (const who of [t.owner, t.editor, t.viewer]) assert.equal((await cloud.request(who, "GET", `${t.base}/notes`)).status, 404);
  assert.equal((await cloud.call(t.editor, "GET", "/api/me")).workspaces.some((w: { id: string }) => w.id === t.id), false);
  assert.equal(await blobs(), 0);
  assert.equal((await cloud.request(await cloud.signIn("late"), "GET", new URL(invite.url).pathname)).status, 410);
  const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM members WHERE workspace_id = ?1) + (SELECT COUNT(*) FROM invites WHERE workspace_id = ?1) + (SELECT COUNT(*) FROM note_ids WHERE workspace_id = ?1) AS n").bind(t.id).first();
  assert.equal((left as { n: number } | null)?.n, 0);

  const mine = (await cloud.call(t.owner, "GET", "/api/me")).workspaces.find((w: { kind: string }) => w.kind === "personal");
  assert.equal((await cloud.request(t.owner, "POST", `/api/w/${mine.id}/workspace/delete`, { confirm: mine.name })).status, 409);
});
