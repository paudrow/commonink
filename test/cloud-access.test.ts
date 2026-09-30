import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ACCOUNT_ROUTES, SHARED_ROUTES, WORKSPACE_ROUTES } from "../cloud/src/access.ts";
import { TOOL_ROUTES } from "../src/core/tools.ts";
import { startCloud, team, type Cloud } from "./cloud.ts";

/** The workspace's members, and two people outside it that a note is shared with (as viewer, as editor). */
const WHO = ["signedOut", "stranger", "viewer", "editor", "owner", "sharedViewer", "sharedEditor"] as const;
type Who = (typeof WHO)[number];
/** "ok" is any success (2xx, a redirect, or a WebSocket's 101); a number is that exact status. */
type Expect = "ok" | number;
type Send = [method: string, path: string, body?: unknown, headers?: Record<string, string>];

const READ: Expect[] = [401, 404, "ok", "ok", "ok"];
const EDIT: Expect[] = [401, 404, 403, "ok", "ok"];
const OWN: Expect[] = [401, 404, 403, 403, "ok"];
const SIGNED_IN: Expect[] = [401, "ok", "ok", "ok", "ok"];
/** What's shared, note by note: members, and the people it's shared with. */
const SHARED_READ: Expect[] = [401, 404, "ok", "ok", "ok", "ok", "ok"];
const SHARED_EDIT: Expect[] = [401, 404, 403, "ok", "ok", 403, "ok"];
const MEMBERS_ONLY: Expect[] = [401, 404, "ok", "ok", "ok", 404, 404];
/** Someone a note is shared with gets nothing else of the workspace, like a stranger (unless a row says otherwise). */
const wide = (e: Expect[]) => (e.length === WHO.length ? e : [...e, e[1], e[1]]);

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
let startId: string;
const restoreIds = {} as Record<Who, number>;
/** A smart folder of each person's own, for them to delete. */
const folderIds = {} as Record<Who, string>;
/** Trash items for each person to restore and to delete for good. */
const trashIds = {} as Record<Who, { restore: string; purge: string }>;
/** The note shared with the two people outside, and a share for each person to change and to remove. */
let sharedId = "";
const shareIds = {} as Record<Who, { update: string; remove: string }>;
const outside = {} as Record<"sharedViewer" | "sharedEditor", string>;
/** A member only the owner's requests change (their role, then removing them), and an invite link to revoke. */
let spareId = "";
let spareInvite = "";
/** A second team with the same people in the same roles, for them to leave. */
let leaveBase = "";
/** Calendars for each person to rename and to remove, and an event to make a meeting note from. */
const calendarIds = {} as Record<Who, { rename: string; remove: string }>;
let eventId = "";
/** Events in the workspace's own calendar for each person to move and to delete. */
const ownEvents = {} as Record<Who, { move: string; remove: string }>;
const EVENT = (title: string) => ({ source: "local", title, start: "2026-10-06T15:00:00Z", end: "2026-10-06T16:00:00Z" });
const DEMO = (name: string) => `https://demo.commonink.invalid/${name}.ics`; // the Preview demo feed (cloud/src/demo-calendar.ts)

/**
 * Every route online, what each kind of person gets back, and a request that works for anyone
 * allowed. Writes act on each person's own notes, so one person's write can't change another's result.
 */
