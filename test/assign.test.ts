// Assigning tasks: `@name` on a task is a person, a contact or a workspace member, whichever
// that name is theirs. "Assigned to me" finds the reader's tasks in anyone's notes (that they
// may read), and "assigned by me" the tasks in their notes that they gave to someone else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFromNote, peopleDirectory, personFor, preferredHandle, type MemberRef } from "../src/core/contacts.ts";
import { openTempVault } from "./helpers.ts";

const JANE = contactFromNote("People/Jane Doe.md", "---\nemail: jane@acme.com\naliases: [JD]\n---\n# Jane Doe\n");
const PRIYA = contactFromNote("People/Priya Shah.md", "---\naliases: [Priya]\n---\n# Priya Shah\n");
const MEMBERS: MemberRef[] = [
  { id: "u1", name: "Jane Doe", email: "JANE@acme.com" },
  { id: "u2", name: "Sam Dev", email: "sam@localhost" },
  { id: "u3", name: "Audrow Nash", email: "audrow@example.com" },
];

test("the people @ can name: contacts and members, one person when their emails match", () => {
  const people = peopleDirectory([JANE, PRIYA], MEMBERS);
  assert.deepEqual(
    people.map((p) => [p.name, p.contact, p.member, p.handles]),
    [
      ["Audrow Nash", null, "u3", ["Audrow-Nash", "Audrow"]],
      ["Jane Doe", "People/Jane Doe.md", "u1", ["Jane-Doe", "JD", "Jane"]],
      ["Priya Shah", "People/Priya Shah.md", null, ["Priya-Shah", "Priya"]],
      ["Sam Dev", null, "u2", ["Sam-Dev", "Sam"]],
    ],
  );
  assert.equal(personFor("jane", people)?.name, "Jane Doe");
  assert.equal(personFor("@JD", people)?.name, "Jane Doe");
  assert.equal(personFor("SAM", people)?.name, "Sam Dev");
  assert.equal(personFor("bob", people), null);
  // A first name two people share names neither of them.
  const two = peopleDirectory([JANE, contactFromNote("People/Sam Lee.md", "# Sam Lee\n")], MEMBERS);
  assert.equal(personFor("sam", two), null);
  assert.equal(personFor("Sam-Lee", two)?.name, "Sam Lee");
  // What @ inserts for someone: a one-word alias, else a first name only they have, else the full name with dashes.
  assert.deepEqual(people.map(preferredHandle), ["Audrow", "JD", "Priya", "Sam"]);
  assert.equal(preferredHandle(two.find((p) => p.name === "Sam Lee")!), "Sam-Lee");
});

const vault = () => {
  const v = openTempVault({ "People/Jane Doe.md": "---\nemail: jane@acme.com\naliases: [JD]\n---\n# Jane Doe\n" });
  const { quire } = v;
  quire.create("Audrow's plan.md", "# Plan\n\n- [ ] Draft the brief @Sam\n- [ ] Review it @JD\n- [ ] Book the room @Audrow\n- [ ] Unassigned\n", "Audrow Nash");
  quire.create("Sam's list.md", "# Sam\n\n- [ ] Send the invoice @Jane-Doe\n- [ ] Fix the build @sam-dev\n", "Sam Dev");
  quire.create("Private/Salaries.md", "# Salaries\n\n- [ ] Raise for @Sam\n", "Audrow Nash");
  quire.create("Home.md", "- [ ] Water plants @me\n", "you");
  return v;
};
const texts = (tasks: Array<{ text: string }>) => tasks.map((t) => t.text);

test("assigned to me: the reader's tasks in anyone's notes, by any name that's theirs", () => {
  const { quire } = vault();
  const sam = { user: "u2", person: "Sam Dev", members: MEMBERS };
  assert.deepEqual(texts(quire.tasksFor(sam, { assignee: "me" })), ["Draft the brief @Sam", "Raise for @Sam", "Fix the build @sam-dev"]);
  // Naming someone finds every way they're written.
  assert.deepEqual(texts(quire.tasksFor(sam, { assignee: "jane" })), ["Review it @JD", "Send the invoice @Jane-Doe"]);
  // A name that's no one's is matched as written.
  assert.deepEqual(texts(quire.tasksFor(sam, { assignee: "bob" })), []);
  // Locally there are no accounts: @me is you.
  assert.deepEqual(texts(quire.tasksFor({ user: "you", person: "you", members: [] }, { assignee: "me" })), ["Water plants @me"]);
  // Online, @me names no one (every reader would be "me").
  assert.deepEqual(texts(quire.tasksFor(sam, { assignee: "@me" })), ["Water plants @me"]);
});

test("assigned by me: tasks in notes I made, given to someone other than me", () => {
  const { quire } = vault();
  const audrow = { user: "u3", person: "Audrow Nash", members: MEMBERS };
  assert.deepEqual(texts(quire.tasksFor(audrow, { by: "me" })), ["Draft the brief @Sam", "Review it @JD", "Raise for @Sam"]);
  const sam = { user: "u2", person: "Sam Dev", members: MEMBERS };
  assert.deepEqual(texts(quire.tasksFor(sam, { by: "me" })), ["Send the invoice @Jane-Doe"]);
  // Both at once: what I gave them, narrowed to one person.
  assert.deepEqual(texts(quire.tasksFor(audrow, { by: "me", assignee: "sam" })), ["Draft the brief @Sam", "Raise for @Sam"]);
});

test("only notes the reader may read: one check, canRead, that per-note sharing can fill in", () => {
  const { quire } = vault();
  const sam = { user: "u2", person: "Sam Dev", members: MEMBERS };
  assert.equal(quire.canRead("u2", "Private/Salaries.md"), true, "everyone in a workspace reads every note, for now");
  quire.canRead = (user, path) => !(path.startsWith("Private/") && user !== "u3");
  assert.deepEqual(texts(quire.tasksFor(sam, { assignee: "me" })), ["Draft the brief @Sam", "Fix the build @sam-dev"]);
  assert.deepEqual(texts(quire.tasksFor({ user: "u3", person: "Audrow Nash", members: MEMBERS }, { assignee: "sam" })), ["Draft the brief @Sam", "Raise for @Sam", "Fix the build @sam-dev"]);
});
