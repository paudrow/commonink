// Contacts: a contact is a note in People/ whose frontmatter holds how to reach them. The core
// lists them (with when they were last mentioned), shows one's timeline, creates, edits, merges
// duplicates (links follow) and imports vCard and CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFromNote, contactNote, duplicateContacts, handlesOf, parseContactsCsv, parseVCards, type Contact } from "../src/core/contacts.ts";
import { openTempVault } from "./helpers.ts";

const JANE = `---
email: jane@acme.com
phone: [+1 555 0100, +1 555 0199]
company: Acme
role: CTO
links:
  - https://github.com/jane
  - https://jane.dev
aliases: [JD]
tags: [client, acme/board]
birthday: 1990-04-01
---
# Jane Doe

Met at the Acme offsite.
`;

test("a contact is read from its note's frontmatter: single values and lists, inline or one per line", () => {
  const c = contactFromNote("People/Jane Doe.md", JANE);
  assert.deepEqual(
    { name: c.name, email: c.email, phone: c.phone, company: c.company, role: c.role, links: c.links, aliases: c.aliases, tags: c.tags },
    { name: "Jane Doe", email: ["jane@acme.com"], phone: ["+1 555 0100", "+1 555 0199"], company: "Acme", role: "CTO", links: ["https://github.com/jane", "https://jane.dev"], aliases: ["JD"], tags: ["client", "acme/board"] },
  );
  // A bare note in People/ is a contact too, named by its title.
  assert.deepEqual(contactFromNote("People/Sam.md", "# Sam Lee\n").name, "Sam Lee");
  assert.deepEqual(contactFromNote("People/Sam.md", "").name, "Sam");
});

test("writing a contact keeps the note's words and any frontmatter it doesn't know", () => {
  const c = contactFromNote("People/Jane Doe.md", JANE);
  const out = contactNote({ ...c, role: "CEO", email: ["jane@acme.com", "jd@home.org"], tags: [] }, JANE);
  assert.match(out, /^---\nemail: \[jane@acme.com, jd@home.org\]\nphone: \[\+1 555 0100, \+1 555 0199\]\ncompany: Acme\nrole: CEO\nlinks:\n  - https:\/\/github.com\/jane\n  - https:\/\/jane.dev\naliases: \[JD\]\nbirthday: 1990-04-01\n---\n# Jane Doe\n\nMet at the Acme offsite.\n$/);
  // A new contact: its fields, then its name as the title.
  assert.equal(contactNote({ name: "Sam Lee", email: ["sam@x.org"], phone: [], company: "", role: "", links: [], aliases: [], tags: [] }), "---\nemail: sam@x.org\n---\n# Sam Lee\n");
  assert.equal(contactNote({ name: "Nobody", email: [], phone: [], company: "", role: "", links: [], aliases: [], tags: [] }), "# Nobody\n");
  // A value that YAML would misread is quoted.
  assert.match(contactNote({ name: "Q", email: [], phone: [], company: "Smith, Jones & Co: Law", role: "", links: [], aliases: [], tags: [] }), /company: "Smith, Jones & Co: Law"/);
});

test("writing a contact keeps a comment before the first key and keys with spaces or accents", () => {
  const md = "---\n# my comment\nemail: a@b.com\nDate Created: 2024-01-01\ntítulo: x\nnotes: x\n---\n# Jane\nbody\n";
  const c = contactFromNote("People/Jane.md", md);
  assert.deepEqual(c.email, ["a@b.com"]);
  assert.equal(
    contactNote({ ...c, phone: ["+1 555"] }, md),
    "---\nemail: a@b.com\nphone: +1 555\n# my comment\nDate Created: 2024-01-01\ntítulo: x\nnotes: x\n---\n# Jane\nbody\n",
  );
  // Removing the email removes only its line.
  assert.equal(contactNote({ ...c, email: [] }, md), "---\n# my comment\nDate Created: 2024-01-01\ntítulo: x\nnotes: x\n---\n# Jane\nbody\n");
});

test("vCards: folded lines, several emails and phones, organization, title, nickname, categories", () => {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Doe;Jane;;;",
    "FN:Jane Doe",
    "EMAIL;TYPE=WORK:jane@acme.com",
    "EMAIL;TYPE=HOME:jd@home.org",
    "TEL;TYPE=CELL:+1 555 0100",
    "ORG:Acme\\, Inc.;Research",
    "TITLE:CTO",
    "NICKNAME:JD,Janey",
    "CATEGORIES:client,board",
    "URL:https://jane.dev",
    "NOTE:Met at the offsite\\nLikes tea",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:4.0",
    "N:Lee;Sam;;;",
    "EMAIL:sam@x.o",
    " rg",
    "END:VCARD",
    "",
  ].join("\r\n");
  const [jane, sam] = parseVCards(vcf);
  assert.deepEqual(jane, { name: "Jane Doe", email: ["jane@acme.com", "jd@home.org"], phone: ["+1 555 0100"], company: "Acme, Inc.", role: "CTO", links: ["https://jane.dev"], aliases: ["JD", "Janey"], tags: ["client", "board"], notes: "Met at the offsite\nLikes tea" });
  assert.equal(sam.name, "Sam Lee", "no FN: the N field's given and family names");
  assert.deepEqual(sam.email, ["sam@x.org"], "a folded line continues the one before");
});

