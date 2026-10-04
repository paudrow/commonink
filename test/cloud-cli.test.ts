// The CLI against a hosted workspace: `commonink login` through a real OAuth round trip with the Worker
// running locally in workerd (a person in a browser allows it), then commands in the workspace they
// pick, attributed, and limited by their role there.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCloud, team, type Cloud } from "./cloud.ts";
import { cli, login as loginTo } from "./cli-login.ts";
import { md5 } from "../src/core/convert.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

/** `commonink login`, with `cookie`'s person in the browser allowing it for `workspace` ("*" for all of them). */
const login = (c: ReturnType<typeof cli>, cookie: string, workspace = "*") => loginTo(cloud, c, cookie, workspace);

test("commonink login signs in through the browser and keeps its tokens where only you can read them", async () => {
  const c = cli();
  const { status, out, html } = await login(c, people.owner);
  assert.equal(status, 0);
  assert.match(html, /Connect commonink CLI to Common Ink\?/);
  // Offered, and picked, for the CLI, which gets its answer on this computer.
  assert.match(html, /<input type="radio" name="workspace" value="\*" checked>\s*<span><strong>All your workspaces<\/strong>/);
  assert.match(out, /^Signed in to http:\/\/\S+ as Owner Dev\. Workspaces: Owner's notes \(owner\), Team \(owner\)\. Pick one with commonink workspaces use <name>, or --workspace\.\n$/);
  const file = path.join(c.config, "credentials.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const creds = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(creds).sort(), ["accessToken", "clientId", "expiresAt", "refreshToken", "server", "user"]);
  const agents = await cloud.call(people.owner, "GET", "/api/agents");
  assert.deepEqual(agents.map((a: { client: string; allWorkspaces?: boolean }) => [a.client, a.allWorkspaces]), [["commonink CLI", true]]);
});

test("commands run in the workspace you name, attributed to you or to the agent writing for you", async () => {
  const c = cli();
  await login(c, people.owner);
  assert.deepEqual(c.json(["workspaces"]).workspaces.map((w: { name: string; role: string }) => [w.name, w.role]), [["Owner's notes", "owner"], ["Team", "owner"]]);
  // Two workspaces and no default: a command has to say which.
  const which = c.run(["ls"]);
  assert.equal(which.status, 2);
  assert.match(which.stderr, /^Say which workspace: --workspace <name>, or commonink workspaces use <name>\. Yours: Owner's notes, Team\n$/);
  assert.equal(c.run(["create", "Hello", "-", "--workspace", "team", "--agent", "Tester"], "# Hello from the CLI\n").status, 0);
  assert.equal(c.run(["append", "Hello", "- by hand", "--workspace", "Team"]).status, 0);
  const note = await cloud.call(people.owner, "GET", `${people.base}/note?path=Hello.md`);
  assert.equal(note.content, "# Hello from the CLI\n\n- by hand\n");
  const changes = await cloud.call(people.owner, "GET", `${people.base}/changes?path=Hello.md`);
  assert.deepEqual(changes.map((ch: { op: string; agent: string | null; person: string }) => [ch.op, ch.agent, ch.person]), [["edit", null, "Owner Dev"], ["create", "Tester", "Owner Dev"]]);
  // A default workspace, and the other one by name.
  assert.equal(c.run(["workspaces", "use", "Team"]).stdout, "Commands go to Team now.\n");
  assert.match(c.run(["ls"]).stdout, /^- Hello\.md — Hello from the CLI\n/m);
  assert.equal(c.run(["read", "Hello", "--workspace", "Owner's notes"]).status, 3);
  assert.equal(c.json(["read", "Hello"]).content, "# Hello from the CLI\n\n- by hand\n");
  const nowhere = c.run(["ls", "--workspace", "Nowhere"]);
  assert.equal(nowhere.status, 3);
  // Exit codes and --json errors are the same as for a local vault.
  assert.deepEqual(JSON.parse(c.run(["create", "Hello", "again", "--json"]).stdout), { error: "Hello.md already exists. To replace it, create it again with overwrite (--overwrite); to change part of it, use edit_note", code: "exists", exit: 5 });
  assert.equal(c.run(["edit", "Hello", "--old", "by hand", "--new", "x", "--base", "000000000000"]).status, 4);
});

test("the workspace's calendar from the CLI: events, and a meeting note made and linked", async () => {
  const cal = await cloud.call(people.owner, "POST", `${people.base}/calendar/sources`, { url: "https://demo.commonink.invalid/agents.ics" });
  const c = cli();
  await login(c, people.editor);
  const team = ["--workspace", "Team", "--tz", "America/Los_Angeles"];
  const list = c.run(["events", "--from", "2026-10-05", "--days", "1", ...team]);
  assert.match(list.stdout, /^1 event, Mon, Oct 5 to Mon, Oct 5 \(America\/Los_Angeles\):\n- Standup · .* · id ([a-z2-9]{12})\n$/);
  const id = list.stdout.match(/id ([a-z2-9]{12})$/m)![1];
  assert.equal(c.run(["meeting-note", id, ...team]).stdout, "Created Meetings/2026-10-05 Standup.md, linked to the event\n");
  assert.match(c.run(["event", id, ...team]).stdout, /^meeting note: Meetings\/2026-10-05 Standup\.md$/m);
  assert.equal(c.run(["event", "nope", ...team]).status, 3);
  await cloud.call(people.owner, "POST", `${people.base}/calendar/sources/remove`, { id: cal.id });
});

test("subscribing and refreshing calendars from the CLI is limited per person, as in the app", async () => {
  const c = cli();
  await login(c, people.editor);
  const { accessToken } = JSON.parse(fs.readFileSync(path.join(c.config, "credentials.json"), "utf8"));
  const refresh = async () => {
    const res = await fetch(new URL("/mcp/cli/run", cloud.origin), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "calendars refresh", input: {}, workspace: "Team" }),
    });
    await res.body?.cancel();
    return res.status;
  };
  const seen: number[] = [];
  for (let i = 0; i < 61; i++) seen.push(await refresh());
  assert.deepEqual([seen.slice(0, 60).every((s) => s === 200), seen[60]], [true, 429]);
  assert.match(c.run(["calendars", "add", "https://demo.commonink.invalid/more.ics", "--workspace", "Team"]).stderr, /a lot of calendar subscribing/);
});

