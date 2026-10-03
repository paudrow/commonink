// Folders named with an emoji, online: renaming or deleting one reaches everything in it, and
// shares of the folders in it follow a rename. (An emoji is two UTF-16 units but one SQL character.)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
let owner = "";
let base = "";

before(async () => {
  cloud = await startCloud();
  owner = await cloud.signIn("owner");
  const { id } = await cloud.call(owner, "POST", "/api/workspaces", { name: "Team" });
  base = `/api/w/${id}`;
});
after(() => cloud.close());

test("an emoji folder renames with its notes and the shares in it, and deletes", async () => {
  await cloud.call(owner, "POST", `${base}/note`, { path: "📁 Projects/A.md", content: "# A\n" });
  await cloud.call(owner, "POST", `${base}/note`, { path: "📁 Projects/Client A/B.md", content: "# B\n" });
  await cloud.call(owner, "POST", `${base}/shares`, { folder: "📁 Projects/Client A", email: "member@localhost", role: "viewer" });
  const moved = await cloud.call(owner, "POST", `${base}/folders/rename`, { folder: "📁 Projects", to: "🗂️ Work" });
  assert.deepEqual(moved.moved.map((m: { to: string }) => m.to).sort(), ["🗂️ Work/A.md", "🗂️ Work/Client A/B.md"]);
  const q = (f: string) => `${base}/shares?folder=${encodeURIComponent(f)}`;
  assert.deepEqual((await cloud.call(owner, "GET", q("🗂️ Work/Client A"))).shares.map((s: { email: string }) => s.email), ["member@localhost"]);
  assert.deepEqual((await cloud.call(owner, "GET", q("📁 Projects/Client A"))).shares, []);
  const gone = await cloud.call(owner, "POST", `${base}/delete-folder`, { folder: "🗂️ Work", notes: "trash" });
  assert.equal(gone.trashed.length, 2);
  const left: Array<{ path: string }> = await cloud.call(owner, "GET", `${base}/notes`);
  assert.deepEqual(left.filter((n) => /^(🗂️ Work|📁 Projects)\//u.test(n.path)), []);
});
