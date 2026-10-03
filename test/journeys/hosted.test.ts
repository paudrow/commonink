// The hosted journey: a team workspace online, people joining by invite, and an agent signing in
// with OAuth to work there, against the Worker running locally (test/cloud.ts). One CLI login.
import { after } from "node:test";
import assert from "node:assert/strict";
import { cli, login } from "../cli-login.ts";
import { startCloud } from "../cloud.ts";
import { journey } from "./journey.ts";

const cloud = await startCloud();
after(() => cloud.close());

journey("Bring a teammate and their agent into a shared workspace", ({ given, when, then, and }) => {
  let ana: string, ben: string, cleo: string;
  let base: string;
  const agent = cli();
  const join = async (cookie: string, role: "editor" | "viewer") => {
    const { url } = await cloud.call(ana, "POST", `${base}/invites`, { role });
    assert.equal((await cloud.request(cookie, "POST", new URL(url).pathname)).status, 302);
  };
  given("Ana signs in and makes a workspace called Studio", async () => {
    ana = await cloud.signIn("ana");
    const { id } = await cloud.call(ana, "POST", "/api/workspaces", { name: "Studio" });
    base = `/api/w/${id}`;
  });
  when("she invites Ben as an editor, and he opens the invite", async () => {
    ben = await cloud.signIn("ben");
    await join(ben, "editor");
  });
  then("Studio is among Ben's workspaces, where he's an editor", async () => {
    const { workspaces }: { workspaces: Array<{ name: string; role: string }> } = await cloud.call(ben, "GET", "/api/me");
    assert.equal(workspaces.find((w) => w.name === "Studio")?.role, "editor");
  });
  when("Ben signs the command line in for his agents, through his browser", async () => {
    const r = await login(cloud, agent, ben);
    assert.equal(r.status, 0, r.err);
  });
  and("his agent, Drafter, writes a brief there with a task for Ana", () => {
    const r = agent.run(["create", "Brief", "-", "--workspace", "Studio", "--agent", "Drafter"], "# Brief\n\nA spring campaign.\n\n- [ ] Approve the brief @ana\n");
    assert.equal(r.status, 0, r.stderr);
  });
  then("Ana finds the brief in Studio, credited to Drafter for Ben", async () => {
    const note = await cloud.call(ana, "GET", `${base}/note?path=Brief.md`);
    assert.match(note.content, /^- \[ \] Approve the brief @ana$/m);
    const changes: Array<{ op: string; agent: string | null; person: string }> = await cloud.call(ana, "GET", `${base}/changes?path=Brief.md`);
    assert.deepEqual(changes.map((c) => [c.op, c.agent, c.person]), [["create", "Drafter", "Ben Dev"]]);
  });
  and("Ben's agent finds Ana's task for her among Studio's tasks", () => {
    assert.equal(agent.run(["tasks", "--assignee", "ana", "--workspace", "Studio"]).stdout, "- [ ] Approve the brief @ana — Brief.md:5\n");
  });
  when("Ana invites Cleo as a viewer", async () => {
    cleo = await cloud.signIn("cleo");
    await join(cleo, "viewer");
  });
  then("Cleo can read the brief, but not change it", async () => {
    assert.match((await cloud.call(cleo, "GET", `${base}/note?path=Brief.md`)).content, /A spring campaign/);
    const write = await cloud.request(cleo, "POST", `${base}/note`, { path: "Brief.md", content: "# Mine now\n", overwrite: true });
    assert.equal(write.status, 403);
  });
});
