// Contacts: a contact is a note in People/, and its frontmatter says how to reach them:
//
//   ---
//   email: jane@acme.com            (or [a@x.org, b@y.org])
//   phone: +1 555 0100
//   company: Acme
//   role: CTO
//   links:
//     - https://github.com/jane
//   aliases: [JD]
//   tags: [client]
//   ---
//   # Jane Doe
//
// So search, links, backlinks, tags and agents work on contacts with nothing new. This file reads
// and writes that frontmatter (leaving any other keys and the note's words alone), reads vCard and
// CSV exports, and finds likely duplicates. No I/O here: Quire (quire.ts) does the reading and writing.
import { parseCsv } from "./csv.ts";
import { titleOf } from "./parse.ts";
import { cleanTag } from "./tags.ts";

/** The folder contacts live in. */
export const PEOPLE = "People";

export interface ContactFields {
  name: string;
  email: string[];
  phone: string[];
  company: string;
  role: string;
  links: string[];
  aliases: string[];
  tags: string[];
}

/** A contact as a note: its fields, and where it is. */
export interface ContactNote extends ContactFields {
  path: string;
}

/** A contact in the vault, with how often and when last it's mentioned in other notes. */
export interface Contact extends ContactNote {
  id: string;
  /** Other notes that link to it. */
  mentions: number;
  /** The day of the latest of them (YYYY-MM-DD), or null. */
  lastContacted: string | null;
}

/** A contact read from an import: its fields, and any note that came with it (a vCard's NOTE). */
export interface ContactInput extends ContactFields {
  notes: string;
}

/** One entry on a contact's page. Meetings, email and GitHub are for when those are connected (#21, #25, #23). */
export interface TimelineItem {
  kind: "note" | "task" | "meeting" | "email" | "github";
  path: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  line: number;
  text: string;
}

const LISTS = ["email", "phone", "links", "aliases", "tags"] as const;
type ListField = (typeof LISTS)[number];
/** The fields in the order they're written. */
const KEYS = ["email", "phone", "company", "role", "links", "aliases", "tags"] as const;

