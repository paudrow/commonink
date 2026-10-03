// Notes: find, read, write, move, archive and delete them.
import { kindOf, VaultError } from "../paths.ts";
import { fmtBacklinks, fmtFavorites, fmtList, fmtMissingLinks, fmtRead, fmtSearch, fmtWrite } from "../format.ts";
import { parseQuery, queryProblem } from "../query.ts";
import { TRASH_DAYS } from "../vault.ts";
import { IMPORT_FROM, type ImportFrom } from "../convert.ts";
import { fmtImport, MAX_IMPORT_NOTES, ON_EXISTING, pairsImport, readImport, writeImport, type OnExisting } from "../import.ts";
import { bool, command, list, localFiles, num, pairs, str } from "./types.ts";
import { describeProblems, frontmatterProblems } from "../schema.ts";
import { checkup, fmtCheckup, STALE_DAYS } from "../checkup.ts";

const TAG = "Only notes with this tag or a tag under it: work matches #work and #work/acme. Several (work,plan): notes with all of them";
const ONE_TAG = "Only notes with this tag or a tag under it: work matches #work and #work/acme";
const NOTE = "A path, a path without .md, a [[wikilink]] name, a note ID or a note URL";
const scopeOf = (a: { include_archived?: boolean; archived?: boolean }) => (a.archived ? "archived" : a.include_archived ? "all" : "active") as "archived" | "all" | "active";

/** Refuse a write to a note that changed since `base` was read from it. */
function checkBase(host: { vault: { read(t: string): { path: string; version: string } } }, target: string, base: string | undefined) {
  if (!base) return;
  const note = host.vault.read(target);
  if (note.version !== base) throw new VaultError(`${note.path} is at version ${note.version}, not ${base}. Re-read it and retry.`, "conflict", { version: note.version });
}

/** What's wrong with a note's properties after a write (schema.ts), as lines for whoever wrote it; "" if nothing is. */
function propertyProblems(vault: { read(t: string): { path: string; content: string } }, path: string): string {
  try {
    const n = vault.read(path);
    return describeProblems(n.content, frontmatterProblems(n.content, n.path));
  } catch {
    return "";
  }
}

