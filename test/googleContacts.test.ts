import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempVault } from "./helpers.ts";
import { GoogleContactsSync, linkOf, mergeSynced, PeopleError, withLink, withSynced, type GooglePerson, type PeopleApi } from "../src/core/googleContacts.ts";

/** A Google that keeps its contacts in a map, with versions for sync tokens and etags, as the real one behaves. */
class FakeGoogle implements PeopleApi {
  people = new Map<string, { p: GooglePerson; v: number; deleted?: boolean }>();
  version = 0;
  updates: GooglePerson[] = [];
  add(p: GooglePerson) {
    this.people.set(p.resourceName, { p, v: ++this.version });
  }
  edit(resource: string, fields: Partial<GooglePerson> | null) {
    const had = this.people.get(resource)!;
    this.people.set(resource, fields ? { p: { ...had.p, ...fields }, v: ++this.version } : { ...had, v: ++this.version, deleted: true });
  }
  private out = (r: { p: GooglePerson; v: number; deleted?: boolean }) => ({ ...r.p, etag: `e${r.v}`, ...(r.deleted ? { metadata: { deleted: true } } : {}) });
  async changes(token: string | null) {
    const since = token ? Number(token) : null;
    const people = [...this.people.values()].filter((r) => (since === null ? !r.deleted : r.v > since)).map(this.out);
    return { people, syncToken: String(this.version), full: since === null };
  }
  async update(person: GooglePerson, fields: string) {
    const had = this.people.get(person.resourceName)!;
    if (person.etag !== `e${had.v}`) throw new PeopleError("etag differs", 400);
    this.updates.push(person);
    const patch = Object.fromEntries(fields.split(",").map((f) => [f, (person as never)[f]]));
    this.edit(person.resourceName, patch);
    return this.out(this.people.get(person.resourceName)!);
  }
}

function setup(files: Record<string, string> = {}, canWrite = false) {
  const { vault } = openTempVault(files);
  const google = new FakeGoogle();
  const conn = { account: "me@gmail.example", canWrite };
  const sync = new GoogleContactsSync(vault.db, vault, "u1", async () => conn, () => google);
  const read = (p: string) => vault.files.read(p)!;
  return { vault, google, sync, conn, read };
}

const JANE: GooglePerson = {
  resourceName: "people/c1",
  names: [{ displayName: "Jane Doe" }],
  emailAddresses: [{ value: "jane@acme.example", type: "work" }],
  phoneNumbers: [{ value: "+1 555 0100", type: "mobile" }],
  organizations: [{ name: "Acme", title: "CTO", department: "Eng" }],
  biographies: [{ value: "Met at the offsite." }],
};