test("a CLI's today is its person's day, in the time zone their browser reported", async () => {
  const zone = "Pacific/Kiritimati"; // UTC+14: a day ahead of UTC for most of it
  const c = cli();
  await login(c, people.viewer);
  await cloud.call(people.viewer, "POST", "/api/me/time-zone", { timeZone: zone });
  const day = c.run(["today", "--workspace", "Team"]).stdout.match(/Journal\/(\d{4}-\d{2}-\d{2})\.md/)?.[1];
  assert.equal(day, new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(Date.now()));
});

test("files go up to R2 and come back down, byte for byte", async () => {
  const c = cli();
  await login(c, people.owner);
  const here = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-up-"));
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 137, 80, 78, 71]);
  fs.writeFileSync(path.join(here, "pixel.png"), bytes);
  const up = c.json(["upload", path.join(here, "pixel.png"), "--workspace", "Team"]);
  assert.deepEqual(up, [{ path: "assets/pixel.png", size: 10 }]);
  const out = path.join(here, "back.png");
  assert.equal(c.run(["download", "assets/pixel.png", "--workspace", "Team", "--out", out]).status, 0);
  assert.deepEqual([...fs.readFileSync(out)], [...bytes]);
});

test("commonink import brings a folder of notes and its pictures into a hosted workspace in one go", async () => {
  const c = cli();
  await login(c, people.owner);
  const here = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-import-"));
  fs.mkdirSync(path.join(here, "Areas"));
  fs.writeFileSync(path.join(here, "Areas/Health.md"), "# Health\n\n![[scan.png]]\n");
  fs.writeFileSync(path.join(here, "Areas/scan.png"), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(here, "Inbox.md"), "# Inbox\n");
  const r = c.json(["import", here, "--folder", "Moved", "--workspace", "Team"]);
  assert.deepEqual(r.created, ["Moved/Areas/Health.md", "Moved/Inbox.md"]);
  assert.deepEqual(r.files, ["Moved/Areas/scan.png"]);
  assert.match(c.run(["read", "Moved/Areas/Health", "--workspace", "Team"]).stdout, /# Health/);
  const out = path.join(here, "back.png");
  assert.equal(c.run(["download", "Moved/Areas/scan.png", "--workspace", "Team", "--out", out]).status, 0);
  assert.deepEqual([...fs.readFileSync(out)], [137, 80, 78, 71]);
  // An Evernote notebook is converted on the way in, its picture going to R2 beside it.
  const pic = Buffer.from([137, 80, 78, 71, 9]);
  fs.writeFileSync(
    path.join(here, "Trips.enex"),
    `<en-export><note><title>Lisbon</title><content><![CDATA[<en-note><div>Pack</div><en-media hash="${md5(pic)}" type="image/png"/></en-note>]]></content>` +
      `<resource><data encoding="base64">${pic.toString("base64")}</data><mime>image/png</mime></resource></note></en-export>`,
  );
  const enex = c.json(["import", path.join(here, "Trips.enex"), "--workspace", "Team"]);
  assert.equal(enex.from, "evernote");
  assert.deepEqual(enex.created, ["Trips/Lisbon.md"]);
  assert.equal(enex.files.length, 1);
  assert.match(c.run(["read", "Trips/Lisbon", "--workspace", "Team"]).stdout, /1│Pack\n2│\n3│!\[\[attachments\/\w+\.png\]\]/);
});

test("contacts, labels, tasks --by me and export work in a hosted workspace too", async () => {
  const c = cli();
  await login(c, people.owner);
  const team = ["--workspace", "Team"];
  assert.equal(c.run(["contact", "add", "Rae Lin", "--email", "rae@x.org", ...team]).stdout, "Created People/Rae Lin.md. Link to them with [[People/Rae Lin]].\n");
  assert.match(c.run(["contact", "Rae Lin", "--role", "CTO", ...team]).stdout, /^Updated People\/Rae Lin\.md/);
  assert.match(c.run(["contacts", "--q", "rae", ...team]).stdout, /^People\/Rae Lin\.md — Rae Lin · CTO/);
  assert.equal(c.run(["create", "Given", "- [ ] Ship it @rae\n", ...team]).status, 0);
  assert.match(c.run(["tasks", "--by", "me", ...team]).stdout, /Ship it @rae/);
  assert.match(c.run(["label", "Given", "v1", ...team]).stdout, /^Labeled Given\.md as "v1"/);
  assert.equal(c.run(["append", "Given", "- [ ] More", ...team]).status, 0);
  assert.match(c.run(["diff", "Given", "--from", "v1", ...team]).stdout, /^\+- \[ \] More$/m);
  assert.match(c.run(["restore", "Given", "--to", "v1", ...team]).stdout, /^Restored to "v1": Given\.md/);
  const here = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-export-"));
  const md = path.join(here, "Given.md");
  assert.equal(c.run(["export", "Given", "--format", "md", "--out", md, ...team]).status, 0);
  assert.equal(fs.readFileSync(md, "utf8"), "- [ ] Ship it @rae\n");
});

test("a viewer's CLI reads but can't write, and a grant for one workspace stays in it", async () => {
  const viewer = cli();
  await login(viewer, people.viewer);
  const team = "--workspace";
  assert.equal(viewer.run(["ls", team, "Team"]).status, 0);
  const denied = viewer.run(["create", "Nope", "x", team, "Team"]);
  assert.equal(denied.status, 6);
  assert.match(denied.stderr, /^You can view Team but not edit it\n$/);
  // A grant for just the Team workspace (an app that asked for one) can't reach the person's own notes.
  const one = cli();
  await login(one, people.editor, people.id);
  assert.deepEqual(one.json(["workspaces"]).workspaces.map((w: { name: string }) => w.name), ["Team"]);
  assert.equal(one.run(["ls"]).status, 0);
  assert.equal(one.run(["ls", team, "Editor's notes"]).status, 3);
  // What it writes is the client's, by its registered name, even when it names no agent or another one.
  assert.equal(one.run(["create", "From one grant", "x"]).status, 0);
  assert.equal(one.run(["append", "From one grant", "more", "--agent", "Someone else"]).status, 0);
  const changes = await cloud.call(people.editor, "GET", `${people.base}/changes?path=${encodeURIComponent("From one grant.md")}`);
  assert.deepEqual(changes.map((ch: { agent: string | null; person: string }) => [ch.agent, ch.person]), [["commonink CLI", "Editor Dev"], ["commonink CLI", "Editor Dev"]]);
  // Nor its settings: a grant for one workspace (an MCP client's, which reaches /mcp/cli with the same token) is to its notes.
  const owner = cli();
  await login(owner, people.owner, people.id);
  assert.equal(owner.run(["ls"]).status, 0);
  for (const args of [["invite", "--role", "editor"], ["members"], ["workspace", "rename", "Mine"]]) {
    const refused = owner.run(args);
    assert.equal(refused.status, 6, args.join(" "));
    assert.match(refused.stderr, /needs a sign-in for all your workspaces/);
  }
});

test("sharing from the CLI: by email, listed, stopped; links wait for the owner's setting, as an agent's do, and a viewer only lists", async () => {
  const editor = cli();
  await login(editor, people.editor);
  const team = ["--workspace", "Team"];
  assert.equal(editor.run(["create", "Shared from the CLI", "-", ...team], "# Shared from the CLI\n").status, 0);
  const shared = editor.run(["share", "Shared from the CLI", "--email", "cli-guest@example.com", "--role", "viewer", ...team]);
  assert.equal(shared.status, 0, shared.stderr);
  const id = shared.stdout.match(/- cli-guest@example\.com \(by email\) — viewer \(id (\w+)\)/)![1];
  // A command can't tell a person from an agent, so the workspace's setting for agents holds.
  const link = editor.run(["share", "Shared from the CLI", "--link", "--role", "viewer", ...team]);
  assert.equal(link.status, 6);
  assert.match(link.stderr, /^Agents can't share by link or for editing in this workspace\./);
  // Nor does it get the URL of a link made in the app (anyone with it could join), until that's allowed.
  const made = await cloud.call(people.owner, "POST", `${people.base}/shares`, { path: "Shared from the CLI.md", link: true, role: "viewer" });
  const linkLine = () => editor.run(["shares", "Shared from the CLI", ...team]).stdout.split("\n").find((l) => l.includes("Anyone with the link"))!;
  assert.match(linkLine(), /^- Anyone with the link — viewer/);
  await cloud.call(people.owner, "POST", `${people.base}/workspace/settings`, { agentLinks: true });
  assert.match(linkLine(), /^- Anyone with the link: http\S+\/s\/[a-f0-9]{64} — viewer/);
  await cloud.call(people.owner, "POST", `${people.base}/workspace/settings`, { agentLinks: false });
  await cloud.call(people.owner, "POST", `${people.base}/shares/remove`, { id: made.shares.find((s: { kind: string }) => s.kind === "link").id });
  const viewer = cli();
  await login(viewer, people.viewer);
  assert.match(viewer.run(["shares", "Shared from the CLI", ...team]).stdout, /cli-guest@example\.com/);
  assert.equal(viewer.run(["unshare", id, ...team]).status, 6);
  assert.equal(editor.run(["unshare", id, ...team]).stdout, "Stopped sharing it.\n");
  assert.equal(editor.run(["shares", "Shared from the CLI", ...team]).stdout, "Shared from the CLI.md isn't shared with anyone outside the workspace.\n");
});

test("only an app on your computer that asks for every workspace can be given every workspace", async () => {
  const consent = async (redirect: string, scope?: string) => {
    const reg = await cloud.server.fetch(new URL("/oauth/register", cloud.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Some Agent", redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const query = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirect, code_challenge: "x".repeat(43), code_challenge_method: "S256", state: "s", ...(scope ? { scope } : {}) });
    const page = await cloud.request(people.owner, "GET", `/authorize?${query}`);
    const html = await page.text();
    const handle = html.match(/name="handle" value="([^"]+)"/)![1];
    const binding = page.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const answer = (workspace: string) =>
      cloud.server.fetch(new URL("/authorize", cloud.origin), {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${people.owner}; ${binding}`, origin: cloud.origin },
        body: new URLSearchParams({ handle, decision: "allow", workspace }).toString(),
      });
    return { html, answer };
  };
  // An MCP client asks for no scope, and a website gets no more for asking: it isn't offered, and an
  // answer of "all of them" (a forged form) is refused.
  for (const [redirect, scope] of [["http://127.0.0.1:9/callback"], ["https://look-alike.example/cb", "workspaces"]]) {
    const { html, answer } = await consent(redirect!, scope);
    assert.doesNotMatch(html, /All your workspaces/);
    const forged = await answer("*");
    assert.equal(forged.status, 400);
    assert.match(await forged.text(), /Pick one of your workspaces/);
  }
  // A workspace that isn't yours is refused without using up the answer, so a right one still goes through.
  const { answer } = await consent("https://look-alike.example/cb", "workspaces");
  assert.equal((await answer("not-mine")).status, 400);
  const fixed = await answer(people.id);
  assert.equal(fixed.status, 302);
  assert.match(fixed.headers.get("location")!, /^https:\/\/look-alike\.example\/cb\?code=/);
});

test("a workspace's settings from the CLI: invite links, members and roles, a new name, leaving", async () => {
  await cloud.call(people.owner, "POST", "/api/workspaces", { name: "Crew" });
  const owner = cli();
  await login(owner, people.owner);
  const crew = ["--workspace", "Crew"];
  const join = async (url: string) => assert.equal((await cloud.request(people.stranger, "POST", new URL(url).pathname)).status, 302);
  // An invite link, and someone joining with it.
  const invite = owner.json(["invite", "--role", "viewer", ...crew]);
  assert.equal(invite.role, "viewer");
  await join(invite.url);
  const roles = () => owner.json(["members", ...crew]).map((m: { name: string; role: string }) => `${m.name}: ${m.role}`);
  assert.deepEqual(roles(), ["Owner Dev: owner", "Stranger Dev: viewer"]);
  // A viewer sees who's in it, and can't invite anyone.
  const stranger = cli();
  await login(stranger, people.stranger);
  assert.match(stranger.run(["members", ...crew]).stdout, /^- Owner Dev <\S+> \(owner\)\n- Stranger Dev <\S+> \(viewer\)\n$/);
  assert.equal(stranger.run(["invite", ...crew]).status, 6);
  // Roles, by name in any case. The last owner can't step down.
  assert.equal(owner.run(["member", "role", "stranger dev", "editor", ...crew]).stdout, "Stranger Dev is an editor of Crew now.\n");
  assert.deepEqual(roles(), ["Owner Dev: owner", "Stranger Dev: editor"]);
  const last = owner.run(["member", "role", "Owner Dev", "viewer", ...crew]);
  assert.equal(last.status, 4);
  assert.match(last.stderr, /A workspace needs an owner/);
  // An open link, revoked by the start of its ID.
  owner.run(["invite", ...crew]);
  const open = owner.json(["invites", ...crew]).find((i: { usedAt: number | null }) => !i.usedAt);
  assert.match(owner.run(["invites", ...crew]).stdout, new RegExp(`^- ${open.id.slice(0, 12)} editor, made by Owner Dev on \\S+: active until`, "m"));
  assert.equal(owner.run(["invites", "revoke", open.id.slice(0, 8), ...crew]).stdout, `Revoked the editor invite link ${open.id.slice(0, 12)}.\n`);
  assert.equal(owner.run(["invites", "revoke", open.id.slice(0, 8), ...crew]).status, 3);
  // A new name, for everyone, in the log.
  assert.equal(owner.run(["workspace", "rename", "Crew", "two", ...crew]).stdout, "Renamed Crew to Crew two.\n");
  const two = ["--workspace", "Crew two"];
  assert.match(owner.run(["workspace", "log", ...two]).stdout, /^- \S+ \S+ Owner Dev: rename \(Crew → Crew two\)\n/);
  // Leaving, and being removed.
  assert.equal(stranger.run(["leave", ...two]).stdout, "You left Crew two.\n");
  assert.equal(stranger.run(["ls", ...two]).status, 3);
  await join(owner.json(["invite", ...two]).url);
  assert.equal(owner.run(["member", "remove", "Stranger Dev", ...two]).stdout, "Removed Stranger Dev from Crew two.\n");
  assert.deepEqual(owner.json(["members", ...two]).map((m: { name: string }) => m.name), ["Owner Dev"]);
  assert.equal(owner.run(["member", "remove", "Stranger Dev", ...two]).status, 3);
  // A local vault has no settings.
  const signedOut = cli();
  assert.match(signedOut.run(["members"]).stderr, /^member list is for a hosted workspace: run commonink login first\n$/);
  assert.equal(signedOut.run(["members"]).status, 7);
  assert.equal(owner.run(["members", "--workspace", "local"]).status, 2);
});

test("Revoke in Connected agents cuts the CLI off at its next command", async () => {
  const c = cli();
  await login(c, people.editor);
  assert.equal(c.run(["ls", "--workspace", "Team"]).status, 0);
  const [agent] = await cloud.call(people.editor, "GET", "/api/agents");
  await cloud.call(people.editor, "POST", "/api/agents/revoke", { id: agent.id });
  const r = c.run(["ls", "--workspace", "Team"]);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /^Your sign-in to http:\/\/\S+ has ended\. Run commonink login\.\n$/);
});

test("logout ends the sign-in on the server too; then commands say to log in, or use the local vault", async () => {
  const c = cli();
  await login(c, people.owner);
  const { accessToken } = JSON.parse(fs.readFileSync(path.join(c.config, "credentials.json"), "utf8"));
  assert.match(c.run(["logout"]).stdout, /^Signed out of http:\/\/\S+\.\n$/);
  const res = await fetch(new URL("/mcp/cli/workspaces", cloud.origin), { headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 401);
  const r = c.run(["ls", "--workspace", "Team"]);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /run commonink login first/);
  assert.equal(c.run(["workspaces"]).status, 7);
});
