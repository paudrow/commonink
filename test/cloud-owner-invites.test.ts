import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

test("an owner's unused invite links stop working once they're removed or no longer an owner, so they can't let themselves back in", async () => {
  const t = await team(cloud);
  const members = await cloud.call(t.owner, "GET", `${t.base}/members`);
  const id = (n: string) => members.find((m: { name: string }) => m.name === n).id;
  for (const who of ["Editor Dev", "Viewer Dev"]) await cloud.call(t.owner, "POST", `${t.base}/members/role`, { user: id(who), role: "owner" });
  const link = async (who: string, role: string) => new URL((await cloud.call(who, "POST", `${t.base}/invites`, { role })).url).pathname;
  const [ownersLink, viewersLink] = [await link(t.owner, "editor"), await link(t.viewer, "editor")];

  await cloud.call(t.editor, "POST", `${t.base}/members/role`, { user: id("Viewer Dev"), role: "editor" });
  assert.equal((await cloud.request(t.stranger, "POST", viewersLink)).status, 410, "a demoted owner's link is gone");
  await cloud.call(t.editor, "POST", `${t.base}/members/remove`, { user: id("Owner Dev") });
  assert.equal((await cloud.request(t.owner, "POST", ownersLink)).status, 410, "a removed owner's link is gone");
  assert.equal((await cloud.request(t.owner, "GET", `${t.base}/notes`)).status, 404, "and they're still out");
  assert.equal((await cloud.request(t.stranger, "POST", await link(t.editor, "viewer"))).status, 302, "a current owner's link still works");
});