export const emptyContact = (name: string): ContactFields => ({ name, email: [], phone: [], company: "", role: "", links: [], aliases: [], tags: [] });

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A note's frontmatter as its entries, in order, each with its lines (a key and what's nested under it). */
function entries(md: string): { entries: Array<{ key: string; lines: string[] }>; body: string } {
  const m = md.match(FRONTMATTER);
  if (!m) return { entries: [], body: md };
  const out: Array<{ key: string; lines: string[] }> = [];
  for (const line of m[1].split(/\r?\n/)) {
    const key = line.match(/^([\w-]+):/)?.[1];
    if (key) out.push({ key, lines: [line] });
    else if (out.length) out.at(-1)!.lines.push(line); // a nested line, or a blank one
  }
  return { entries: out, body: md.slice(m[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** An entry's values: `key: a`, `key: [a, b]`, `key: a, b`, or one `- a` per line under it. */
function valuesOf(lines: string[]): string[] {
  const inline = lines[0].replace(/^[\w-]+:/, "").trim();
  if (inline) {
    const list = inline.match(/^\[(.*)\]$/);
    return splitItems(list ? list[1] : inline).map(unquote).filter(Boolean);
  }
  return lines.slice(1).flatMap((l) => l.match(/^\s*-\s+(.*)$/)?.[1] ?? []).map(unquote).filter(Boolean);
}

/** Split on commas that aren't inside quotes. */
function splitItems(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s) {
    if (q) (cur += ch), ch === q && (q = null);
    else if (ch === '"' || ch === "'") (cur += ch), (q = ch);
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** A contact from its note: the frontmatter fields, and its name (the note's title). */
export function contactFromNote(path: string, md: string): ContactNote {
  const c: ContactNote = { path, ...emptyContact(titleOf(md, "md", path)) };
  for (const e of entries(md).entries) {
    const values = valuesOf(e.lines);
    if ((LISTS as readonly string[]).includes(e.key)) c[e.key as ListField] = values;
    else if (e.key === "company" || e.key === "role") c[e.key] = values.join(", ");
  }
  return c;
}

/** A value as YAML that reads back the same: quoted if it could be read as something else. */
function yamlValue(v: string): string {
  return /^[\s[\]{}#&*!|>'"%@`,-]|[,:]\s|,|\s#|\s$|^$/.test(v) ? `"${v.replace(/(["\\])/g, "\\$1")}"` : v;
}

/**
 * A contact's note: `existing` (its current text) with the contact's fields written into its
 * frontmatter, other keys and the words below left as they are. Without `existing`, a new note
 * titled with the contact's name.
 */
export function contactNote(c: ContactFields, existing?: string): string {
  const { entries: had, body } = existing === undefined ? { entries: [], body: `# ${c.name}\n` } : entries(existing);
  const lines: string[] = [];
  for (const key of KEYS) {
    const v = c[key];
    if (typeof v === "string") {
      if (v.trim()) lines.push(`${key}: ${yamlValue(v.trim())}`);
    } else if (v.length) {
      const items = v.map((x) => x.trim()).filter(Boolean);
      if (key === "links") lines.push("links:", ...items.map((x) => `  - ${yamlValue(x)}`));
      else if (items.length === 1 && (key === "email" || key === "phone")) lines.push(`${key}: ${yamlValue(items[0])}`);
      else lines.push(`${key}: [${items.map(yamlValue).join(", ")}]`);
    }
  }
  for (const e of had) if (!(KEYS as readonly string[]).includes(e.key)) lines.push(...e.lines);
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines.length ? `---\n${lines.join("\n")}\n---\n${body}` : body;
}

/**
 * The contacts that match: `q`'s words each in their name, an alias, an email or their company;
 * `company` in their company; `tag` on them (or a tag under it). Any case.
 */
export function matchContacts<T extends ContactFields>(list: T[], f: { q?: string; tag?: string; company?: string }): T[] {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = (f.tag ?? "").replace(/^#/, "").toLowerCase();
  const company = (f.company ?? "").trim().toLowerCase();
  return list.filter((c) => {
    const text = [c.name, ...c.aliases, ...c.email, c.company].join(" ").toLowerCase();
    return (
      words.every((w) => text.includes(w)) &&
      (!company || c.company.toLowerCase().includes(company)) &&
      (!tag || c.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`)))
    );
  });
}

/** `a` with `b`'s values added (any case counts as the same value, and emails ignore case). */
export function unionOf(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const x of b) if (x.trim() && !out.some((o) => o.toLowerCase() === x.trim().toLowerCase())) out.push(x.trim());
  return out;
}

/**
 * `into` with what `from` knows that it doesn't: a company or role it lacks, emails, phones, links
 * and tags it doesn't have, and `from`'s name (and aliases) as aliases when they differ from its own.
 */
export function fillContact(into: ContactFields, from: ContactFields): ContactFields {
  const same = (n: string) => n.trim().toLowerCase() === into.name.trim().toLowerCase();
  return {
    name: into.name,
    email: unionOf(into.email, from.email),
    phone: unionOf(into.phone, from.phone),
    company: into.company || from.company,
    role: into.role || from.role,
    links: unionOf(into.links, from.links),
    aliases: unionOf(into.aliases, [from.name, ...from.aliases].filter((n) => n.trim() && !same(n))),
    tags: unionOf(into.tags, from.tags),
  };
}

export const sameFields = (a: ContactFields, b: ContactFields) => KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Whether `input` is the same person as `c`: an email in common, or a name one of them goes by. */
export function samePerson(c: ContactFields, input: ContactFields): boolean {
  const emails = new Set(c.email.map((e) => e.toLowerCase()));
  if (input.email.some((e) => emails.has(e.toLowerCase()))) return true;
  const names = new Set([c.name, ...c.aliases].map(nameKey));
  return [input.name, ...input.aliases].some((n) => names.has(nameKey(n)));
}

/** Groups of contacts that look like one person (an email or a name in common), each in list order. */
export function duplicateContacts<T extends ContactFields>(list: T[]): T[][] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (samePerson(list[i], list[j])) parent[find(j)] = find(i);
  const groups = new Map<number, T[]>();
  list.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]));
  return [...groups.values()].filter((g) => g.length > 1);
}

const HANDLE = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u;

/** What `@name` on a task can say for this contact: its name with dashes for spaces, and any one-word alias. */
export function handlesOf(c: Pick<ContactFields, "name" | "aliases">): string[] {
  const own = c.name.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_.-]/gu, "");
  return [own, ...c.aliases.map((a) => a.trim())].filter((h, i, all) => h && HANDLE.test(h) && all.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === i);
}

/** The day a note is about: one in its file name (Journal/2026-09-20.md, "2026-08-15 Review.md"), else null. */
export function dayInName(path: string): string | null {
  return path.split("/").pop()!.match(/(?:^|\D)(\d{4}-\d{2}-\d{2})(?:\D|$)/)?.[1] ?? null;
}

// ---------------------------------------------------------------- import

const tidyTags = (raw: string[]) => raw.filter((t) => !t.trim().startsWith("*")).map((t) => cleanTag(t.trim().replace(/\s+/g, "-"))).filter((t): t is string => !!t);

/** A name from an email address when there's nothing else: jane.doe@x.org → Jane Doe. */
const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** vCard text (.vcf, one or many cards; versions 2.1 to 4.0) as contacts. */
export function parseVCards(text: string): ContactInput[] {
  const unfolded = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  const out: ContactInput[] = [];
  let card: (ContactInput & { given: string }) | null = null;
  const unescape = (s: string) => s.replace(/\\([nN])/g, "\n").replace(/\\([,;\\])/g, "$1");
  const parts = (v: string, sep: string) => v.split(new RegExp(`(?<!\\\\)${sep}`)).map(unescape).map((s) => s.trim());
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const prop = line.slice(0, colon).replace(/^item\d+\./i, "").split(";")[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (prop === "BEGIN" && /^vcard$/i.test(value.trim())) card = { ...emptyContact(""), notes: "", given: "" };
    else if (!card) continue;
    else if (prop === "END") {
      const { given, ...c } = card;
      c.name ||= given || nameFromEmail(c.email[0] ?? "");
      if (c.name) out.push(c);
      card = null;
    } else if (prop === "FN") card.name = unescape(value).trim();
    else if (prop === "N") {
      const [family = "", given = "", middle = ""] = parts(value, ";");
      card.given = [given, middle, family].filter(Boolean).join(" ");
    } else if (prop === "EMAIL") card.email = unionOf(card.email, [unescape(value)]);
    else if (prop === "TEL") card.phone = unionOf(card.phone, [unescape(value)]);
    else if (prop === "ORG") card.company ||= parts(value, ";")[0];
    else if (prop === "TITLE") card.role ||= unescape(value).trim();
    else if (prop === "URL") card.links = unionOf(card.links, [unescape(value)]);
    else if (prop === "NICKNAME") card.aliases = unionOf(card.aliases, parts(value, ","));
    else if (prop === "CATEGORIES") card.tags = unionOf(card.tags, tidyTags(parts(value, ",")));
    else if (prop === "NOTE") card.notes = unescape(value).trim();
  }
  return out;
}

/** Which contact field a CSV column fills, from its header (Google, Outlook, Apple and plain names). */
function columnRole(header: string): keyof ContactInput | "first" | "last" | null {
  const h = header.trim().toLowerCase();
  if (/\b(type|label)$/.test(h)) return null; // "E-mail 1 - Type"
  if (/^(name|full name|display name|contact name)$/.test(h)) return "name";
  if (/^(first name|given name|first)$/.test(h)) return "first";
  if (/^(last name|family name|surname|last)$/.test(h)) return "last";
  if (/e-?mail/.test(h)) return "email";
  if (/phone|mobile|^tel/.test(h)) return "phone";
  if (/^(company|organi[sz]ation|org)$|organization 1 - name/.test(h)) return "company";
  if (/^(role|title|job title|position)$|organization 1 - title/.test(h)) return "role";
  if (/^(tags|labels|categories|group membership|groups)$/.test(h)) return "tags";
  if (/website|^urls?$|^links?$|web page/.test(h)) return "links";
  if (/nickname|^aliases?$/.test(h)) return "aliases";
  if (/^notes?$/.test(h)) return "notes";
  return null;
}

/** A CSV of contacts (a header row, then one person a row) as contacts. */
export function parseContactsCsv(text: string): ContactInput[] {
  const [head = [], ...rows] = parseCsv(text);
  const roles = head.map(columnRole);
  if (!roles.some((r) => r === "name" || r === "first" || r === "last" || r === "email")) {
    throw new Error("That CSV has no column for a name or an email. Name one \"Name\", \"First Name\" or \"Email\".");
  }
  const out: ContactInput[] = [];
  for (const row of rows) {
    const c: ContactInput = { ...emptyContact(""), notes: "" };
    let first = "";
    let last = "";
    row.forEach((cell, i) => {
      const role = roles[i];
      const v = cell.trim();
      if (!role || !v) return;
      const items = v.split(/\s*:::\s*|\s*;\s*/).filter(Boolean);
      if (role === "first") first = v;
      else if (role === "last") last = v;
      else if (role === "name") c.name = v;
      else if (role === "company" || role === "role" || role === "notes") c[role] ||= v;
      else if (role === "tags") c.tags = unionOf(c.tags, tidyTags(items));
      else c[role] = unionOf(c[role], items);
    });
    c.name ||= [first, last].filter(Boolean).join(" ") || nameFromEmail(c.email[0] ?? "");
    if (c.name) out.push(c);
  }
  return out;
}