test("CSV: Google's and Outlook's column names, first and last name, lists in one cell", () => {
  const google = 'Name,Given Name,Family Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title,Labels,Website 1 - Value\nJane Doe,Jane,Doe,jane@acme.com,jd@home.org,+1 555 0100,Acme,CTO,client ::: * myContacts,https://jane.dev\n';
  assert.deepEqual(parseContactsCsv(google), [{ name: "Jane Doe", email: ["jane@acme.com", "jd@home.org"], phone: ["+1 555 0100"], company: "Acme", role: "CTO", links: ["https://jane.dev"], aliases: [], tags: ["client"], notes: "" }]);
  const outlook = "First Name,Last Name,E-mail Address,Company,Job Title,Mobile Phone,Categories\nSam,Lee,sam@x.org,Globex,PM,555-0101,vendor;friend\n,,,,,,\n";
  assert.deepEqual(parseContactsCsv(outlook), [{ name: "Sam Lee", email: ["sam@x.org"], phone: ["555-0101"], company: "Globex", role: "PM", links: [], aliases: [], tags: ["vendor", "friend"], notes: "" }]);
  assert.throws(() => parseContactsCsv("colour,size\nred,L\n"), /no column for a name or an email/);
});

test("duplicates: contacts that share an email, or a name (aliases count)", () => {
  const c = (name: string, email: string[] = [], aliases: string[] = []) => ({ ...contactFromNote(`People/${name}.md`, `# ${name}\n`), email, aliases }) as Contact;
  const list = [c("Jane Doe", ["jane@acme.com"]), c("J. Doe", ["JANE@acme.com"]), c("Sam Lee"), c("Samuel Lee", [], ["Sam Lee"]), c("Ann")];
  assert.deepEqual(duplicateContacts(list).map((g) => g.map((x) => x.name)), [["Jane Doe", "J. Doe"], ["Sam Lee", "Samuel Lee"]]);
});

test("a contact's handles, for @name on a task: its name with dashes, and aliases that are one word", () => {
  assert.deepEqual(handlesOf({ name: "Jane Doe", aliases: ["JD", "Janey D"] }), ["Jane-Doe", "JD"]);
  assert.deepEqual(handlesOf({ name: "Sam", aliases: [] }), ["Sam"]);
});

