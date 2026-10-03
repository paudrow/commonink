import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

// Google Contacts on the test Worker: no Google OAuth client, so the stand-in (MockPeople in
// cloud/src/google-people.ts) plays Google, through the same connection and sync code.
let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

/** Connect the way a browser does: start (for contacts), the stand-in's consent page, Allow, and back. */
async function connect(cookie: string, write = false) {
  const start = await cloud.request(cookie, "GET", `/auth/google/calendar?for=contacts&w=${people.id}${write ? "&write=1" : ""}`);
  const pending = start.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gcal="))!;
  const consent = new URL(start.headers.get("location")!);
  const both = `${cookie}; ${pending}`;
  const page = await (await cloud.request(both, "GET", consent.pathname + consent.search)).text();
  assert.match(page, write ? /see your contacts<\/b> and <b>edit them/ : /see your contacts<\/b>\./);
  const allowed = await cloud.server.fetch(new URL(consent.pathname + consent.search, cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: both, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  const callback = new URL(allowed.headers.get("location")!);
  const done = await cloud.request(both, "GET", callback.pathname + callback.search);
  return new URL(done.headers.get("location")!);
}

/** Change a contact in the stand-in's address book, as if in Google. */
const editInGoogle = (cookie: string, fields: Record<string, string>) =>
  cloud.server.fetch(new URL("/auth/google/contacts/mock", cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

test("connecting Google Contacts comes back to Contacts, and a sync makes the contacts notes", async () => {
  const { base, editor, viewer } = people;
  assert.deepEqual((await cloud.call(editor, "GET", `${base}/contacts/google`)).connection, null);
  await assert.rejects(cloud.call(editor, "POST", `${base}/contacts/google/sync`, {}), /isn't connected/);

  const back = await connect(editor);
  assert.deepEqual([back.pathname, back.searchParams.get("google")], ["/contacts", "connected"]);
  const info = await cloud.call(editor, "GET", "/api/google");
  assert.deepEqual([info.connection.contacts, info.connection.canWrite], ["read", false]);

  // Priya is already here: she's linked, not made twice.
  await cloud.call(editor, "POST", `${base}/contacts`, { name: "Priya Shah", email: ["priya@initech.example"], tags: ["client"] });
  const r = await cloud.call(editor, "POST", `${base}/contacts/google/sync`, {});
  assert.deepEqual(r.created.sort(), ["People/Jane Doe.md", "People/Lena Fischer.md", "People/Marcus Webb.md", "People/Sofia Rossi.md"]);
  assert.deepEqual(r.linked, ["People/Priya Shah.md"]);
  const priya = await cloud.call(editor, "GET", `${base}/note?path=People/Priya%20Shah.md`);
  assert.match(priya.content, /google: people\/c1002/);
  assert.match(priya.content, /tags: \[client\]/);
  assert.match(priya.content, /priya\.shah@gmail\.example/);

  // A viewer may see the status, not sync into the workspace.
  assert.equal((await cloud.request(viewer, "POST", `${base}/contacts/google/sync`, {})).status, 403);
  const status = await cloud.call(editor, "GET", `${base}/contacts/google`);
  assert.deepEqual([status.linked, status.connection.canWrite], [5, false]);
});

test("a change in Google comes in; edits here go back once editing is allowed; calendar access is kept", async () => {
  const { base, editor } = people;
  assert.equal((await editInGoogle(editor, { resource: "people/c1003", name: "Lena Fischer", email: "lena@globex.example", phone: "+49 30 555 0123", company: "Globex", role: "COO" })).status, 302);
  let r = await cloud.call(editor, "POST", `${base}/contacts/google/sync`, {});
  assert.deepEqual(r.updated, ["People/Lena Fischer.md"]);
  assert.match((await cloud.call(editor, "GET", `${base}/note?path=People/Lena%20Fischer.md`)).content, /role: COO/);

  await cloud.call(editor, "POST", `${base}/contacts/update`, { path: "People/Lena Fischer.md", patch: { phone: ["+49 30 555 0123", "+49 170 555 0000"] } });
  r = await cloud.call(editor, "POST", `${base}/contacts/google/sync`, {});
  assert.deepEqual([r.kept, r.pushed], [["People/Lena Fischer.md"], []]);

  // Asking again, to edit too: what was granted before stays.
  const back = await connect(editor, true);
  assert.equal(back.searchParams.get("google"), "connected");
  assert.equal((await cloud.call(editor, "GET", "/api/google")).connection.contacts, "write");
  r = await cloud.call(editor, "POST", `${base}/contacts/google/sync`, {});
  assert.deepEqual(r.pushed, ["People/Lena Fischer.md"]);
  const book = await (await cloud.request(editor, "GET", "/auth/google/contacts/mock")).text();
  assert.match(book, /\+49 170 555 0000/);
});

