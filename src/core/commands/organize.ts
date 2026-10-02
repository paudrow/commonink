// Organizing notes: boards, tags, smart folders, favorites and folders.
import { VaultError } from "../paths.ts";
import { fmtBoards, fmtFavorites, fmtList, fmtSmartFolders, fmtTags, fmtWrite } from "../format.ts";
import { parseQuery } from "../query.ts";
import { isArchiveFolder, type Vault } from "../vault.ts";
import { bool, command, list, num, str, UsageError } from "./types.ts";

const BOARD_HELP =
  "A board is a :::kanban block in a note (closed by :::): its ## headings are columns and its list items are cards, " +
  "with task tokens like tasks. Moving a card into the column named Done ticks it. The opening line's folded=\"A,B\" names the columns the user folded. read_board also lists lines that aren't part of the board (problems): leave them unless the user asks.";
const CARD = "The card's line number from read_board, or words from its text that only that card has";
const COLUMN = "The column's name, or its number from 1";

/** The folders notes live in (archived ones left out), each with how many notes it holds, sub-folders' included. */
export function foldersOf(paths: string[]): Array<{ folder: string; notes: number }> {
  const count = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const f = parts.slice(0, i).join("/");
      count.set(f, (count.get(f) ?? 0) + 1);
    }
  }
  return [...count].sort(([a], [b]) => a.localeCompare(b)).map(([folder, notes]) => ({ folder, notes }));
}

