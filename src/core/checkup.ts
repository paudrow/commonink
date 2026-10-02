// A check-up of the workspace: things that may need tending, each with a fix one click away in the
// app (see web/src/checkupPage.ts). Dead links, people with two contact notes, empty notes, notes
// nothing leads to, and tasks long overdue. Each list is only what's there; all empty is all clear.
// Built from what the vault already answers (missingLinks, contacts, backlinks, tasks).
import { duplicateContacts } from "./contacts.ts";
import { splitFrontmatter } from "./parse.ts";
import { addDays } from "./tasks.ts";
import { isArchived, isTagFavorite, type MissingLink, type Vault } from "./vault.ts";
import { AGENTS_NOTE } from "./noteRoles.ts";

/** Tasks overdue by more than this many days count as forgotten. */
export const STALE_DAYS = 30;

export interface NoteRef {
  path: string;
  title: string;
}

export interface Checkup {
  /** Links to notes that aren't here, grouped by what they point to (as missingLinks has them). */
  deadLinks: MissingLink[];
  /** People with more than one contact note: each group's names and notes. */
  duplicateContacts: Array<{ names: string[]; paths: string[] }>;
  /** Notes with nothing in them but a heading (and frontmatter). */
  emptyNotes: NoteRef[];
  /** Top-level notes nothing links to, with no tag and no star: maybe ready to archive. */
  unlinkedNotes: NoteRef[];
  /** Open tasks due more than STALE_DAYS ago that don't repeat. */
  staleTasks: Array<{ path: string; title: string; line: number; summary: string; due: string }>;
}

/** Nothing but a first `# heading` and whitespace. Frontmatter with a field in it (a contact's email, tags) is something. */
export function isEmptyNote(content: string): boolean {
  const { data, body } = splitFrontmatter(content);
  return !Object.values(data).some((v) => v.trim()) && body.replace(/^\s*#[^\n]*\n?/, "").trim() === "";
}

/** The check-up for `user` (whose stars count) on `today` (YYYY-MM-DD). Active notes only. */
export function checkup(vault: Vault, user: string, today = vault.day()): Checkup {
  const notes = vault.list().filter((n) => n.kind === "md");

  const emptyNotes: NoteRef[] = [];
  for (const n of notes) {
    // A note with more than a heading's worth of bytes can't be empty: skip reading it.
    if (n.size > 400) continue;
    const content = vault.read(n.path).content;
    if (isEmptyNote(content)) emptyNotes.push({ path: n.path, title: n.title });
  }
  const empty = new Set(emptyNotes.map((n) => n.path));

  const starred = new Set(vault.favorites(user).flatMap((f) => (isTagFavorite(f) ? [] : [f.path])));
  const tagged = new Set(
    vault
      .tags()
      .filter((t) => t.notes > 0 && !t.tag.includes("/"))
      .flatMap((t) => vault.tagged(t.tag).filter((u) => u.kind === "note").map((u) => u.path)),
  );
  const unlinkedNotes = notes
    .filter((n) => !n.path.includes("/") && n.path !== AGENTS_NOTE && !empty.has(n.path) && !starred.has(n.path) && !tagged.has(n.path))
    .filter((n) => !vault.backlinks(n.path, "active").some((b) => b.path !== n.path))
    .map((n) => ({ path: n.path, title: n.title }));

  const before = addDays(today, -STALE_DAYS);
  const staleTasks = vault
    .tasks()
    .filter((t) => !t.done && !t.meta.rec && t.meta.due && t.meta.due.slice(0, 10) < before && !isArchived(t.path))
    .sort((a, b) => a.meta.due!.localeCompare(b.meta.due!))
    .map((t) => ({ path: t.path, title: t.title, line: t.line, summary: t.summary, due: t.meta.due!.slice(0, 10) }));

  return {
    deadLinks: vault.missingLinks(),
    duplicateContacts: duplicateContacts(vault.contacts(today)).map((g) => ({ names: g.map((c) => c.name), paths: g.map((c) => c.path) })),
    emptyNotes,
    unlinkedNotes,
    staleTasks,
  };
}

/** How many things the check-up found. */
export const findings = (c: Checkup) => c.deadLinks.length + c.duplicateContacts.length + c.emptyNotes.length + c.unlinkedNotes.length + c.staleTasks.length;

/** The check-up as text, for the CLI and MCP. */
export function fmtCheckup(c: Checkup): string {
  if (!findings(c)) return "All clear: no dead links, duplicate contacts, empty notes, unlinked notes or long-overdue tasks.";
  const out: string[] = [];
  const section = (title: string, lines: string[]) => lines.length && out.push(`${title} (${lines.length}):\n${lines.map((l) => `- ${l}`).join("\n")}`);
  section("Dead links", c.deadLinks.map((m) => `[[${m.target}]] from ${m.from.map((f) => `${f.path}:${f.line}`).join(", ")}`));
  section("Duplicate contacts", c.duplicateContacts.map((g) => g.paths.join(" and ")));
  section("Empty notes", c.emptyNotes.map((n) => n.path));
  section("Notes nothing links to (not in a folder, tagged or starred)", c.unlinkedNotes.map((n) => n.path));
  section(`Tasks overdue by more than ${STALE_DAYS} days`, c.staleTasks.map((t) => `${t.path}:${t.line} ${t.summary} (due ${t.due})`));
  return out.join("\n\n");
}