const MATRIX: Array<{ route: string; send: (w: Who) => Send; expect: Expect[] }> = [
  { route: "GET /info", send: () => ["GET", "/info"], expect: READ },
  { route: "GET /notes", send: () => ["GET", "/notes"], expect: READ },
  { route: "GET /note", send: () => ["GET", "/note?path=Getting%20started.md"], expect: READ },
  { route: "GET /resolve", send: () => ["GET", "/resolve?target=Getting%20started"], expect: READ },
  { route: "GET /search", send: () => ["GET", "/search?q=welcome"], expect: READ },
  { route: "GET /feed", send: () => ["GET", "/feed"], expect: READ },
  { route: "GET /backlinks", send: () => ["GET", "/backlinks?path=Getting%20started.md"], expect: READ },
  { route: "GET /changes", send: () => ["GET", "/changes?by=ai"], expect: READ },
  { route: "GET /changes/agents", send: () => ["GET", "/changes/agents"], expect: READ },
  { route: "GET /diffs", send: () => ["GET", "/diffs?ids=1-3"], expect: READ },
  { route: "GET /diffstats", send: () => ["GET", "/diffstats?sets=1-3;4"], expect: READ },
  { route: "GET /diff", send: () => ["GET", "/diff?from=1"], expect: READ },
  { route: "GET /tasks", send: () => ["GET", "/tasks"], expect: READ },
  { route: "GET /tasks/count", send: () => ["GET", "/tasks/count"], expect: READ },
  { route: "GET /favorites", send: () => ["GET", "/favorites"], expect: READ },
  { route: "GET /smart-folders", send: () => ["GET", "/smart-folders"], expect: READ },
  { route: "GET /tags", send: () => ["GET", "/tags"], expect: READ },
  { route: "GET /asset-tags", send: () => ["GET", "/asset-tags"], expect: READ },
  { route: "GET /today", send: () => ["GET", "/today?today=2026-10-01"], expect: READ },
  { route: "GET /files/*", send: () => ["GET", "/files/assets/margin.svg"], expect: READ },
  { route: "GET /file-resolve", send: () => ["GET", "/file-resolve?target=margin.svg"], expect: READ },
  { route: "GET /live", send: () => ["GET", "/live", undefined, liveHeaders()], expect: READ },
  { route: "POST /favorites/star", send: () => ["POST", "/favorites/star", { path: "Getting started.md" }], expect: READ },
  { route: "POST /favorites/unstar", send: () => ["POST", "/favorites/unstar", { path: "Getting started.md" }], expect: READ },
  { route: "PUT /favorites", send: () => ["PUT", "/favorites", { paths: [] }], expect: READ },
  // A viewer's smart folders are their own; the workspace refuses them shared ones (test/api.test.ts).
  { route: "POST /smart-folders", send: (w) => ["POST", "/smart-folders", { name: `Mine ${w}`, query: "tag=plan" }], expect: READ },
  { route: "POST /smart-folders/delete", send: (w) => ["POST", "/smart-folders/delete", { id: folderIds[w] ?? "nope" }], expect: READ },
  { route: "PUT /note", send: (w) => ["PUT", "/note", { path: `put-${w}.md`, content: "# Put\n" }], expect: EDIT },
  { route: "POST /note", send: (w) => ["POST", "/note", { path: `new-${w}.md`, content: "# New\n" }], expect: EDIT },
  { route: "POST /tasks/set", send: (w) => ["POST", "/tasks/set", { path: `tasks-${w}.md`, line: 1, text: "Do it", done: true }], expect: EDIT },
  { route: "POST /tasks/update", send: (w) => ["POST", "/tasks/update", { path: `update-${w}.md`, line: 1, text: "Change me", patch: { due: "2026-10-01" } }], expect: EDIT },
  { route: "POST /tasks/add", send: (w) => ["POST", "/tasks/add", { text: `Call ${w} tomorrow → [[Getting started]]` }], expect: EDIT },
  { route: "POST /tasks/remove", send: (w) => ["POST", "/tasks/remove", { path: `task-rm-${w}.md`, line: 1, text: "Remove me" }], expect: EDIT },
  { route: "POST /tasks/move", send: (w) => ["POST", "/tasks/move", { path: `task-move-${w}.md`, line: 1, text: "Move me", to: "Getting started" }], expect: EDIT },
  { route: "GET /guide", send: () => ["GET", "/guide"], expect: READ },
  { route: "GET /templates", send: () => ["GET", "/templates"], expect: READ },
  { route: "POST /templates/render", send: () => ["POST", "/templates/render", { template: "Access template" }], expect: READ },
  { route: "POST /notes/from-template", send: (w) => ["POST", "/notes/from-template", { template: "Access template", title: `From template ${w}` }], expect: EDIT },
  { route: "POST /guide", send: () => ["POST", "/guide", { action: "search" }], expect: EDIT },
  { route: "POST /today/journal", send: () => ["POST", "/today/journal", { today: "2026-10-01" }], expect: EDIT },
  { route: "POST /tags", send: (w) => ["POST", "/tags", { tag: `added-${w}` }], expect: EDIT },
  { route: "POST /tags/delete", send: (w) => ["POST", "/tags/delete", { tag: `added-${w}` }], expect: EDIT },
  { route: "POST /tags/rename", send: (w) => ["POST", "/tags/rename", { from: `old-${w}`, to: `new-${w}` }], expect: EDIT },
  { route: "PUT /asset-tags", send: (w) => ["PUT", "/asset-tags", { path: "assets/margin.svg", tags: [`asset-${w}`] }], expect: EDIT },
  { route: "POST /move", send: (w) => ["POST", "/move", { from: `move-${w}.md`, to: `moved-${w}.md` }], expect: EDIT },
  { route: "POST /restore", send: (w) => ["POST", "/restore", { id: restoreIds[w] ?? 1 }], expect: EDIT },
  { route: "POST /archive", send: (w) => ["POST", "/archive", { paths: [`arch-${w}.md`] }], expect: EDIT },
  { route: "POST /unarchive", send: (w) => ["POST", "/unarchive", { paths: [`Archive/unarch-${w}.md`] }], expect: EDIT },
  { route: "GET /delete-check", send: (w) => ["GET", `/delete-check?path=tasks-${w}.md`], expect: EDIT },
  { route: "POST /delete", send: (w) => ["POST", "/delete", { paths: [`del-${w}.md`] }], expect: EDIT },
  { route: "POST /delete-folder", send: (w) => ["POST", "/delete-folder", { folder: `folder-${w}`, notes: "lift" }], expect: EDIT },
  { route: "GET /trash", send: () => ["GET", "/trash"], expect: EDIT },
  { route: "POST /trash/restore", send: (w) => ["POST", "/trash/restore", { ids: [trashIds[w].restore] }], expect: EDIT },
  { route: "POST /trash/delete", send: (w) => ["POST", "/trash/delete", { ids: [trashIds[w].purge] }], expect: OWN },
  { route: "POST /trash/empty", send: () => ["POST", "/trash/empty", {}], expect: OWN },
  { route: "GET /shares", send: () => ["GET", "/shares?path=Shared%20note.md"], expect: READ },
  { route: "POST /shares", send: (w) => ["POST", "/shares", { path: `tasks-${w}.md`, link: true, role: "viewer" }], expect: EDIT },
  { route: "POST /shares/update", send: (w) => ["POST", "/shares/update", { id: shareIds[w].update, role: "editor" }], expect: EDIT },
  { route: "POST /shares/remove", send: (w) => ["POST", "/shares/remove", { id: shareIds[w].remove }], expect: EDIT },
  { route: "GET /shared/list", send: () => ["GET", "/shared/list"], expect: SHARED_READ },
  { route: "GET /shared/note", send: () => ["GET", `/shared/note?id=${sharedId}`], expect: SHARED_READ },
  { route: "PUT /shared/note", send: (w) => ["PUT", "/shared/note", { id: sharedId, content: `# Shared note\n\nEdited by ${w}\n` }], expect: SHARED_EDIT },
  { route: "GET /shared/resolve", send: () => ["GET", `/shared/resolve?target=Getting%20started&from=${sharedId}`], expect: SHARED_READ },
  { route: "GET /shared/file-resolve", send: () => ["GET", `/shared/file-resolve?target=margin.svg&from=${sharedId}`], expect: MEMBERS_ONLY },
  { route: "GET /shared/files/*", send: () => ["GET", "/shared/files/assets/margin.svg"], expect: MEMBERS_ONLY },
  { route: "GET /shared/live", send: () => ["GET", "/shared/live", undefined, liveHeaders()], expect: SHARED_READ },
  { route: "GET /api/shared", send: () => ["GET", "/api/shared"], expect: SIGNED_IN },
  { route: "GET /calendar/sources", send: () => ["GET", "/calendar/sources"], expect: READ },
  { route: "GET /calendar/events", send: () => ["GET", "/calendar/events?from=2026-10-01&to=2026-10-08"], expect: READ },
  { route: "GET /calendar/event", send: () => ["GET", `/calendar/event?id=${eventId}`], expect: READ },
  { route: "POST /calendar/refresh", send: () => ["POST", "/calendar/refresh", {}], expect: READ },
  { route: "POST /calendar/sources", send: (w) => ["POST", "/calendar/sources", { url: DEMO(`new-${w}`) }], expect: EDIT },
  { route: "POST /calendar/sources/update", send: (w) => ["POST", "/calendar/sources/update", { id: calendarIds[w].rename, name: `Renamed by ${w}` }], expect: EDIT },
  { route: "POST /calendar/sources/remove", send: (w) => ["POST", "/calendar/sources/remove", { id: calendarIds[w].remove }], expect: EDIT },
  { route: "POST /calendar/meeting-note", send: () => ["POST", "/calendar/meeting-note", { id: eventId, timeZone: "UTC" }], expect: EDIT },
  // The workspace's own calendar is editors'; a viewer's own Google calendars would be theirs (test/cloud-google.test.ts).
  { route: "POST /calendar/events", send: (w) => ["POST", "/calendar/events", EVENT(`Made by ${w}`)], expect: EDIT },
  { route: "POST /calendar/events/update", send: (w) => ["POST", "/calendar/events/update", { id: ownEvents[w].move, start: "2026-10-07T15:00:00Z", end: "2026-10-07T16:00:00Z" }], expect: EDIT },
  { route: "POST /calendar/events/delete", send: (w) => ["POST", "/calendar/events/delete", { id: ownEvents[w].remove }], expect: EDIT },
  // Anyone may add their own Google calendar; with no Google connection, it's refused as a bad request.
  { route: "POST /calendar/google", send: () => ["POST", "/calendar/google", { calendar: "primary" }], expect: [401, 404, 400, 400, 400] },
  { route: "POST /upload", send: (w) => ["POST", `/upload?name=up-${w}.txt`, new TextEncoder().encode("hi"), { "content-type": "text/plain" }], expect: EDIT },
  { route: "POST /invites", send: () => ["POST", "/invites", { role: "viewer" }], expect: OWN },
  { route: "GET /members", send: () => ["GET", "/members"], expect: READ },
  { route: "GET /invites", send: () => ["GET", "/invites"], expect: OWN },
  { route: "POST /invites/revoke", send: () => ["POST", "/invites/revoke", { id: spareInvite }], expect: OWN },
  { route: "GET /workspace/log", send: () => ["GET", "/workspace/log"], expect: OWN },
  { route: "POST /workspace/rename", send: () => ["POST", "/workspace/rename", { name: "Team" }], expect: OWN },
  { route: "POST /members/role", send: () => ["POST", "/members/role", { user: spareId, role: "viewer" }], expect: OWN },
  { route: "POST /members/remove", send: () => ["POST", "/members/remove", { user: spareId }], expect: OWN },
  // A wrong name deletes nothing: the owner gets past the role check to the 400.
  { route: "POST /workspace/delete", send: () => ["POST", "/workspace/delete", { confirm: "not the name" }], expect: [401, 404, 403, 403, 400] },
  // Leaving the second team keeps everyone in this one. Its only owner can't leave (409).
  { route: "POST /leave", send: () => ["POST", `${leaveBase}/leave`, {}], expect: [401, 404, "ok", "ok", 409] },
  { route: "GET /api/me", send: () => ["GET", "/api/me"], expect: SIGNED_IN },
  { route: "POST /api/me/time-zone", send: () => ["POST", "/api/me/time-zone", { timeZone: "America/Chicago" }], expect: SIGNED_IN },
  { route: "POST /api/workspaces", send: (w) => ["POST", "/api/workspaces", { name: `${w}'s team` }], expect: SIGNED_IN },
  { route: "GET /api/unfurl", send: () => ["GET", "/api/unfurl?url=https://example.invalid/"], expect: SIGNED_IN },
  { route: "GET /api/note-ids/*", send: () => ["GET", `/api/note-ids/${startId}`], expect: READ },
  { route: "GET /api/agents", send: () => ["GET", "/api/agents"], expect: SIGNED_IN },
  { route: "POST /api/agents/revoke", send: () => ["POST", "/api/agents/revoke", { id: "not-a-grant" }], expect: SIGNED_IN },
  { route: "GET /api/google", send: () => ["GET", "/api/google"], expect: SIGNED_IN },
  // No one here connected Google.
  { route: "GET /api/google/calendars", send: () => ["GET", "/api/google/calendars"], expect: [401, 409, 409, 409, 409] },
  { route: "POST /api/google/disconnect", send: () => ["POST", "/api/google/disconnect", {}], expect: SIGNED_IN },
  // Last: it ends everyone's sessions.
  { route: "POST /api/sign-out-everywhere", send: () => ["POST", "/api/sign-out-everywhere", {}], expect: SIGNED_IN },
];