test("the vault lists contacts with when each was last mentioned, and shows one's timeline", () => {
  const { vault } = openTempVault({
    "People/Jane Doe.md": JANE,
    "People/Sam Lee.md": "---\nemail: sam@x.org\n---\n# Sam Lee\n",
    "Archive/People/Old Friend.md": "# Old Friend\n",
    "Journal/2026-09-02.md": "# Sep 2\n\nLunch with [[People/Jane Doe]].\n",
    "Journal/2026-09-20.md": "# Sep 20\n\nCalled [[Jane Doe|Jane]] about the renewal.\n",
    "Meetings/2026-08-15 Deal review.md": "# Deal review\n\nOwner: [[People/Jane Doe]]\n",
    "Meetings/Kickoff.md": "---\ndate: 2026-07-01\n---\n# Kickoff\n\nWith [[People/Sam Lee]].\n",
  });
  const list = vault.contacts();
  // A note without a day in its name is dated by its `date:`.
  assert.deepEqual(list.map((c) => [c.name, c.mentions, c.lastContacted]), [["Jane Doe", 3, "2026-09-20"], ["Sam Lee", 1, "2026-07-01"]]);
  const { contact, timeline } = vault.contact("People/Jane Doe");
  assert.equal(contact.company, "Acme");
  // Newest first; a note with a day in its name (or a `date:`) is dated by it, others by when they last changed.
  assert.deepEqual(timeline.map((t) => [t.kind, t.path, t.date, t.text]), [
    ["note", "Journal/2026-09-20.md", "2026-09-20", "Called [[Jane Doe|Jane]] about the renewal."],
    ["note", "Journal/2026-09-02.md", "2026-09-02", "Lunch with [[People/Jane Doe]]."],
    ["note", "Meetings/2026-08-15 Deal review.md", "2026-08-15", "Owner: [[People/Jane Doe]]"],
  ]);
  assert.throws(() => vault.contact("Journal/2026-09-02"), /isn't a contact/);
});

test("creating and editing a contact writes its note in People/", () => {
  const { vault } = openTempVault({});
  const r = vault.createContact({ name: "Ada Lovelace", email: ["ada@engine.org"], company: "Analytical" }, "you");
  assert.equal(r.path, "People/Ada Lovelace.md");
  assert.equal(vault.read("People/Ada Lovelace").content, "---\nemail: ada@engine.org\ncompany: Analytical\n---\n# Ada Lovelace\n");
  assert.throws(() => vault.createContact({ name: "ada lovelace" }, "you"), /already/);
  assert.throws(() => vault.createContact({ name: "  " }, "you"), /needs a name/);
  assert.throws(() => vault.createContact({ name: "A/B" }, "you"), /can't have/);
  vault.updateContact("People/Ada Lovelace", { role: "Programmer", email: ["ada@engine.org", "ada@home.org"] }, "you");
  assert.deepEqual(vault.contacts()[0].email, ["ada@engine.org", "ada@home.org"]);
  assert.equal(vault.contacts()[0].role, "Programmer");
});

test("merging two contacts keeps one, fills in what it lacked, moves the other's links to it, and trashes the other", () => {
  const { vault } = openTempVault({
    "People/Jane Doe.md": "---\nemail: jane@acme.com\n---\n# Jane Doe\n\nMet at the offsite.\n",
    "People/J Doe.md": "---\nemail: [jane@acme.com, jd@home.org]\nphone: 555-0100\ncompany: Acme\ntags: [client]\n---\n# J Doe\n\nPrefers email.\n",
    "Notes/Call.md": "# Call\n\nWith [[People/J Doe]] and [[J Doe|J]].\n",
  });
  const r = vault.mergeContacts("People/Jane Doe", "People/J Doe", "you");
  assert.equal(r.path, "People/Jane Doe.md");
  assert.equal(
    vault.read("People/Jane Doe").content,
    "---\nemail: [jane@acme.com, jd@home.org]\nphone: 555-0100\ncompany: Acme\naliases: [J Doe]\ntags: [client]\n---\n# Jane Doe\n\nMet at the offsite.\n\n## From J Doe\n\nPrefers email.\n",
  );
  assert.equal(vault.read("Notes/Call").content, "# Call\n\nWith [[People/Jane Doe]] and [[People/Jane Doe|J]].\n");
  assert.deepEqual(r.updated, ["Notes/Call.md"]);
  assert.equal(vault.meta("People/J Doe.md"), null);
  assert.ok(vault.trash().some((t) => t.path === "People/J Doe.md"), "in Trash, to bring back");
  assert.throws(() => vault.mergeContacts("People/Jane Doe", "People/Jane Doe", "you"), /itself/);
});

test("importing fills in contacts that exist (same email or name) and creates the rest, once each", () => {
  const { vault } = openTempVault({ "People/Jane Doe.md": "---\nemail: jane@acme.com\n---\n# Jane Doe\n" });
  const csv = "Name,Email,Company,Phone\nJane D.,jane@acme.com,Acme,\nSam Lee,sam@x.org,Globex,555-0101\nSam Lee,sam@x.org,,\n,,,\n";
  const r = vault.importContacts(csv, "csv", "you");
  assert.deepEqual(r, { created: ["People/Sam Lee.md"], updated: ["People/Jane Doe.md"], unchanged: [] });
  assert.match(vault.read("People/Jane Doe").content, /company: Acme/);
  assert.match(vault.read("People/Jane Doe").content, /aliases: \[Jane D.\]/, "the name it came in under becomes an alias");
  assert.deepEqual(vault.importContacts(csv, "csv", "you"), { created: [], updated: [], unchanged: ["People/Jane Doe.md", "People/Sam Lee.md"] });
  // A vCard's note lands in the new contact's body.
  const v = vault.importContacts("BEGIN:VCARD\nFN:Ann Bee\nNOTE:Tennis on Thursdays\nEND:VCARD\n", "vcard", "you");
  assert.deepEqual(v.created, ["People/Ann Bee.md"]);
  assert.equal(vault.read("People/Ann Bee").content, "# Ann Bee\n\nTennis on Thursdays\n");
});