export const boards = [
  command({
    cli: "board",
    mcp: "read_board",
    route: "GET /note",
    title: "Read board",
    summary: "A note's Kanban boards, column by column, each card with its line number",
    description: `The Kanban boards in a note, column by column, each card with its line number. ${BOARD_HELP}`,
    examples: ["commonink board Launch", "commonink board Launch --json"],
    readOnly: true,
    args: { path: str({ required: true, pos: 0, label: "note" }) },
    run: ({ vault }, a) => {
      const { note, boards, unclosed } = vault.boards(a.path);
      return { text: fmtBoards(note.path, boards, unclosed), data: { path: note.path, boards, unclosed } };
    },
  }),
  command({
    cli: "card add",
    mcp: "add_card",
    route: "PUT /note",
    title: "Add card",
    summary: "Add a card to a column of a board",
    description:
      "Add a card to a column of a Kanban board in a note. The text is the card's line (tokens like due:2026-10-01 @jane #tag, or a [[Note]] link); " +
      "more lines nest under it as details.",
    examples: ['commonink card add Launch "To do" Pick a logo @ana', "commonink card add Launch 1 '[[Pricing page]]' --position 1"],
    args: {
      path: str({ required: true, pos: 0, label: "note" }),
      column: str({ required: true, pos: 1, describe: COLUMN }),
      text: str({ required: true, pos: "rest", stdin: true }),
      board: num({ min: 1, describe: "Which board (from 1), when the note has several with this column" }),
      position: num({ min: 1, describe: "Where in the column (from 1); default last" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.addCard(a.path, a.column, a.text, source, { board: a.board, position: a.position });
      return { text: fmtWrite(r, "Added a card to"), data: r };
    },
  }),
  command({
    cli: "card move",
    mcp: "move_card",
    route: "PUT /note",
    title: "Move card",
    summary: "Move a card to another column, or another place in its column",
    description: "Move a card to another column of its board, or to another place in its column. Moving it into the done column ticks it; out of it, unticks it.",
    examples: ["commonink card move Launch tiers Done", "commonink card move Launch 12 Doing --position 1"],
    args: {
      path: str({ required: true, pos: 0, label: "note" }),
      card: str({ required: true, pos: 1, describe: CARD }),
      to_column: str({ required: true, pos: 2, label: "column", describe: COLUMN }),
      position: num({ min: 1, describe: "Where in the column (from 1); default last" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.moveCard(a.path, a.card, a.to_column, source, { position: a.position });
      return { text: fmtWrite(r, r.change ? "Moved a card in" : "No change to"), data: r };
    },
  }),
  command({
    cli: "card edit",
    mcp: "edit_card",
    route: "PUT /note",
    title: "Edit card",
    summary: "Change a card's text, or tick it",
    description:
      "Change a card's text or tick it. The new text replaces the card's line after its checkbox (keep any tokens you want to keep); more lines replace the details nested under it.",
    examples: ['commonink card edit Launch logo --text "Pick a logo @ana"', "commonink card edit Launch 5 --done"],
    args: {
      path: str({ required: true, pos: 0, label: "note" }),
      card: str({ required: true, pos: 1, describe: CARD }),
      text: str({ stdin: true }),
      done: bool({ presets: { undone: false }, describe: "Tick (true) or untick (false). Ticking a repeating card (rec:) adds its next one after it, as update_task does." }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.editCard(a.path, a.card, { text: a.text, done: a.done }, source);
      return { text: fmtWrite(r, r.change ? "Edited a card in" : "No change to"), data: r };
    },
  }),
];

export const tags = [
  command({
    cli: "tags",
    mcp: "list_tags",
    route: "GET /tags",
    title: "List tags",
    summary: "Every tag, nested, with how many notes, tasks and assets carry it",
    description:
      "Every tag in the vault as a tree (tags nest with /), with how many notes, tasks and assets carry each one or a tag under it. " +
      "Use the names with the `tag` filter of search_notes and list_notes (notes that carry the tag themselves) and of list_tasks " +
      "(tasks whose line carries it): a tag on a task tags that task, not its note.",
    examples: ["commonink tags", "commonink tags --json"],
    readOnly: true,
    args: {},
    run: ({ vault }) => {
      const tags = vault.tags();
      return { text: fmtTags(tags), data: tags };
    },
  }),
  command({
    cli: "tag rename",
    mcp: "rename_tag",
    route: "POST /tags/rename",
    title: "Rename tag",
    summary: "Rename a tag (and the tags under it) everywhere; onto an existing tag, merge them",
    description:
      "Rename a tag, and every tag under it, in every note, task and asset. Renaming onto a tag that exists merges the two. " +
      "Each rewritten note is its own change, so recent_changes and restore_change can undo it. Only when the user asks.",
    examples: ["commonink tag rename research research/ml", "commonink tag rename '#Work' work"],
    args: {
      from: str({ required: true, pos: 0, describe: "The tag, with or without #" }),
      to: str({ required: true, pos: 1, describe: "Its new name" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.renameTag(a.from, a.to, source);
      const paths = r.edits.map((e) => e.path);
      const assets = Object.keys(r.assets);
      return {
        text: `Renamed #${a.from.replace(/^#/, "")} to #${a.to.replace(/^#/, "")} in ${paths.length} note${paths.length === 1 ? "" : "s"}${assets.length ? ` and ${assets.length} asset${assets.length === 1 ? "" : "s"}` : ""}${paths.length ? `: ${paths.join(", ")}` : ""}`,
        data: { notes: paths, changes: r.edits.map((e) => e.change.id), assets },
      };
    },
  }),
  command({
    cli: "tag asset",
    mcp: "set_asset_tags",
    route: "PUT /asset-tags",
    title: "Tag asset",
    summary: "Set an asset's tags (images and PDFs can't hold #tags); --clear takes them all off",
    description: "Set the tags of an asset (an image, PDF or other file that can't hold #tags in its text). The list replaces the ones it had; an empty list clears them.",
    examples: ["commonink tag asset assets/logo.png brand brand/logos", "commonink tag asset assets/logo.png --clear"],
    args: {
      path: str({ required: true, pos: 0, label: "asset" }),
      tags: list({ mcpRequired: true, allowEmpty: true, pos: "rest", label: "tag", describe: "The asset's tags from now on ([] clears them)" }),
      clear: bool({ only: "cli", describe: "Take all its tags off" }),
    },
    run: ({ vault }, a) => {
      if (!a.tags?.length && !a.clear) throw new UsageError("Name the tags to set, or pass --clear to take them all off");
      const set = vault.setAssetTags(a.path, a.tags ?? []);
      return { text: set.length ? `Tags on ${a.path}: ${set.map((t) => `#${t}`).join(" ")}` : `No tags on ${a.path}`, data: set };
    },
  }),
];

export const smartFolders = [
  command({
    cli: "smart",
    mcp: "list_smart_folders",
    route: "GET /smart-folders",
    title: "List smart folders",
    summary: "Your smart folders (saved note queries) with counts, or with a name, the notes in one",
    description:
      "The user's smart folders: saved note queries in the sidebar, each with its query and how many notes match now. " +
      "list_notes with smart_folder lists one's notes.",
    examples: ["commonink smart", "commonink smart planning"],
    readOnly: true,
    args: { name: str({ only: "cli", pos: "rest", describe: "List the notes in this one instead" }) },
    run: ({ vault, user }, a) => {
      if (a.name) {
        const items = vault.feed({ ...parseQuery(vault.findSmartFolder(user, a.name).query), limit: Infinity }).items;
        return { text: fmtList(items), data: items };
      }
      const list = vault.smartFolders(user);
      return { text: fmtSmartFolders(list), data: list };
    },
  }),
  command({
    cli: "smart-save",
    mcp: "save_smart_folder",
    route: "POST /smart-folders",
    title: "Save smart folder",
    summary: 'Save a note query (q="…" folder=… tag=… sort=date) as a smart folder',
    description:
      "Create a smart folder (a saved note query in the sidebar), or change one by id. The query uses ::query's keys: " +
      'q="words" folder=Projects tag=work sort=title limit=10 (all optional; a tag includes the tags under it). Several tags (tag=work,plan or ' +
      "tag=work tag=plan) means notes with all of them; add match=any for notes with any of them. sort is modified (last changed first, the default), date (the note's own date: " +
      "frontmatter date/created, else a YYYY-MM-DD in its name, newest first), oldest (the same, oldest first), title or created (newest note first). " +
      'In q, words side by side (or a AND b) all match, a OR b matches either (AND goes first), -x leaves out, ( ) groups, and \'exact phrase\' matches the words together; ' +
      "tag=x, folder=x (folder=A|B for either) and modified>-7d or created<2026-09-01 (a date, today, yesterday, or -7d, -2w, -1m back) filter too, anywhere a word can go: " +
      'q="(tag=work OR tag=home) -folder=Archive". -tag=x and the dates can also stand on their own. commonink help query lists it all. ' +
      'Quote a value with spaces (folder="Health and Fitness"). Only save one the user asked for.',
    examples: ["commonink smart-save Planning tag=plan --just-me", 'commonink smart-save Launch folder=Projects q="launch"', "commonink smart-save Journal tag=journal,health sort=date"],
    args: {
      name: str({ required: true, pos: 0 }),
      query: str({ mcpRequired: true, pos: "rest", describe: "The query, e.g. tag=work,plan sort=date (none: every note)" }),
      just_me: bool({ describe: "Keep it the user's own instead of sharing it with the workspace" }),
      id: str({ describe: "Change this smart folder instead of creating one" }),
    },
    run: ({ vault, user, canEditShared }, a) => {
      const f = vault.saveSmartFolder(user, { id: a.id, name: a.name, query: a.query ?? "", shared: !a.just_me }, canEditShared);
      return { text: fmtSmartFolders(vault.smartFolders(user)), data: f };
    },
  }),
  command({
    cli: "smart-rm",
    mcp: "delete_smart_folder",
    route: "POST /smart-folders/delete",
    title: "Delete smart folder",
    summary: "Delete a smart folder (its notes don't change)",
    description: "Delete a smart folder by name or ID. The notes in it don't change.",
    examples: ["commonink smart-rm Planning"],
    destructive: true,
    args: { smart_folder: str({ required: true, pos: 0, label: "name" }) },
    run: ({ vault, user, canEditShared }, a) => {
      const list = vault.deleteSmartFolder(user, a.smart_folder, canEditShared);
      return { text: fmtSmartFolders(list), data: list };
    },
  }),
];

/** Star (or unstar) notes, and `#tags` among them, and say what the favorites are now. */
function starEach(host: { vault: Vault; user: string }, targets: string[], on: boolean) {
  const { vault, user } = host;
  for (const t of targets) {
    if (t.startsWith("#")) on ? vault.starTag(user, t) : vault.unstarTag(user, t);
    else on ? vault.star(user, t) : vault.unstar(user, t);
  }
  const list = vault.favorites(user);
  return { text: fmtFavorites(list), data: list };
}

export const favorites = [
  command({
    cli: "star",
    mcp: "star_note",
    route: "POST /favorites/star",
    title: "Star note",
    summary: "Add notes (or '#tags') to your favorites",
    description:
      "Add notes to the user's favorites, which the app shows at the top of the sidebar. Stars follow a note through renames, " +
      "moves and archiving. A path starting with # stars that tag. Only star notes the user asked for.",
    examples: ["commonink star Roadmap", "commonink star Welcome '#plan'"],
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: (host, a) => starEach(host, a.paths, true),
  }),
  command({
    cli: "unstar",
    mcp: "unstar_note",
    route: "POST /favorites/unstar",
    title: "Unstar note",
    summary: "Take notes (or '#tags') out of your favorites",
    description: "Take notes out of the user's favorites. The notes themselves don't change.",
    examples: ["commonink unstar Roadmap"],
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: (host, a) => starEach(host, a.paths, false),
  }),
  command({
    cli: "star-tag",
    mcp: "star_tag",
    route: "POST /favorites/star",
    title: "Star tag",
    summary: "Add tags to your favorites, beside your starred notes",
    description:
      "Add tags to the user's favorites, beside their starred notes; clicking one in the app shows every note with that tag " +
      "(or a tag under it). A starred tag follows renames and merges. Only star tags the user asked for.",
    examples: ["commonink star-tag work"],
    args: { tags: list({ required: true, pos: "rest", label: "tag", describe: "Tags, with or without #" }) },
    run: (host, a) => starEach(host, a.tags.map((t) => `#${t.replace(/^#/, "")}`), true),
  }),
  command({
    cli: "unstar-tag",
    mcp: "unstar_tag",
    route: "POST /favorites/unstar",
    title: "Unstar tag",
    summary: "Take tags out of your favorites",
    description: "Take tags out of the user's favorites. The tags and their notes don't change.",
    examples: ["commonink unstar-tag work"],
    args: { tags: list({ required: true, pos: "rest", label: "tag" }) },
    run: (host, a) => starEach(host, a.tags.map((t) => `#${t.replace(/^#/, "")}`), false),
  }),
  command({
    cli: "smart-star",
    mcp: "star_smart_folder",
    route: "POST /favorites/star",
    title: "Star smart folder",
    summary: "Add smart folders to your favorites, beside your starred notes and tags",
    description:
      "Add smart folders (by name or ID, as list_smart_folders gives) to the user's favorites, beside their starred notes and tags. " +
      "Only star ones the user asked for.",
    examples: ["commonink smart-star Planning"],
    args: { smart_folders: list({ required: true, pos: "rest", label: "name" }) },
    run: ({ vault, user }, a) => {
      for (const f of a.smart_folders) vault.starSmartFolder(user, f);
      const list = vault.favorites(user);
      return { text: fmtFavorites(list), data: list };
    },
  }),
  command({
    cli: "smart-unstar",
    mcp: "unstar_smart_folder",
    route: "POST /favorites/unstar",
    title: "Unstar smart folder",
    summary: "Take smart folders out of your favorites",
    description: "Take smart folders out of the user's favorites. The smart folders themselves stay.",
    examples: ["commonink smart-unstar Planning"],
    args: { smart_folders: list({ required: true, pos: "rest", label: "name" }) },
    run: ({ vault, user }, a) => {
      for (const f of a.smart_folders) vault.unstarSmartFolder(user, f);
      const list = vault.favorites(user);
      return { text: fmtFavorites(list), data: list };
    },
  }),
  command({
    cli: "starred order",
    mcp: "order_favorites",
    route: "PUT /favorites",
    title: "Order favorites",
    summary: "Put favorites first, in this order (notes, '#tags' and '~smart folders'); the rest follow",
    description:
      "Reorder the user's favorites: these come first, in this order (a note, a #tag for a starred tag, or ~name for a starred smart folder), and the rest follow as they were.",
    examples: ["commonink starred order Roadmap '#work' Welcome"],
    args: { paths: list({ required: true, pos: "rest", label: "note" }) },
    run: ({ vault, user }, a) => {
      const list = vault.orderFavorites(user, a.paths);
      return { text: fmtFavorites(list), data: list };
    },
  }),
];

export const folders = [
  command({
    cli: "folders",
    mcp: "list_folders",
    route: "GET /notes",
    title: "List folders",
    summary: "Every folder notes live in, with how many notes each holds",
    description: "Every folder with notes in it (archived notes left out), with how many notes it holds, sub-folders' included. A folder exists while a note is in it: create_note or move_note with a path makes one.",
    examples: ["commonink folders"],
    readOnly: true,
    args: {},
    run: ({ vault }) => {
      const found = foldersOf(vault.list(undefined, "active").filter((n) => n.kind !== "asset").map((n) => n.path));
      return { text: found.length ? found.map((f) => `${"  ".repeat(f.folder.split("/").length - 1)}- ${f.folder.split("/").pop()}/ (${f.notes})`).join("\n") : "No folders.", data: found };
    },
  }),
  command({
    cli: "folder rename",
    mcp: "rename_folder",
    route: "POST /folders/rename",
    title: "Rename / move folder",
    summary: "Rename a folder, or move it under another, rewriting every link to what's in it",
    description:
      "Rename a folder or move it under another (to=Projects/Old moves it into Projects). Everything in it moves, archived notes included, " +
      "every link to them is rewritten, and smart folders narrowed to it follow. It can't land on a folder that already has notes. Only when the user asks.",
    examples: ["commonink folder rename Ideas 'Ideas 2026'", "commonink folder rename 'Projects/Ideas' 'Projects/Ideas 2026'"],
    args: {
      folder: str({ required: true, pos: 0 }),
      to: str({ required: true, pos: 1, label: "new-path", describe: "Its whole new path: Projects/Ideas 2026, not just the new name" }),
    },
    run: async ({ vault, source, sharing }, a) => {
      const r = vault.moveFolder(a.folder, a.to, source);
      await sharing?.folderMoved?.(r.from, r.path);
      const updated = [...new Set(r.moved.flatMap((m) => m.updated))].filter((p) => !r.moved.some((m) => m.path === p || m.from === p));
      return {
        text: `Moved ${r.from}/ to ${r.path}/ (${r.moved.length} file${r.moved.length === 1 ? "" : "s"}).${updated.length ? ` Updated links in: ${updated.join(", ")}` : ""}`,
        data: { from: r.from, path: r.path, moved: r.moved.map((m) => ({ from: m.from, to: m.path })), updated },
      };
    },
  }),
  command({
    cli: "folder delete",
    mcp: "delete_folder",
    route: "POST /delete-folder",
    title: "Delete folder",
    summary: "Delete a folder: its notes to Trash (--notes trash) or up into its parent (--notes lift)",
    description:
      "Delete a folder the user asked to delete. With notes=trash, everything in it goes to Trash (restorable, see list_trash); with notes=lift, its notes and assets move up into the folder above it, links kept.",
    examples: ["commonink folder delete Ideas/Old --notes lift", "commonink folder delete Scratch --notes trash"],
    destructive: true,
    args: {
      folder: str({ required: true, pos: 0 }),
      notes: str({ required: true, enum: ["trash", "lift"], describe: "trash: to Trash; lift: up into the parent folder" }),
    },
    run: ({ vault, source }, a) => {
      const dir = a.folder.replace(/^\/+|\/+$/g, "");
      if (isArchiveFolder(dir)) throw new VaultError(`${dir} is the archive, not a folder you can delete; unarchive or delete its notes instead`);
      const r = vault.deleteFolder(dir, a.notes as "trash" | "lift", source);
      const trashed = r.deleted.map(({ id, path }) => ({ id, path }));
      const moved = r.moved.map((m) => ({ from: m.from, to: m.path }));
      if (!trashed.length && !moved.length) throw new VaultError(`There's nothing in ${dir}`, "not_found");
      return {
        text: [...trashed.map((d) => `Moved ${d.path} to Trash (${d.id})`), ...moved.map((m) => `Moved ${m.from} → ${m.to}`)].join("\n"),
        data: { trashed, moved },
      };
    },
  }),
];