const liveHeaders = () => ({ origin: cloud.origin, upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" });

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
  const { owner, base } = people;
  for (const w of WHO) {
    const note = (p: string, content = "# Note\n") => cloud.call(owner, "POST", `${base}/note`, { path: p, content });
    await note(`tasks-${w}.md`, "- [ ] Do it\n");
    await note(`update-${w}.md`, "- [ ] Change me\n");
    await note(`task-move-${w}.md`, "- [ ] Move me\n");
    await note(`task-rm-${w}.md`, "- [ ] Remove me\n");
    await note(`tag-${w}.md`, `# Tagged\n\n#old-${w}\n`);
    await note(`move-${w}.md`);
    await note(`arch-${w}.md`);
    await note(`unarch-${w}.md`);
    await cloud.call(owner, "POST", `${base}/archive`, { paths: [`unarch-${w}.md`] });
    await note(`restore-${w}.md`);
    await cloud.call(owner, "PUT", `${base}/note`, { path: `restore-${w}.md`, content: "# Changed\n" });
    restoreIds[w] = (await cloud.call(owner, "GET", `${base}/changes?path=restore-${w}.md&limit=1`))[0].id;
    await note(`del-${w}.md`);
    if (w === "signedOut") await note("Templates/Access template.md", "# {{title}}\n");
    await note(`folder-${w}/Inside.md`);
    await note(`trash-restore-${w}.md`);
    await note(`trash-purge-${w}.md`);
    const [restore, purge] = (await cloud.call(owner, "POST", `${base}/delete`, { paths: [`trash-restore-${w}.md`, `trash-purge-${w}.md`] })).trashed.map((t: { id: string }) => t.id);
    trashIds[w] = { restore, purge };
    const subscribe = async (name: string) => (await cloud.call(owner, "POST", `${base}/calendar/sources`, { url: DEMO(`${name}-${w}`) })).id;
    calendarIds[w] = { rename: await subscribe("rename"), remove: await subscribe("remove") };
    const make = async (what: string) => (await cloud.call(owner, "POST", `${base}/calendar/events`, EVENT(`${what} ${w}`))).event.id;
    ownEvents[w] = { move: await make("Move"), remove: await make("Remove") };
  }
  eventId = (await cloud.call(owner, "GET", `${base}/calendar/events?from=2026-10-01&to=2026-10-08`))[0].id;
  for (const w of ["viewer", "editor", "owner"] as const) {
    folderIds[w] = (await cloud.call(people[w], "POST", `${base}/smart-folders`, { name: `Doomed ${w}`, query: "tag=plan" })).id;
  }
  for (const w of ["sharedViewer", "sharedEditor"] as const) outside[w] = await cloud.signIn(w.toLowerCase());
  sharedId = (await cloud.call(owner, "POST", `${base}/note`, { path: "Shared note.md", content: "# Shared note\n" })).id ?? "";
  await cloud.call(owner, "POST", `${base}/shares`, { path: "Shared note.md", email: "sharedviewer@localhost", role: "viewer" });
  await cloud.call(owner, "POST", `${base}/shares`, { path: "Shared note.md", email: "sharededitor@localhost", role: "editor" });
  for (const w of WHO) {
    await cloud.call(owner, "POST", `${base}/note`, { path: `share-${w}.md`, content: "# Share\n" });
    const made = async (email: string) => (await cloud.call(owner, "POST", `${base}/shares`, { path: `share-${w}.md`, email, role: "viewer" })).shares.find((s: { email: string }) => s.email === email).id;
    shareIds[w] = { update: await made(`update-${w.toLowerCase()}@example.com`), remove: await made(`remove-${w.toLowerCase()}@example.com`) };
  }
  const spare = await cloud.signIn("spare");
  const { url } = await cloud.call(owner, "POST", `${base}/invites`, { role: "editor" });
  await cloud.request(spare, "POST", new URL(url).pathname);
  spareId = (await cloud.call(owner, "GET", `${base}/members`)).find((m: { name: string }) => m.name === "Spare Dev").id;
  await cloud.call(owner, "POST", `${base}/invites`, { role: "viewer" });
  spareInvite = (await cloud.call(owner, "GET", `${base}/invites`)).find((i: { usedAt: number | null }) => i.usedAt === null).id;
  leaveBase = `/api/w/${(await cloud.call(owner, "POST", "/api/workspaces", { name: "Leavers" })).id}`;
  for (const w of ["editor", "viewer"] as const) {
    const invite = await cloud.call(owner, "POST", `${leaveBase}/invites`, { role: w });
    await cloud.request(people[w], "POST", new URL(invite.url).pathname);
  }
  const notes: Array<{ path: string; id: string }> = await cloud.call(owner, "GET", `${base}/notes`);
  sharedId = notes.find((n) => n.path === "Shared note.md")!.id;
  startId = notes.find((n) => n.path === "Getting started.md")!.id;
  // Note IDs reach the directory just after the request that made them.
  for (let i = 0; i < 50 && (await cloud.request(owner, "GET", `/api/note-ids/${startId}`)).status !== 200; i++) await new Promise((r) => setTimeout(r, 50));
});