export const notes = [
  command({
    cli: "search",
    mcp: "search_notes",
    route: "GET /search",
    title: "Search notes",
    summary: "Full-text search (prefix matching), with the lines that match",
    description:
      "Full-text search across the vault (titles, paths, bodies; prefix matching). Every word must match; " +
      '-word leaves out notes with it, a OR b matches either, ( ) groups, and "exact phrase" matches the words together (commonink help query). Returns paths with matching line numbers.',
    examples: ["commonink search launch plan", "commonink search invoice --tag work --json", `commonink search '"launch plan" -draft'`],
    readOnly: true,
    args: {
      query: str({ required: true, pos: "rest", describe: "Words to search for" }),
      limit: num({ min: 1, max: 50, describe: "Max results (default 10)" }),
      include_archived: bool({ flag: "all", describe: "Also search archived notes" }),
      archived: bool({ only: "cli", describe: "Only archived notes" }),
      tag: str({ describe: ONE_TAG }),
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
    summary: "Notes in the vault or a folder, with a tag, the most recent, starred, or in a saved view",
    description:
      "List notes in the vault or a folder, the notes and assets with a tag, the most recently modified notes, or the user's " +
      "starred notes (favorites, in their order). Archived notes (in Archive/, or the workspace's own archive folder like " +
      '"4. Archive/") are excluded unless requested.',
    examples: ["commonink ls Projects", "commonink ls --tag work", "commonink ls --recent 5", "commonink ls --starred", `commonink ls --query 'q="launch -draft" modified>-7d sort=created'`],
    readOnly: true,
    args: {
      folder: str({ pos: 0 }),
      tag: str({ describe: TAG }),
      recent: num({ min: 1, max: 100, describe: "If set, list this many most recently modified notes" }),
      starred: bool({ describe: "If set, list the user's favorites instead" }),
      smart_folder: str({ flag: "smart", describe: "If set, list the notes in this saved view (smart folder: name or ID) instead" }),
      query: str({
        describe:
          'If set, list the notes this note query matches instead, written as a view or ::view writes it: q="(launch OR release) -draft" folder=Projects tag=work modified>-7d -tag=done sort=created. In q, side by side is AND, OR is either, -x leaves out, ( ) groups, and tag=, folder= and dates work inside. See commonink help query.',
      }),
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
      if (a.query) {
        const problem = queryProblem(a.query);
        if (problem) throw new VaultError(problem);
        const items = vault.feed({ ...parseQuery(a.query), scope: scopeOf(a), limit: Infinity }).items;
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
    description:
      "List notes that link to or embed the given note, with the linking line. Links from archived notes are left out " +
      "unless include_archived is set (or the note itself is archived).",
    examples: ["commonink backlinks Roadmap", "commonink backlinks Roadmap --all"],
    readOnly: true,
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: NOTE }),
      include_archived: bool({ flag: "all", describe: "Also links from archived notes" }),
      archived: bool({ only: "cli", describe: "Only links from archived notes" }),
    },
    run: ({ vault }, a) => {
      const scope = scopeOf(a);
      const links = vault.backlinks(a.path, scope);
      const hidden = scope === "active" ? vault.backlinks(a.path, "all").length - links.length : 0;
      return { text: fmtBacklinks(a.path, links, hidden), data: links };
    },
  }),
  command({
    cli: "missing-links",
    mcp: "missing_links",
    route: "GET /links/missing",
    title: "Missing links",
    summary: "Links to notes that aren't here (never written, deleted, or left out of an import), and where each is",
    description:
      "Links to notes or files that aren't in the vault, grouped by what they point to, the most-linked first, with each linking line. " +
      "After an import, these are the notes that didn't come over: create them, fix the link with edit_note, or leave them as a to-do.",
    examples: ["commonink missing-links", "commonink missing-links Projects --json"],
    readOnly: true,
    args: {
      folder: str({ pos: 0, describe: "Only links in notes in this folder" }),
      include_archived: bool({ flag: "all", describe: "Also links in archived notes" }),
    },
    run: ({ vault }, a) => {
      const missing = vault.missingLinks({ folder: a.folder, scope: a.include_archived ? "all" : "active" });
      return { text: fmtMissingLinks(missing), data: missing };
    },
  }),
  command({
    cli: "checkup",
    mcp: "workspace_checkup",
    route: "GET /checkup",
    title: "Check up on this workspace",
    summary: "What may need tending: dead links, duplicate contacts, empty notes, notes nothing links to, long-overdue tasks",
    description:
      "A check-up of the workspace. Dead links (as missing_links has them), people with two contact notes (merge_contacts joins them), " +
      "notes with nothing but a title, top-level notes with no links to them, no tag and no star (maybe ready to archive), " +
      `and open tasks due more than ${STALE_DAYS} days ago that don't repeat. Each list holds only what's there. Archived notes are left out. ` +
      "Suggest fixes to the person rather than making them all yourself: an unlinked note may be just fine.",
    examples: ["commonink checkup", "commonink checkup --json"],
    readOnly: true,
    args: {},
    run: ({ vault, user }) => {
      const c = checkup(vault, user);
      return { text: fmtCheckup(c), data: c };
    },
  }),
  command({
    cli: "create",
    mcp: "create_note",
    route: "POST /note",
    title: "Create note",
    summary: "Create a note; its content from the argument, or stdin with - (or none). --overwrite replaces one that's there",
    description:
      "Create a new note. `.md` is added if no extension is given. Fails if the note exists, unless overwrite is set: then its whole " +
      "text is replaced (the old text stays in its history). Good for re-running an import.",
    examples: ['commonink create Ideas/Pricing "# Pricing"', "printf '# Log\\n' | commonink create Log -", "commonink create Ideas/Pricing - --overwrite < pricing.md"],
    args: {
      path: str({ required: true, pos: 0 }),
      content: str({ required: true, pos: "rest", stdin: true }),
      overwrite: bool({ describe: "If the note exists, replace its text instead of failing" }),
    },
    run: ({ vault, source }, a) => {
      try {
        const r = vault.create(a.path, a.content, source);
        return { text: fmtWrite(r, "Created") + propertyProblems(vault, r.path), data: r };
      } catch (e) {
        if (!a.overwrite || !(e instanceof VaultError) || e.code !== "exists") throw e;
        const rel = (e.data as { path: string }).path;
        const r = { ...vault.save(rel, a.content, { source }), path: rel };
        return { text: fmtWrite(r, r.change ? "Replaced" : "No change to") + propertyProblems(vault, rel), data: r };
      }
    },
  }),
  command({
    cli: "import",
    mcp: "import_notes",
    route: "POST /import",
    title: "Import notes",
    summary: "Create many notes in one go: .md files, a folder, or a .zip (Obsidian, Notion, Evernote .enex, Apple Notes), folders kept",
    description:
      "Create many notes in one call, instead of create_note for each. `notes` maps each note's path to its markdown " +
      `(up to ${MAX_IMPORT_NOTES} at once); \`.md\` is added to a path with no extension. \`folder\` puts them all under a folder. ` +
      "A note that's already there is left as it is, or replaced with `existing: \"replace\"` (History keeps what it was). " +
      "Every path is checked before anything is written, so one bad path refuses the whole import. " +
      "On the CLI, give .md files, a folder or a .zip: folders inside are kept, and pictures and other files come along. " +
      "Other apps' exports are converted: Notion's (ids taken out of names and links), Evernote's .enex files (notes, tags, dates and pictures), " +
      "and Apple Notes' (the AppleNotesExport folder scripts/export-apple-notes.js saves). Which app is told from the files; `from` names it instead.",
    examples: [
      "commonink import notes.zip",
      "commonink import ~/Obsidian/Vault --folder Imported",
      "commonink import *.md --folder Inbox --existing replace",
      "commonink import Notion-Export.zip --folder Notion",
      "commonink import Evernote/*.enex",
      "commonink import ~/Desktop/AppleNotesExport",
    ],
    args: {
      files: localFiles({ required: true, pos: "rest", label: "file", describe: ".md or .html files, folders, or .zip files on this computer" }),
      notes: pairs({ required: true, only: "mcp", describe: "Each note's path (\"Projects/Plan.md\") → its markdown" }),
      folder: str({ describe: "Put everything under this folder (default: where its paths say)" }),
      existing: str({ enum: ON_EXISTING, describe: "A note already at a path: skip it (default) or replace it" }),
      from: str({ enum: IMPORT_FROM, only: "cli", describe: "The app the files come from (default auto: Notion is told by its names, .enex is Evernote)" }),
    },
    run: async ({ vault, source, bytes }, a) => {
      const set = a.notes ? pairsImport(a.notes, a.folder) : readImport(a.files ?? [], a.folder, (a.from as ImportFrom | undefined) ?? "auto");
      const r = await writeImport(vault, set, { existing: a.existing as OnExisting | undefined, source, bytes });
      return { text: fmtImport(r), data: r };
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
      return { text: fmtWrite(r, "Edited") + propertyProblems(vault, r.path), data: r };
    },
  }),
  command({
    cli: "replace",
    mcp: "replace_text",
    route: "POST /replace",
    title: "Replace across notes",
    summary: "Find and replace plain text in every note (or a folder's); --dry-run shows what would change",
    description:
      "Find and replace plain text (not a pattern) in every active Markdown note, or only those in a folder: any case unless match_case, " +
      "and only whole words with whole_word. Over MCP, dry_run is required: pass true first, show the user the notes and lines it lists, and only " +
      "run it again with dry_run false when they ask for it. Each changed note is its own change, so restore_change can undo any of them.",
    examples: ["commonink replace 'Acme Corp' 'Acme Inc' --dry-run", "commonink replace colour color --whole-word --folder Projects"],
    destructive: true,
    args: {
      find: str({ required: true, pos: 0, describe: "The text to find, as written (one line)" }),
      replace: str({ required: true, pos: 1, allowEmpty: true, describe: "What replaces it ('' to remove it)" }),
      folder: str({ describe: "Only notes in this folder (and its subfolders)" }),
      match_case: bool({ describe: "Only where the case matches too" }),
      whole_word: bool({ describe: "Only whole words, not inside longer ones" }),
      // Over MCP an agent must say which it means, so a vault-wide edit is never what it gets by leaving this out.
      dry_run: bool({ mcpRequired: true, describe: "Only say what would change. Over MCP, required: true to preview, false to write" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.replaceAcross(a.find, a.replace, { folder: a.folder, matchCase: a.match_case, wholeWord: a.whole_word, dryRun: a.dry_run }, source);
      const places = r.notes.reduce((n, x) => n + x.count, 0);
      const head = !r.notes.length
        ? `No note has "${a.find}"`
        : `${a.dry_run ? "Would replace" : "Replaced"} ${places} place${places === 1 ? "" : "s"} in ${r.notes.length} note${r.notes.length === 1 ? "" : "s"}`;
      const body = r.notes.flatMap((n) => [`${n.path} (${n.count})`, ...n.lines.flatMap((l) => [`  ${l.line}- ${l.before.trim()}`, `  ${l.line}+ ${l.after.trim()}`])]);
      return { text: [head, ...body].join("\n"), data: { notes: r.notes, changes: r.edits.map((e) => e.change.id) } };
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
      return { text: fmtWrite({ ...r, path: rel }, r.change ? "Wrote" : "No change to") + propertyProblems(vault, rel), data: { ...r, path: rel } };
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
    summary: "Move notes to the archive folder, out of search, listings and backlinks (links keep working)",
    description:
      "Archive notes that are done or no longer active: moves each into the archive folder (keeping its path) so it drops " +
      "out of search, listings and backlinks. The archive folder is the workspace's own top-level one when it has one " +
      '(a folder named Archive or Archives, numbered or not, like "4. Archive"), else Archive/. Everything in such a ' +
      "folder counts as archived. Links to it keep working, and unarchive_note reverses it.",
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
    description: "Move archived notes back to where they were: out of the archive folder, keeping the rest of their path.",
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
