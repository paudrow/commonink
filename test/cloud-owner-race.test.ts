import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

// Its own server: these races make several teams, and one owner may only make so many invite links an hour.
let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

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
