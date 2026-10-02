import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

test("a workspace is gamified until an owner turns it off; everyone reads it, and the other settings stay as they were", async () => {
  const t = await team(cloud);
  const settings = (who: string) => cloud.call(who, "GET", `${t.base}/workspace/settings`);
  const post = (who: string, body: unknown) => cloud.request(who, "POST", `${t.base}/workspace/settings`, body);
  assert.deepEqual(await settings(t.viewer), { agentLinks: false, gamified: true });

  assert.equal((await post(t.editor, { gamified: false })).status, 403, "only an owner changes it");
  assert.equal((await post(t.owner, { gamified: "no" })).status, 400);
  assert.equal((await post(t.owner, {})).status, 400);
  assert.deepEqual(await (await post(t.owner, { gamified: false })).json(), { agentLinks: false, gamified: false });
  assert.deepEqual(await settings(t.viewer), { agentLinks: false, gamified: false });

  assert.deepEqual(await (await post(t.owner, { agentLinks: true })).json(), { agentLinks: true, gamified: false }, "changing one leaves the other");
  const log = await cloud.call(t.owner, "GET", `${t.base}/workspace/log`);
  assert.deepEqual(log.slice(0, 2).map((l: { detail: string }) => l.detail), ["agentLinks: on", "gamified: off"]);
});