after(() => cloud.close());

test("every route online has a row in the access matrix, and every API route has a role", () => {
  assert.deepEqual(MATRIX.map((r) => r.route).sort(), [...Object.keys(WORKSPACE_ROUTES), ...ACCOUNT_ROUTES, ...SHARED_ROUTES].sort());
  const workspace = fs.readFileSync(path.resolve(import.meta.dirname, "../cloud/src/workspace.ts"), "utf8");
  const shareRoutes = [...workspace.matchAll(/case "((?:GET|POST) \/shares[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(shareRoutes.filter((r) => !(r in WORKSPACE_ROUTES)), [], "share routes with no role in cloud/src/access.ts");
  const api = fs.readFileSync(path.resolve(import.meta.dirname, "../src/core/api.ts"), "utf8");
  const coreRoutes = [...api.matchAll(/case "((?:GET|POST|PUT|PATCH|DELETE) \/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(coreRoutes.filter((r) => !(r in WORKSPACE_ROUTES)), [], "core API routes with no role in cloud/src/access.ts");
  assert.deepEqual(Object.entries(TOOL_ROUTES).filter(([, r]) => !(r in WORKSPACE_ROUTES)), [], "MCP tools whose route has no role");
  const admin = fs.readFileSync(path.resolve(import.meta.dirname, "../cloud/src/admin.ts"), "utf8");
  const settings = [...admin.matchAll(/case "((?:GET|POST) \/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(settings.filter((r) => !(r in WORKSPACE_ROUTES)), [], "settings routes with no role in cloud/src/access.ts");
});

test("each route answers each kind of person as the matrix says", async () => {
  const cookie = (w: Who) => (w === "signedOut" ? null : w === "sharedViewer" || w === "sharedEditor" ? outside[w] : people[w]);
  const actual: Record<string, Expect[]> = {};
  const expected: Record<string, Expect[]> = {};
  for (const row of MATRIX) {
    expected[row.route] = wide(row.expect);
    actual[row.route] = [];
    for (const [i, w] of WHO.entries()) {
      const [method, p, body, headers] = row.send(w);
      const res = await cloud.request(cookie(w), method, p.startsWith("/api/") ? p : `${people.base}${p}`, body, headers);
      await res.body?.cancel();
      actual[row.route].push(expected[row.route][i] === "ok" && res.status < 400 ? "ok" : res.status);
    }
  }
  const off = Object.keys(expected).filter((r) => JSON.stringify(actual[r]) !== JSON.stringify(expected[r]));
  assert.deepEqual(actual, expected, off.map((r) => `${r}: ${JSON.stringify(actual[r])}`).join("; "));
});

test("online, a viewer keeps smart folders of their own but can't share one", async () => {
  const viewer = await cloud.signIn("viewer"); // the matrix ended with signing everyone out everywhere
  const shared = await cloud.request(viewer, "POST", `${people.base}/smart-folders`, { name: "For everyone", query: "tag=plan", shared: true });
  const own = await cloud.request(viewer, "POST", `${people.base}/smart-folders`, { name: "Just mine", query: "tag=plan" });
  assert.deepEqual([shared.status, own.status], [403, 200]);
});

test("a workspace checks the role again, whatever the Worker forwarded", async () => {
  const env = await cloud.server.getWorker().getEnv();
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(people.id));
  const send = async (method: string, route: string, role?: string) => {
    const headers: Record<string, string> = { "x-ci-workspace": people.id, "content-type": "application/json" };
    if (role) headers["x-ci-role"] = role;
    const res = await stub.fetch(`https://workspace${route}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify({ path: "forged.md", content: "x" }) });
    return res.status;
  };
  assert.deepEqual(
    [await send("POST", "/note", "viewer"), await send("POST", "/note"), await send("POST", "/note", "admin"), await send("POST", "/seed", "owner"), await send("GET", "/info", "viewer")],
    [403, 403, 403, 404, 200],
  );
});

type Trashed = { trashed: Array<{ id: string; path: string }> };

test("what's in Trash can't be reached as a file, a note or through another workspace", async () => {
  const owner = await cloud.signIn("owner"); // the matrix ended with signing everyone out everywhere
  const { base } = people;
  await cloud.request(owner, "POST", `${base}/note`, { path: "Secret.md", content: "# Secret\n\nthe plan\n" });
  const { trashed } = (await (await cloud.request(owner, "POST", `${base}/delete`, { paths: ["Secret.md"] })).json()) as Trashed;
  const id = trashed[0].id;
  const tries = [
    await cloud.request(owner, "GET", `${base}/note?path=Secret`),
    await cloud.request(owner, "GET", `${base}/files/.trash/${id}/Secret.md`),
    await cloud.request(owner, "GET", `${base}/files/%2Etrash/${id}/Secret.md`),
    await cloud.request(owner, "GET", `${base}/search?q=plan`),
  ];
  assert.deepEqual(tries.slice(0, 3).map((r) => r.status >= 400), [true, true, true]);
  assert.deepEqual(await tries[3].json(), []);
  // Another workspace of the same owner has its own Trash, and can't restore this one's items.
  const other = ((await (await cloud.request(owner, "POST", "/api/workspaces", { name: "Elsewhere" })).json()) as { id: string }).id;
  assert.equal((await cloud.request(owner, "POST", `/api/w/${other}/trash/restore`, { ids: [id] })).status, 404);
  const theirs = (await (await cloud.request(owner, "GET", `/api/w/${other}/trash`)).json()) as Array<{ id: string }>;
  assert.equal(theirs.some((t) => t.id === id), false);
});

test("an upload deleted for good takes its bytes out of R2; one in Trash keeps them", async () => {
  const owner = await cloud.signIn("owner");
  const { base } = people;
  const env = await cloud.server.getWorker().getEnv();
  const keys = async () => (await env.FILES.list()).objects.length;
  const up = (await (await cloud.request(owner, "POST", `${base}/upload?name=bin.txt`, new TextEncoder().encode("bytes"), { "content-type": "text/plain" })).json()) as { path: string };
  const before = await keys();
  const { trashed } = (await (await cloud.request(owner, "POST", `${base}/delete`, { paths: [up.path] })).json()) as Trashed;
  assert.equal(await keys(), before);
  await cloud.request(owner, "POST", `${base}/trash/delete`, { ids: [trashed[0].id] });
  await new Promise((r) => setTimeout(r, 50)); // the delete runs after the response
  assert.equal(await keys(), before - 1);
});
