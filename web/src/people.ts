// People, for `@` and the Contacts page: the workspace's contacts (notes in People/, see
// src/core/contacts.ts) and, online, its members (accounts). A member and a contact with the same
// email are one person; a member with no contact still shows, so you can mention them and make
// their contact on the way. Fetched once, and again after the vault changes.
import { api, type Contact, type Member } from "./api.ts";
import { onVaultChange } from "./events.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { peopleDirectory, type Person as Someone } from "../../src/core/contacts.ts";
import { taskPeople } from "./taskChipEditors.ts";

/** Someone `@` can offer: a contact, or a member who has no contact yet. */
export interface Person {
  kind: "contact" | "member";
  name: string;
  /** What tells them apart: role and company, else an email. */
  detail: string;
  contact?: Contact;
  member?: Member;
}

/** The member a contact is (an email in common), if any. */
export function memberOf(contact: Pick<Contact, "email">, members: Member[]): Member | undefined {
  const mine = new Set(contact.email.map((e) => e.toLowerCase()));
  return members.find((m) => mine.has(m.email.toLowerCase()));
}

/** Members with no contact: who `@` offers after the contacts. */
export function membersWithoutContact(contacts: Contact[], members: Member[]): Member[] {
  const known = new Set(contacts.flatMap((c) => c.email.map((e) => e.toLowerCase())));
  return members.filter((m) => !known.has(m.email.toLowerCase()));
}

const detailOf = (c: Contact) => [c.role, c.company].filter(Boolean).join(", ") || c.email[0] || "";

/**
 * The people matching `query`, best first: contacts (by name, an alias, an email or their
 * company), then members without a contact. With no query, the most recently mentioned contacts first.
 */
export function rankPeople(query: string, contacts: Contact[], members: Member[], limit = { contacts: 8, members: 4 }): Person[] {
  const q = query.trim();
  const scored = contacts
    .map((c) => ({
      c,
      s: q ? Math.max(fuzzyScore(q, c.name), ...c.aliases.map((a) => fuzzyScore(q, a)), ...c.email.map((e) => fuzzyScore(q, e) - 20), c.company ? fuzzyScore(q, c.company) - 40 : -1) : 0,
    }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || (b.c.lastContacted ?? "").localeCompare(a.c.lastContacted ?? "") || a.c.name.localeCompare(b.c.name));
  const others = membersWithoutContact(contacts, members)
    .map((m) => ({ m, s: q ? Math.max(fuzzyScore(q, m.name), fuzzyScore(q, m.email) - 20) : 0 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name));
  return [
    ...scored.slice(0, limit.contacts).map(({ c }): Person => ({ kind: "contact", name: c.name, detail: detailOf(c), contact: c })),
    ...others.slice(0, limit.members).map(({ m }): Person => ({ kind: "member", name: m.name, detail: m.email, member: m })),
  ];
}

/** Someone `@` on a task can name, and what it writes for them. */
export interface Assignee {
  name: string;
  /** What `@` writes: see preferredHandle. */
  handle: string;
  /** Contact, member, or both; or "on tasks" for a name that's only ever been written on one. */
  detail: string;
}

/**
 * Who `@` on a task offers for `query`, best first: people (contacts and members, as one person
 * when their emails match) by name or by any `@name` that's theirs, then names already on tasks
 * that are no one's.
 */
export function assigneeOptions(query: string, directory: Someone[], onTasks: string[]): Assignee[] {
  const q = query.trim().replace(/^@/, "");
  const score = (p: Someone) => (q ? Math.max(fuzzyScore(q, p.name), ...p.handles.map((h) => (h.toLowerCase().startsWith(q.toLowerCase()) ? 1000 : fuzzyScore(q, h) - 10))) : 0);
  const people = directory
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .map(({ p }): Assignee => ({ name: p.name, handle: p.handle, detail: p.contact && p.member ? "contact · member" : p.member ? "member" : "contact" }));
  const claimed = new Set(directory.flatMap((p) => p.handles.map((h) => h.toLowerCase())));
  const others = onTasks
    .filter((n) => !claimed.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q.toLowerCase())))
    .map((n): Assignee => ({ name: n, handle: n, detail: "on tasks" }));
  return [...people, ...others];
}

/** Everyone @ on a task can name, and the names already on tasks: fetched with people(). */
export async function assignees(): Promise<{ directory: Someone[]; onTasks: string[] }> {
  const [{ contacts, members }, onTasks] = await Promise.all([people(), taskPeople().catch(() => [])]);
  return { directory: peopleDirectory(contacts, members), onTasks };
}

/** How a note links to a contact: its path without .md, which always resolves. */
export const contactLink = (path: string) => `[[${path.replace(/\.(md|markdown)$/i, "")}]]`;

let cache: Promise<{ contacts: Contact[]; members: Member[] }> | null = null;
onVaultChange(() => (cache = null), 0);

/** The workspace's contacts and members, fetched once until the vault changes. */
export function people(): Promise<{ contacts: Contact[]; members: Member[] }> {
  cache ??= Promise.all([api.contacts().catch(() => []), api.members().catch(() => [])]).then(([contacts, members]) => ({ contacts, members }));
  return cache;
}

/** Forget what `people()` fetched (a contact was just made or changed here). */
export const refreshPeople = () => void (cache = null);

/**
 * The contact for `name` (and `email`, for a member), made if there isn't one: its path. Someone
 * else may have just made it, so an "already exists" answer is the contact too.
 */
export async function ensureContact(name: string, email?: string): Promise<string> {
  try {
    const r = await api.createContact({ name, ...(email ? { email: [email] } : {}) });
    refreshPeople();
    return r.path;
  } catch (e) {
    const path = (e as { data?: { path?: string } }).data?.path;
    if (path) return path;
    throw e;
  }
}
