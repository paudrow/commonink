// Notes: find, read, write, move, archive and delete them.
import { kindOf, VaultError } from "../paths.ts";
import { fmtBacklinks, fmtFavorites, fmtList, fmtRead, fmtSearch, fmtWrite } from "../format.ts";
import { parseQuery } from "../query.ts";
import { TRASH_DAYS } from "../vault.ts";
import { bool, command, list, num, str } from "./types.ts";

const TAG = "Only notes with this tag or a tag under it: work matches #work and #work/acme";
const NOTE = "A path, a path without .md, a [[wikilink]] name, a note ID or a note URL";
const scopeOf = (a: { include_archived?: boolean; archived?: boolean }) => (a.archived ? "archived" : a.include_archived ? "all" : "active") as "archived" | "all" | "active";

/** Refuse a write to a note that changed since `base` was read from it. */
function checkBase(host: { vault: { read(t: string): { path: string; version: string } } }, target: string, base: string | undefined) {
  if (!base) return;
  const note = host.vault.read(target);
  if (note.version !== base) throw new VaultError(`${note.path} is at version ${note.version}, not ${base}. Re-read it and retry.`, "conflict", { version: note.version });
}

export const notes = [
  command({
    cli: "search",
    mcp: "search_notes",
    route: "GET /search",
    title: "Search notes",
    summary: "Full-text search (prefix matching), with the lines that match",
    description: "Full-text search across the vault (titles, paths, bodies; prefix matching). Returns paths with matching line numbers.",
    examples: ["commonink search launch plan", "commonink search invoice --tag work --json"],
    readOnly: true,
    args: {
      query: str({ required: true, pos: "rest", describe: "Words to search for" }),
      limit: num({ min: 1, max: 50, describe: "Max results (default 10)" }),
      include_archived: bool({ flag: "all", describe: "Also search archived notes" }),
      archived: bool({ only: "cli", describe: "Only archived notes" }),
      tag: str({ describe: TAG }),
    },
    run: ({ vault }, a) => {
      const hits = vault.search(a.query, a.limit ?? 10, scopeOf(a), a.tag);
      return { text: fmtSearch(a.query, hits), data: hits };
    },
  }),
  command({
    cli: "read",
    mcp: "read_note",
    route: "GET /note",
    title: "Read note",
    summary: "A note with line numbers, and its version for --base",
    description:
      "Read a note with line numbers. `path` may be a vault path, a path without extension, or a [[wikilink]] name. " +
      "The returned version can be passed to edit_note as base_version.",
    examples: ["commonink read Roadmap", "commonink read Projects/Roadmap.md --offset 10 --limit 20"],
    readOnly: true,
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      offset: num({ min: 1, describe: "First line to return (1-based)" }),
      limit: num({ min: 1, describe: "Number of lines to return" }),
    },
    run: ({ vault }, a) => {
      const n = vault.read(a.path);
      return { text: fmtRead(n, a.offset, a.limit), data: n };
    },
  }),
  command({
    cli: "ls",
    mcp: "list_notes",
    route: "GET /notes",
    title: "List notes",
    summary: "Notes in the vault or a folder, with a tag, the most recent, starred, or in a smart folder",
    description:
      "List notes in the vault or a folder, the notes and assets with a tag, the most recently modified notes, or the user's " +
      "starred notes (favorites, in their order). Archived notes (under Archive/) are excluded unless requested.",
    examples: ["commonink ls Projects", "commonink ls --tag work", "commonink ls --recent 5", "commonink ls --starred"],
    readOnly: true,
    args: {
      folder: str({ pos: 0 }),
      tag: str({ describe: TAG }),
      recent: num({ min: 1, max: 100, describe: "If set, list this many most recently modified notes" }),
      starred: bool({ describe: "If set, list the user's favorites instead" }),
      smart_folder: str({ flag: "smart", describe: "If set, list the notes in this smart folder (name or ID) instead" }),
      include_archived: bool({ flag: "all", describe: "Also archived notes" }),
      archived: bool({ only: "cli", describe: "Only archived notes" }),
    },
    run: ({ vault, user }, a) => {
      if (a.starred) {
        const list = vault.favorites(user);
        return { text: fmtFavorites(list), data: list };
      }
      if (a.smart_folder) {
        const items = vault.feed({ ...parseQuery(vault.findSmartFolder(user, a.smart_folder).query), limit: Infinity }).items;
        return { text: fmtList(items), data: items };
      }
      const notes = a.recent ? vault.recent(a.recent) : vault.list(a.folder, scopeOf(a), a.tag);
      return { text: fmtList(notes), data: notes };
    },
  }),
  command({
    cli: "backlinks",
    mcp: "backlinks",
    route: "GET /backlinks",
    title: "Backlinks",
    summary: "Notes that link to or embed a note, with the linking line",
    description: "List notes that link to or embed the given note, with the linking line.",
    examples: ["commonink backlinks Roadmap"],
    readOnly: true,
    args: { path: str({ required: true, pos: 0, label: "note", describe: NOTE }) },
    run: ({ vault }, a) => {
      const links = vault.backlinks(a.path);
      return { text: fmtBacklinks(a.path, links), data: links };
    },
  }),
  command({
    cli: "create",
    mcp: "create_note",
    route: "POST /note",
    title: "Create note",
    summary: "Create a note; its content from the argument, or stdin with - (or none)",
    description: "Create a new note. `.md` is added if no extension is given. Fails if the note exists.",
    examples: ['commonink create Ideas/Pricing "# Pricing"', "printf '# Log\\n' | commonink create Log -"],
    args: {
      path: str({ required: true, pos: 0 }),
      content: str({ required: true, pos: "rest", stdin: true }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.create(a.path, a.content, source);
      return { text: fmtWrite(r, "Created"), data: r };
    },
  }),
  command({
    cli: "edit",
    mcp: "edit_note",
    route: "PUT /note",
    title: "Edit note",
    summary: "Replace an exact string in a note (once, or every time with --all)",
    description:
      "Replace an exact string in a note. old_string must match exactly once (include surrounding lines to disambiguate) " +
      "unless replace_all is set. Pass base_version from read_note to guard against concurrent edits.",
    examples: ['commonink edit Roadmap --old "Ship it" --new "Ship it Friday" --base 1a2b3c4d5e6f', "commonink edit Roadmap --old draft --new - < new.txt"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      old_string: str({ required: true, flag: "old", stdin: true, describe: "The exact text to replace" }),
      new_string: str({ required: true, flag: "new", stdin: true, describe: "What replaces it" }),
      replace_all: bool({ flag: "all", describe: "Replace every match" }),
      base_version: str({ flag: "base", describe: "The version read_note gave: refuse if the note changed since" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.edit(a.path, { oldString: a.old_string, newString: a.new_string, replaceAll: a.replace_all, baseVersion: a.base_version }, source);
      return { text: fmtWrite(r, "Edited"), data: r };
    },
  }),
  command({
    cli: "append",
    mcp: "append_to_note",
    route: "PUT /note",
    title: "Append to note",
    summary: "Add markdown to the end of a note (logs, journals, inboxes)",
    description: "Append markdown to the end of a note (good for logs, journals, inboxes). base_version, if given, refuses the write when the note changed since it was read.",
    examples: ['commonink append Inbox "- call the bank"', "git log -1 --format=%s | commonink append Log -"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      text: str({ required: true, pos: "rest", stdin: true }),
      base_version: str({ flag: "base", describe: "The version read_note gave: refuse if the note changed since" }),
    },
    run: ({ vault, source }, a) => {
      checkBase({ vault }, a.path, a.base_version);
      const r = vault.append(a.path, a.text, source);
      return { text: fmtWrite(r, "Appended to"), data: r };
    },
  }),
  command({
    cli: "write",
    mcp: "write_note",
    route: "PUT /note",
    title: "Write note",
    summary: "Replace a note's whole text (from stdin with -); --base refuses if it changed since you read it",
    description:
      "Replace a note's whole text, or create it. Pass base_version from read_note so a note someone changed since isn't overwritten. " +
      "Prefer edit_note for a small change: it can't clobber anything outside the text it replaces.",
    examples: ["commonink read Roadmap --json | jq -r .content | sed s/draft/final/ | commonink write Roadmap - --base 1a2b3c4d5e6f"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      content: str({ required: true, pos: "rest", stdin: true }),
      base_version: str({ flag: "base", describe: "The version read_note gave: refuse if the note changed since" }),
    },
    run: ({ vault, source }, a) => {
      if (!a.content.trim()) throw new VaultError("That would leave the note empty. To remove it, use delete.");
      const rel = vault.resolve(a.path) ?? (kindOf(a.path) ? a.path : `${a.path}.md`);
      const r = vault.save(rel, a.content, { baseVersion: a.base_version, source });
      return { text: fmtWrite({ ...r, path: rel }, r.change ? "Wrote" : "No change to"), data: { ...r, path: rel } };
    },
  }),
  command({
    cli: "mv",
    mcp: "move_note",
    route: "POST /move",
    title: "Move / rename note",
    summary: "Move or rename a note, rewriting every link to it",
    description: "Move or rename a note and rewrite every link and embed that points to it.",
    examples: ["commonink mv Roadmap Projects/Roadmap-2027"],
    args: {
      from: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      to: str({ required: true, pos: 1, label: "new-path" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.move(a.from, a.to, source);
      return { text: `Moved to ${r.path}.${r.updated.length ? ` Updated links in: ${r.updated.join(", ")}` : ""}`, data: { from: r.from, path: r.path, version: r.version, updated: r.updated } };
    },
  }),
  command({
    cli: "archive",
    mcp: "archive_note",
    route: "POST /archive",
    title: "Archive note",
    summary: "Move notes to Archive/, out of search and listings (links keep working)",
    description:
      "Archive notes that are done or no longer active: moves each under Archive/ (keeping its path) so it drops out of " +
      "search and listings. Links to it keep working, and unarchive_note reverses it.",
    examples: ["commonink archive Ideas/Old-plan"],
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: ({ vault, source }, a) => {
      const moved = a.paths.map((p) => vault.archive(p, source).path);
      return { text: moved.map((p) => `Archived → ${p}`).join("\n"), data: moved };
    },
  }),
  command({
    cli: "unarchive",
    mcp: "unarchive_note",
    route: "POST /unarchive",
    title: "Unarchive note",
    summary: "Move archived notes back to where they were",
    description: "Move archived notes back to where they were.",
    examples: ["commonink unarchive Archive/Ideas/Old-plan.md"],
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: ({ vault, source }, a) => {
      const moved = a.paths.map((p) => vault.unarchive(p, source).path);
      return { text: moved.map((p) => `Unarchived → ${p}`).join("\n"), data: moved };
    },
  }),
  command({
    cli: "delete",
    mcp: "delete_note",
    route: "POST /delete",
    title: "Delete note",
    summary: `Move notes or assets to Trash (restorable for ${TRASH_DAYS} days)`,
    description:
      `Delete notes or assets the user asked to delete: each goes to Trash, where the user can restore it for ${TRASH_DAYS} days. ` +
      "Notes that link to it show the link as missing meanwhile. Prefer archive_note for something that's just done. " +
      "Agents can't delete anything for good.",
    examples: ["commonink delete Scratch", "commonink delete assets/old-logo.png"],
    destructive: true,
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: ({ vault, source }, a) => {
      const gone = vault.delete(a.paths, source).map(({ id, path }) => ({ id, path }));
      return { text: gone.map((d) => `Moved ${d.path} to Trash (${d.id})`).join("\n"), data: gone };
    },
  }),
];
