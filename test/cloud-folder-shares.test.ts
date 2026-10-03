// A folder's shares end with the folder: deleting it stops them, and renaming another folder onto a
// name that still has shares is refused, so what's put there later isn't open to an old link or person.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, type Cloud } from "./cloud.ts";
import { cli, login } from "./cli-login.ts";

let cloud: Cloud;
let owner = "";
let base = "";

before(async () => {
  cloud = await startCloud();
  owner = await cloud.signIn("owner");
  base = `/api/w/${(await cloud.call(owner, "POST", "/api/workspaces", { name: "Team" })).id}`;
});
after(() => cloud.close());

const note = (path: string, content = `# ${path}\n`) => cloud.call(owner, "POST", `${base}/note`, { path, content });
const shareFolder = async (folder: string) => {
  const made = await cloud.call(owner, "POST", `${base}/shares`, { folder, link: true, role: "viewer" });
  await cloud.call(owner, "POST", `${base}/shares`, { folder, email: "contractor@example.com", role: "viewer" });
  return made.shares.find((s: { kind: string }) => s.kind === "link").url.split("/")[2] as string;
};
const folderShares = async (folder: string) => (await cloud.call(owner, "GET", `${base}/shares?folder=${encodeURIComponent(folder)}`)).shares as Array<{ id: string }>;
const linkSees = async (token: string) => {
  const res = await cloud.request(null, "GET", `/api/s/${token}/list`);
  return res.status === 200 ? ((await res.json()) as Array<{ path: string }>).map((n) => n.path).sort() : res.status;
};

test("deleting a folder stops its shares (and its folders'): a folder made with its name later isn't shared", async () => {
  await note("Drafts/Plan.md");
  await note("Drafts/Old/Idea.md");
  const link = await shareFolder("Drafts");
  await shareFolder("Drafts/Old");
  assert.deepEqual(await linkSees(link), ["Drafts/Old/Idea.md", "Drafts/Plan.md"]);
  const r = await cloud.call(owner, "POST", `${base}/delete-folder`, { folder: "Drafts/", notes: "trash" });
  assert.equal(r.unshared, 4);
  assert.deepEqual([await folderShares("Drafts"), await folderShares("Drafts/Old")], [[], []]);
  await note("Drafts/salaries.md", "# Salaries\n");
  assert.equal(await linkSees(link), 404);
  // Restoring its notes brings the folder back, unshared.
  await cloud.call(owner, "POST", `${base}/trash/restore`, { ids: r.trashed.map((t: { id: string }) => t.id) });
  assert.equal(await linkSees(link), 404);
  // Lifting its notes out deletes the folder too.
  const lifted = await shareFolder("Drafts");
  assert.equal((await cloud.call(owner, "POST", `${base}/delete-folder`, { folder: "Drafts", notes: "lift" })).unshared, 2);
  await note("Drafts/again.md");
  assert.equal(await linkSees(lifted), 404);
});

test("renaming a folder onto a name that still has shares is refused until they're stopped", async () => {
  await note("Shared/Gone.md");
  const link = await shareFolder("Shared");
  await shareFolder("Shared/Inner");
  // Emptied one note at a time, the folder is gone but its shares are left.
  await cloud.call(owner, "POST", `${base}/delete`, { paths: ["Shared/Gone.md"] });
  await note("Private/Pay.md");
  for (const to of ["Shared", "Shared/Inner"]) {
    const res = await cloud.request(owner, "POST", `${base}/folders/rename`, { folder: "Private", to });
    assert.equal(res.status, 409, to);
    assert.match(((await res.json()) as { error: string }).error, /is still shared outside the workspace .*Stop them first/);
  }
  assert.deepEqual(await linkSees(link), []);
  for (const s of [...(await folderShares("Shared")), ...(await folderShares("Shared/Inner"))]) await cloud.call(owner, "POST", `${base}/shares/remove`, { id: s.id });
  await cloud.call(owner, "POST", `${base}/folders/rename`, { folder: "Private", to: "Shared" });
  assert.equal(await linkSees(link), 404);
  // A shared folder renamed still takes its shares along, and back again.
  const moving = await shareFolder("Shared");
  await cloud.call(owner, "POST", `${base}/folders/rename`, { folder: "Shared", to: "Moved" });
  await cloud.call(owner, "POST", `${base}/folders/rename`, { folder: "Moved", to: "Shared" });
  assert.deepEqual(await linkSees(moving), ["Shared/Pay.md"]);
});

test("the CLI (and agents, by the same commands) get the same: delete stops sharing, rename onto shares is refused", async () => {
  const c = cli();
  await login(cloud, c, owner);
  const ws = ["--workspace", "Team"];
  await note("Agents/Plan.md");
  const link = await shareFolder("Agents");
  const del = c.run(["folder", "delete", "Agents", "--notes", "trash", ...ws]);
  assert.equal(del.status, 0, del.stderr);
  assert.match(del.stdout, /^Stopped sharing Agents\/ outside the workspace \(2 shares\); restoring its notes doesn't share it again\.$/m);
  await note("Agents/New.md");
  assert.equal(await linkSees(link), 404);
  await note("Left/Only.md");
  await shareFolder("Left");
  await cloud.call(owner, "POST", `${base}/delete`, { paths: ["Left/Only.md"] });
  await note("Mine/Pay.md");
  const ren = c.run(["folder", "rename", "Mine", "Left", ...ws]);
  assert.equal(ren.status, 5);
  assert.match(ren.stderr, /Left\/ is still shared outside the workspace \(2 shares/);
  assert.deepEqual((await cloud.call(owner, "GET", `${base}/notes`)).map((n: { path: string }) => n.path).filter((p: string) => p.startsWith("Mine/") || p.startsWith("Left/")), ["Mine/Pay.md"]);
});