test("a new Google contact becomes a note in People/, linked, with Google's notes about them once", async () => {
  const { google, sync, read } = setup();
  google.add(JANE);
  const r = await sync.sync("Google Contacts");
  assert.deepEqual(r.created, ["People/Jane Doe.md"]);
  const md = read("People/Jane Doe.md");
  assert.equal(linkOf(md), "people/c1");
  assert.match(md, /email: jane@acme\.example/);
  assert.match(md, /company: Acme/);
  assert.match(md, /# Jane Doe\n\nMet at the offsite\./);
  // Nothing changed: nothing happens.
  const again = await sync.sync("Google Contacts");
  assert.deepEqual([again.created, again.updated, again.full], [[], [], false]);
});

test("someone already here with the same email is linked, and their words and tags stay", async () => {
  const { google, sync, read } = setup({ "People/Jane Doe.md": "---\nemail: jane@acme.example\ntags: [client]\nrole: Chief\n---\n# Jane Doe\n\nLikes long walks.\n" });
  google.add(JANE);
  const r = await sync.sync("Google Contacts");
  assert.deepEqual([r.created, r.linked], [[], ["People/Jane Doe.md"]]);
  // Both had a role, differently: Google is the truth (the old one is in History).
  assert.deepEqual(r.conflicts, [{ field: "role", note: "Chief", google: "CTO", path: "People/Jane Doe.md" }]);
  const md = read("People/Jane Doe.md");
  assert.match(md, /role: CTO/);
  assert.match(md, /tags: \[client\]/);
  assert.match(md, /phone: \+1 555 0100/);
  assert.match(md, /Likes long walks\./);
  assert.equal(linkOf(md), "people/c1");
});

test("Google's changes reach the note; edits here stay here until editing is allowed, then go to Google", async () => {
  const { vault, google, sync, conn, read } = setup();
  google.add(JANE);
  await sync.sync("s");
  // In Google: a new phone and a new title.
  google.edit("people/c1", { phoneNumbers: [...JANE.phoneNumbers!, { value: "+1 555 0142" }], organizations: [{ name: "Acme", title: "CEO" }] });
  // Here: another email.
  vault.updateContact("People/Jane Doe.md", { email: ["jane@acme.example", "jane@home.example"] }, "you");
  let r = await sync.sync("s");
  assert.deepEqual([r.updated, r.kept, r.pushed], [["People/Jane Doe.md"], ["People/Jane Doe.md"], []]);
  let md = read("People/Jane Doe.md");
  assert.match(md, /phone: \["\+1 555 0100", "\+1 555 0142"\]|phone: \[\+1 555 0100, \+1 555 0142\]/);
  assert.match(md, /role: CEO/);
  assert.match(md, /jane@home\.example/); // kept, not lost
  assert.equal(google.updates.length, 0);

  conn.canWrite = true;
  r = await sync.sync("s");
  assert.deepEqual(r.pushed, ["People/Jane Doe.md"]);
  const sent = google.updates[0];
  assert.deepEqual(sent.emailAddresses, [{ value: "jane@acme.example", type: "work" }, { value: "jane@home.example" }]); // its type kept
  assert.equal(sent.organizations![0].title, "CEO");
  // Once agreed, nothing more to send.
  r = await sync.sync("s");
  assert.deepEqual([r.pushed, r.kept, r.updated], [[], [], []]);
  md = read("People/Jane Doe.md");
  assert.match(md, /jane@home\.example/);
});

test("removing an email here removes it in Google; a contact deleted in Google keeps its note, unlinked", async () => {
  const { vault, google, sync, read } = setup({}, true);
  google.add({ ...JANE, emailAddresses: [{ value: "jane@acme.example" }, { value: "old@acme.example" }] });
  await sync.sync("s");
  vault.updateContact("People/Jane Doe.md", { email: ["jane@acme.example"] }, "you");
  await sync.sync("s");
  assert.deepEqual(google.updates.at(-1)!.emailAddresses, [{ value: "jane@acme.example" }]);

  google.edit("people/c1", null);
  const r = await sync.sync("s");
  assert.deepEqual(r.unlinked, ["People/Jane Doe.md"]);
  const md = read("People/Jane Doe.md");
  assert.equal(linkOf(md), null);
  assert.match(md, /email: jane@acme\.example/);
});

test("a push Google refuses (changed there since) stays here and merges on the next sync", async () => {
  const { vault, google, sync } = setup({}, true);
  google.add(JANE);
  await sync.sync("s");
  vault.updateContact("People/Jane Doe.md", { company: "Acme Corp" }, "you");
  const real = google.update.bind(google);
  google.update = async () => {
    throw new PeopleError("etag differs", 400);
  };
  const r = await sync.sync("s");
  assert.deepEqual([r.pushed, r.kept], [[], ["People/Jane Doe.md"]]);
  google.update = real;
  assert.deepEqual((await sync.sync("s")).pushed, ["People/Jane Doe.md"]);
  assert.equal([...google.people.values()][0].p.organizations![0].name, "Acme Corp");
});

test("an expired sync token starts again from everything", async () => {
  const { google, sync } = setup();
  google.add(JANE);
  await sync.sync("s");
  const changes = google.changes.bind(google);
  let first = true;
  google.changes = async (t) => {
    if (t && first) {
      first = false;
      throw new PeopleError("Sync token is expired", 410);
    }
    return changes(t);
  };
  const r = await sync.sync("s");
  assert.equal(r.full, true);
  assert.deepEqual(r.created, []);
});

test("not connected says so; status counts what's linked", async () => {
  const { vault } = openTempVault();
  const off = new GoogleContactsSync(vault.db, vault, "u1", async () => null, () => new FakeGoogle());
  await assert.rejects(off.sync("s"), /isn't connected/);
  const { google, sync } = setup();
  google.add(JANE);
  await sync.sync("s");
  const s = await sync.status();
  assert.deepEqual([s.linked, !!s.lastSync, s.connection?.account], [1, true, "me@gmail.example"]);
});

test("lists merge item by item; scalars take the side that changed", () => {
  const base = { email: ["a@x"], phone: [], company: "Acme", role: "CTO", links: [], aliases: [] };
  const note = { ...base, email: ["a@x", "b@x"], role: "Chief" };
  const google = { ...base, email: ["a@x", "c@x"], company: "Acme Inc" };
  assert.deepEqual(mergeSynced(base, note, google), { merged: { ...base, email: ["a@x", "c@x", "b@x"], company: "Acme Inc", role: "Chief" }, conflicts: [] });
  assert.deepEqual(mergeSynced(base, { ...base, role: "A" }, { ...base, role: "B" }).conflicts, [{ field: "role", note: "A", google: "B" }]);
});

test("the link line and a push leave everything else as it was", () => {
  const md = "---\nemail: a@x\nfoo: bar\n---\n# A\n";
  assert.equal(withLink(withLink(md, "people/c9"), null), md);
  const p = withSynced(JANE, { email: ["jane@acme.example"], phone: [], company: "Acme", role: "CEO", links: [], aliases: [] });
  assert.deepEqual(p.organizations, [{ name: "Acme", title: "CEO", department: "Eng" }]);
  assert.deepEqual(p.names, JANE.names);
});
