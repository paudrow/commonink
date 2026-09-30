import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DEMO_FEED, feedsFor } from "../cloud/src/demo-calendar.ts";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const WEEK = "from=2026-10-05T00:00:00Z&to=2026-10-12T00:00:00Z";

test("a subscribed feed is the whole workspace's: everyone sees its events, only editors see its address", async () => {
  const { base, editor, viewer, stranger } = people;
  const made = await cloud.call(editor, "POST", `${base}/calendar/sources`, { url: DEMO_FEED });
  assert.deepEqual([made.name, made.status, made.url, made.createdBy], ["Launch team (demo)", "ok", DEMO_FEED, "Editor Dev"]);

  const seen = await cloud.call(viewer, "GET", `${base}/calendar/sources`);
  assert.deepEqual(seen.map((s: { name: string; url: string | null; host: string }) => [s.name, s.url, s.host]), [["Launch team (demo)", null, "demo.commonink.invalid"]]);
  const events: Array<{ title: string; start: string }> = await cloud.call(viewer, "GET", `${base}/calendar/events?${WEEK}`);
  assert.deepEqual(
    events.filter((e) => e.title === "Standup").map((e) => e.start),
    ["2026-10-05T16:30:00Z", "2026-10-06T16:30:00Z", "2026-10-07T16:30:00Z", "2026-10-08T16:30:00Z", "2026-10-09T16:30:00Z"],
  );
  assert.equal((await cloud.request(viewer, "POST", `${base}/calendar/sources`, { url: "https://demo.commonink.invalid/other.ics" })).status, 403);
  assert.equal((await cloud.request(stranger, "GET", `${base}/calendar/events?${WEEK}`)).status, 404);
  await cloud.call(editor, "POST", `${base}/calendar/sources/remove`, { id: made.id });
});

test("online, a feed on a private address is refused before anything is fetched, and isn't kept", async () => {
  let reached = 0;
  const inside = http.createServer((_req, res) => (reached++, res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")));
  await new Promise<void>((r) => inside.listen(0, "127.0.0.1", r));
  const port = (inside.address() as { port: number }).port;
  const { base, editor } = people;
  const answers = [];
  for (const url of [`http://127.0.0.1:${port}/cal.ics`, `http://localhost:${port}/cal.ics`, `webcal://[::1]:${port}/cal.ics`, "http://10.0.0.1/cal.ics", "http://printer.local/cal.ics"]) {
    const res = await cloud.request(editor, "POST", `${base}/calendar/sources`, { url });
    answers.push([res.status, (await res.json()).error]);
  }
  inside.close();
  assert.deepEqual(answers, Array(5).fill([400, "That address isn't on the public internet"]));
  assert.equal(reached, 0);
  assert.deepEqual(await cloud.call(editor, "GET", `${base}/calendar/sources`), []);
});

test("a meeting note is made once per event, attributed to whoever made it, and the event links to it", async () => {
  const { base, editor, owner } = people;
  const cal = await cloud.call(owner, "POST", `${base}/calendar/sources`, { url: DEMO_FEED });
  const [standup] = await cloud.call(editor, "GET", `${base}/calendar/events?${WEEK}&q=standup`);
  const made = await cloud.call(editor, "POST", `${base}/calendar/meeting-note`, { id: standup.id, timeZone: "America/Los_Angeles" });
  assert.deepEqual(made, { path: "Meetings/2026-10-05 Standup.md", created: true });
  const note = await cloud.call(editor, "GET", `${base}/note?path=${encodeURIComponent(made.path)}`);
  assert.match(note.content, /\*\*When:\*\* Mon, Oct 5, 2026, 9:30 AM to 9:45 AM PDT/);
  assert.match(note.content, new RegExp(`\\*\\*Event:\\*\\* \\[Standup\\]\\(/calendar/${standup.id}\\)`));
  const [change] = await cloud.call(owner, "GET", `${base}/changes?path=${encodeURIComponent(made.path)}`);
  assert.equal(change.person, "Editor Dev");
  assert.deepEqual(await cloud.call(owner, "POST", `${base}/calendar/meeting-note`, { id: standup.id }), { path: made.path, created: false });
  assert.deepEqual((await cloud.call(owner, "GET", `${base}/calendar/event?id=${standup.id}`)).note, { id: note.id, path: made.path, title: "Standup" });
  await cloud.call(owner, "POST", `${base}/calendar/sources/remove`, { id: cal.id });
});

test("the demo feed is only on Previews: elsewhere its address goes through the public-host rules like any other", async () => {
  const blocked = (u: URL) => {
    throw new Error(`blocked ${u.hostname}`);
  };
  const production = await feedsFor({}, blocked)(DEMO_FEED, { etag: null, modified: null }).catch((e: Error) => e.message);
  const preview = await feedsFor({ DEV_LOGIN: "1" }, blocked)(DEMO_FEED, { etag: null, modified: null });
  assert.equal(production, "blocked demo.commonink.invalid");
  assert.equal(preview.status === "ok" && preview.text.startsWith("BEGIN:VCALENDAR\r\n"), true);
});
