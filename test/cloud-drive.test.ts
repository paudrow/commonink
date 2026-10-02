import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

// Save to Google Drive (#47) through the Worker. The test Worker has developer sign-in and no Google
// OAuth client, so Drive is the stand-in (cloud/src/google-mock.ts): the same connection and route.
let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const bytes = (s: string) => new TextEncoder().encode(s);

/** Allow Google, the way a browser does: start, the stand-in's consent page, Allow, and back. Returns where it lands, and the consent page. */
async function connect(cookie: string, start: string) {
  const res = await cloud.request(cookie, "GET", start);
  const pending = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gcal="))!;
  const consent = new URL(res.headers.get("location")!);
  const both = `${cookie}; ${pending}`;
  const page = await (await cloud.request(both, "GET", consent.pathname + consent.search)).text();
  const allowed = await cloud.server.fetch(new URL(consent.pathname + consent.search, cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: both, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  const callback = new URL(allowed.headers.get("location")!);
  const done = await cloud.request(both, "GET", callback.pathname + callback.search);
  return { back: new URL(done.headers.get("location")!), page };
}

const save = (cookie: string | null, query: string, body: Uint8Array, type = DOCX) => cloud.request(cookie, "POST", `/api/google/drive?${query}`, body, { "content-type": type });

test("saving asks for Drive the first time, comes back to the note, and doesn't count as connecting Calendar", async () => {
  const { editor } = people;
  const refused = await save(editor, "as=doc&title=Plan", bytes("PK fake docx"));
  assert.deepEqual([refused.status, await refused.json()], [409, { error: "Allow Common Ink to save to your Google Drive first", connect: true }]);

  const { back, page } = await connect(editor, "/auth/google/drive?next=%2Fnotes%2Fplan-abcd2345&as=pdf");
  assert.match(page, /only the specific Google Drive files that you use with this app/);
  assert.deepEqual([back.origin, back.pathname, back.searchParams.get("drive"), back.searchParams.get("as")], [cloud.origin, "/notes/plan-abcd2345", "connected", "pdf"]);
  const info = (await cloud.call(editor, "GET", "/api/google")).connection;
  assert.deepEqual([info.drive, info.calendar, info.canWrite], [true, false, false]);
  assert.equal((await cloud.request(editor, "GET", "/api/google/calendars")).status, 409, "Calendar still needs connecting");

  // Connecting Calendar afterwards keeps Drive (Google adds scopes to the grant; so does the stand-in).
  await connect(editor, `/auth/google/calendar?w=${people.id}`);
  const both = (await cloud.call(editor, "GET", "/api/google")).connection;
  assert.deepEqual([both.drive, both.calendar], [true, true]);
});

test("a note goes to Drive as a Google Doc, a PDF or its markdown file; Open in Drive shows what was saved", async () => {
  const { editor } = people;
  const doc = await save(editor, `as=doc&title=${encodeURIComponent("Q3 / plan")}`, bytes("PK fake docx"));
  assert.equal(doc.status, 200);
  const file = (await doc.json()) as { id: string; name: string; url: string };
  assert.equal(file.name, "Q3 plan", "no slashes in a file name");
  const open = new URL(file.url);
  assert.deepEqual([open.origin, open.pathname, open.searchParams.get("as")], [cloud.origin, "/auth/google/drive/mock/file", "Google Doc"]);
  assert.match(await (await cloud.request(editor, "GET", open.pathname + open.search)).text(), /<b>Q3 plan<\/b> would be in the <b>Common Ink<\/b> folder/);

  const pdf = (await (await save(editor, "as=pdf&title=Plan", bytes("PK fake docx"))).json()) as { name: string; url: string };
  assert.deepEqual([pdf.name, new URL(pdf.url).searchParams.get("as")], ["Plan.pdf", "PDF"]);
  const md = (await (await save(editor, "as=md&title=Plan", bytes("# Plan\n"), "text/markdown;charset=utf-8")).json()) as { name: string };
  assert.equal(md.name, "Plan.md");
});

test("what the route refuses: a markdown file from Word, other types, nothing, a bad format, and anyone not signed in", async () => {
  const { editor, owner } = people;
  const cases: Array<[{ status: number; json(): Promise<unknown> }, number, RegExp]> = [
    [await save(editor, "as=md&title=Plan", bytes("PK")), 400, /needs the note's markdown/],
    [await save(editor, "as=doc&title=Plan", bytes("<p>hi</p>"), "text/html"), 415, /Word \(\.docx\) or markdown/],
    [await save(editor, "as=doc&title=Plan", new Uint8Array()), 400, /empty/],
    [await save(editor, "as=docx&title=Plan", bytes("PK")), 400, /"as" must be one of doc, pdf, md/],
    // Someone who never connected Drive.
    [await save(owner, "as=doc&title=Plan", bytes("PK")), 409, /Allow Common Ink to save to your Google Drive first/],
    [await save(null, "as=doc&title=Plan", bytes("PK")), 401, /Sign in first/],
  ];
  for (const [res, status, error] of cases) {
    assert.equal(res.status, status);
    assert.match(((await res.json()) as { error: string }).error, error);
  }
  // Another site can't make the browser save to someone's Drive.
  const forged = await cloud.server.fetch(new URL("/api/google/drive?as=doc&title=x", cloud.origin), { method: "POST", headers: { cookie: editor, origin: "https://evil.example", "content-type": DOCX }, body: bytes("PK") });
  assert.equal(forged.status, 403);
});

test("connecting for Drive comes back only to a page of this app", async () => {
  for (const next of ["//evil.example/x", "/\\evil.example", "/\t/evil.example", "https://evil.example/"]) {
    const { back } = await connect(people.viewer, `/auth/google/drive?next=${encodeURIComponent(next)}&as=doc`);
    assert.deepEqual([back.origin, back.pathname], [cloud.origin, "/"], next);
  }
});
