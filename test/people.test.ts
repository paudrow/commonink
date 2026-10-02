// Who `@` offers: contacts first (by name, alias, email or company), then workspace members who
// have no contact yet. A member and a contact with the same email are one person.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assigneeOptions, contactLink, memberOf, membersWithoutContact, rankPeople } from "../web/src/people.ts";
import { peopleDirectory } from "../src/core/contacts.ts";
import type { Contact, Member } from "../web/src/api.ts";

const contact = (name: string, o: Partial<Contact> = {}): Contact => ({
  path: `People/${name}.md`, id: name, name, email: [], phone: [], company: "", role: "", links: [], aliases: [], tags: [], checkIn: "", mentions: 0, lastContacted: null, checkInDue: null, ...o,
});
const member = (name: string, email: string, you = false): Member => ({ id: name, name, email, you });

const CONTACTS = [
  contact("Jane Doe", { email: ["jane@acme.com"], company: "Acme", role: "CTO", lastContacted: "2026-09-20" }),
  contact("Priya Shah", { email: ["priya@initech.com"], company: "Initech", aliases: ["P"], lastContacted: "2026-09-25" }),
  contact("Omar Haddad", { company: "Acme" }),
];
const MEMBERS = [member("Jane Doe", "JANE@acme.com"), member("Sam Dev", "sam@localhost"), member("You Dev", "you@localhost", true)];

test("a member is the contact with their email; the rest are members without a contact", () => {
  assert.equal(memberOf(CONTACTS[0], MEMBERS)?.name, "Jane Doe");
  assert.equal(memberOf(CONTACTS[1], MEMBERS), undefined);
  assert.deepEqual(membersWithoutContact(CONTACTS, MEMBERS).map((m) => m.name), ["Sam Dev", "You Dev"]);
});

test("@ offers contacts first, best match first, then members without a contact", () => {
  const names = (q: string) => rankPeople(q, CONTACTS, MEMBERS).map((p) => `${p.kind}:${p.name}`);
  // Nothing typed: the most recently mentioned first, then members.
  assert.deepEqual(names(""), ["contact:Priya Shah", "contact:Jane Doe", "contact:Omar Haddad", "member:Sam Dev", "member:You Dev"]);
  assert.deepEqual(names("jan"), ["contact:Jane Doe"]);
  assert.deepEqual(names("acme"), ["contact:Jane Doe", "contact:Omar Haddad"], "by company, and by email");
  assert.deepEqual(names("sam"), ["member:Sam Dev"]);
  assert.deepEqual(rankPeople("jane", CONTACTS, MEMBERS)[0].detail, "CTO, Acme");
  assert.deepEqual(rankPeople("sam", CONTACTS, MEMBERS)[0].detail, "sam@localhost");
});

test("a note links to a contact by its path", () => {
  assert.equal(contactLink("People/Jane Doe.md"), "[[People/Jane Doe]]");
  assert.equal(contactLink("People/Team/Omar.md"), "[[People/Team/Omar]]");
});

test("@ on a task offers people by name or by any @name that's theirs, writes their handle, then names only ever on tasks", () => {
  const directory = peopleDirectory([{ ...CONTACTS[0], aliases: ["JD"] }, CONTACTS[1]], MEMBERS);
  const offer = (q: string) => assigneeOptions(q, directory, ["jane", "bob", "Priya"]).map((a) => `${a.name}=@${a.handle} (${a.detail})`);
  assert.deepEqual(offer("jan"), ["Jane Doe=@JD (contact · member)"]);
  assert.deepEqual(offer("jd"), ["Jane Doe=@JD (contact · member)"]);
  assert.deepEqual(offer("sam"), ["Sam Dev=@Sam (member)"]);
  // "jane" and "Priya" are people's names already; "bob" is only on tasks.
  assert.deepEqual(offer("b"), ["bob=@bob (on tasks)"]);
  assert.deepEqual(offer("").map((o) => o.split("=")[0]), ["Jane Doe", "Priya Shah", "Sam Dev", "You Dev", "bob"]);
});

test("a contact's check-in reads as its rhythm and when it's next due, or since when it's overdue", async () => {
  const { checkInText, dueForCheckIn } = await import("../web/src/contactsPage.ts");
  const at = (checkIn: string, checkInDue: string | null) => contact("Jane", { checkIn, checkInDue });
  assert.equal(checkInText(at("every 2 weeks", "2026-10-04"), "2026-10-02"), "Every 2 weeks · next Oct 4");
  assert.equal(checkInText(at("monthly", "2026-10-02"), "2026-10-02"), "Every month · due today");
  assert.equal(checkInText(at("3m", "2026-09-20"), "2026-10-02"), "Every 3 months · due since Sep 20");
  assert.equal(checkInText(at("", null)), "");
  assert.deepEqual([at("weekly", "2026-10-02"), at("weekly", "2026-10-03"), at("", null)].map((c) => dueForCheckIn(c, "2026-10-02")), [true, false, false]);
});
