// History, Trash, and files moving in and out of the vault.
import { createTwoFilesPatch } from "diff";
import { kindOf, VaultError } from "../paths.ts";
import { fmtChanges, fmtTrash, fmtWrite } from "../format.ts";
import { TRASH_DAYS } from "../vault.ts";
import { parseAuthorFilter } from "../actor.ts";
import { EXPORT_FORMATS, SAVE_FORMATS, type ExportFormat, type SaveFormat } from "../export.ts";
import { command, list, localFiles, num, str } from "./types.ts";

export const history = [
  command({
    cli: "changes",
    mcp: "recent_changes",
    route: "GET /changes",
    title: "Recent changes",
    summary: "What changed and who changed it; --by people|ai|<agent>, --path for one note",
    description:
      "What changed in the vault and who changed it (you, the user, or other agents). " +
      "`since` is an ISO timestamp or a change id from a previous call — use it to catch up. " +
      "`path` (a note's name, path, ID or URL) narrows it to one note, including its history under earlier names. " +
      "`by` narrows it to people's own changes (`people`), any agent's (`ai`), or one agent's (its name).",
    examples: ["commonink changes --since 120", "commonink changes --path Roadmap --by ai", "commonink changes --by Claude --json"],
    readOnly: true,
    args: {
      since: str({ describe: "An ISO time, or a change id from before: only what came after" }),
      path: str({ describe: "One note (its name, path, ID or note URL), under earlier names too" }),
      limit: num({ min: 1, max: 200, describe: "At most this many (default 30)" }),
      by: str({ describe: '"people", "ai", or an agent\'s name' }),
    },
    run: ({ vault }, a) => {
      // A note's name finds it too; a note that's gone is only found by the path it had.
      const path = a.path === undefined ? undefined : (vault.resolve(a.path) ?? a.path);
      const cs = vault.changes({ since: a.since, path, limit: a.limit ?? 30, by: parseAuthorFilter(a.by) });
      return { text: fmtChanges(cs, vault), data: cs };
    },
  }),
  command({
    cli: "diff",
    mcp: "show_change",
    route: "GET /diff",
    title: "Show change",
    summary: "What a change (or a run of them) did to its note, as a unified diff",
    description: "What a change did to its note, as a unified diff of the text before and after it. `to` makes it a run of changes, from `id` to `to`.",
    examples: ["commonink diff 42", "commonink diff 40 --to 44"],
    readOnly: true,
    args: {
      id: num({ required: true, pos: 0, min: 1, label: "change-id", describe: "A change id from recent_changes" }),
      to: num({ min: 1, describe: "The last change of a run (same note)" }),
    },
    run: ({ vault }, a) => {
      const d = vault.diff(a.id, a.to ?? a.id);
      const patch = d.before === null || d.after === null ? null : createTwoFilesPatch(d.path, d.path, d.before, d.after, `before #${a.id}`, `after #${a.to ?? a.id}`);
      // From the `---` line on: what comes before it is a separator.
      const text = patch ? patch.slice(patch.indexOf("--- ")).trimEnd() : `Change #${a.id} (${d.op} ${d.path}) has no text to compare.`;
      return { text, data: d };
    },
  }),
  command({
    cli: "restore",
    mcp: "restore_change",
    route: "POST /restore",
    title: "Restore change",
    summary: "Put a note back the way it was before a change (undoable in turn)",
    description:
      "Put a note back the way it was before a change (from recent_changes); a deleted note comes back from Trash. The restore is a change of its own, so it can be undone the same way. " +
      "base_version refuses it if the note changed since it was read.",
    examples: ["commonink restore 42", "commonink restore 42 --base 1a2b3c4d5e6f"],
    args: {
      id: num({ required: true, pos: 0, min: 1, label: "change-id", describe: "A change id from recent_changes" }),
      base_version: str({ flag: "base", describe: "The note's version as read: refuse if it changed since" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.restore(a.id, source, a.base_version);
      return { text: fmtWrite(r, "Restored"), data: r };
    },
  }),
];

// Deleting for good is only in the app: a CLI call can't tell a person from an agent (see #74).
export const trash = [
  command({
    cli: "trash",
    mcp: "list_trash",
    route: "GET /trash",
    title: "List Trash",
    summary: `What's in Trash, newest first, with ids to restore (kept ${TRASH_DAYS} days)`,
    description: `What's in Trash, newest first: each item's id, where it was, when and by whom it was deleted, and when it's deleted for good (after ${TRASH_DAYS} days).`,
    examples: ["commonink trash", "commonink trash --json"],
    readOnly: true,
    args: {},
    run: ({ vault }) => {
      const items = vault.trash();
      return { text: fmtTrash(items), data: items };
    },
  }),
  command({
    cli: "trash restore",
    mcp: "restore_from_trash",
    route: "POST /trash/restore",
    title: "Restore from Trash",
    summary: "Put Trash items back where they were",
    description: "Put items from Trash back where they were (a free name if that's taken since), by the ids list_trash gave.",
    examples: ["commonink trash restore 1727600000000-42"],
    args: { ids: list({ required: true, pos: "rest", label: "id" }) },
    run: ({ vault, source }, a) => {
      const back = vault.untrash(a.ids, source).map((b) => b.path);
      return { text: back.map((p) => `Restored ${p}`).join("\n"), data: back };
    },
  }),
];

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Bytes don't fit MCP's text tools; agents there reach files through the vault's own folder or the app.
const BINARY = "MCP tools carry text; files' bytes go through the CLI or the app";

export const files = [
  command({
    cli: "upload",
    mcp: { none: BINARY },
    route: "POST /upload",
    title: "Upload files",
    summary: "Add files to the vault (assets/ by default), each under a free name",
    examples: ["commonink upload logo.png", "commonink upload *.pdf --folder Projects/Launch"],
    args: {
      files: localFiles({ required: true, pos: "rest", label: "file", describe: "Files on this computer" }),
      folder: str({ describe: "Where in the vault (default assets)" }),
    },
    run: async ({ vault, bytes, source }, a) => {
      if (!bytes) throw new VaultError("Uploading needs the CLI or the app");
      const added: Array<{ path: string; size: number }> = [];
      for (const f of a.files) {
        const rel = await bytes.add(() => vault.uploadPath(f.name, a.folder ?? "assets"), f.bytes, source);
        added.push({ path: rel, size: f.bytes.length });
      }
      return { text: added.map((f) => `Uploaded ${f.path} (${kb(f.size)})`).join("\n"), data: added };
    },
  }),
  command({
    cli: "download",
    mcp: { none: BINARY },
    route: "GET /files/*",
    title: "Download file",
    summary: "Copy a file from the vault to this computer (--out -: to stdout)",
    examples: ["commonink download assets/logo.png", "commonink download assets/logo.png --out ~/Desktop/logo.png", "commonink download report.pdf --out - | pdftotext - -"],
    readOnly: true,
    args: {
      path: str({ required: true, pos: 0, label: "file", describe: "A file in the vault: an asset, or a note's markdown" }),
      out: str({ only: "cli", describe: "Where to save it (default: its name, here); - for stdout" }),
    },
    // What comes back is the bytes; the CLI saves them where --out says.
    run: async ({ vault, bytes }, a) => {
      if (!bytes) throw new VaultError("Downloading needs the CLI or the app");
      const rel = vault.resolve(a.path);
      const got = rel ? await bytes.read(rel) : null;
      if (!rel || !got) throw new VaultError(`No file matches "${a.path}"`, "not_found");
      return { text: `Downloaded ${rel} (${kb(got.length)})`, data: { path: rel, size: got.length }, save: { name: rel.split("/").pop()!, bytes: got } };
    },
  }),
  command({
    cli: "export",
    mcp: "export_note",
    route: "GET /export",
    title: "Export notes",
    summary: "A note, a folder or everything as a file: its markdown, one web page, Word, or a .zip that opens in Obsidian",
    description:
      "Export a note, a folder or the whole workspace as a file. `md`: the note's markdown as it is. `html`: one self-contained web page " +
      "(the note as it looks in the app, widgets as a snapshot). `docx`: a Word document. `zip`: markdown files and the files they use, " +
      "folders kept, links that work in Obsidian (links to notes left out go to their web address). A folder, or \"/\" for everything, exports as zip.",
    examples: ["commonink export Welcome --format html", "commonink export Projects --format zip --out projects.zip", "commonink export / --format zip", "commonink export Welcome --out - | wc -l"],
    readOnly: true,
    needs: "exporter",
    args: {
      target: str({ required: true, pos: 0, label: "note|folder|/", describe: 'A note (path, name or ID), a folder, or "/" for the whole workspace' }),
      format: str({ enum: EXPORT_FORMATS, mcpRequired: true, describe: "md, html, docx or zip (default md on the CLI)" }),
      out: str({ only: "cli", describe: "Where to save it (default: its name, here); - for stdout" }),
    },
    run: async ({ exporter }, a) => {
      if (!exporter) throw new VaultError("Exporting needs the CLI or the app");
      const file = await exporter(a.target, (a.format ?? "md") as ExportFormat);
      return {
        text: `Exported ${file.name} (${file.data.byteLength} bytes)`,
        data: { name: file.name, bytes: file.data.byteLength, mime: file.mime },
        save: { name: file.name, bytes: file.data, mime: file.mime },
      };
    },
  }),
  command({
    cli: "save-to-drive",
    mcp: "save_to_drive",
    // It reads the note, as export does; what it writes is in the person's own Drive, not the workspace.
    route: "GET /export",
    title: "Save a note to Google Drive",
    summary: "Save a note to your Google Drive as a Google Doc, a PDF or its markdown file (also: export <note> --to drive)",
    description:
      "Save a note to the Google Drive of the person you work for, in a folder named Common Ink: `doc` (the default) a Google Doc they can edit, " +
      "`pdf` a PDF, `md` the markdown file. Links to other notes become links to their web address. Hosted workspaces only, and only once the " +
      "person has connected Google Drive in the app (Share, then Save to Google Drive). Answers with the file's Drive link.",
    examples: ["commonink save-to-drive Welcome", "commonink export Welcome --to drive --format pdf"],
    needs: "drive",
    openWorld: true,
    args: {
      note: str({ required: true, pos: 0, describe: "The note (path, name or ID)" }),
      format: str({ enum: SAVE_FORMATS, describe: "doc (a Google Doc, the default), pdf, or md (the markdown file)" }),
      to: str({ only: "cli", enum: ["drive"], describe: "Where to save it: drive (Google Drive, the only place for now)" }),
    },
    run: async ({ vault, drive }, a) => {
      if (!drive) throw new VaultError("Saving to Google Drive works in a hosted workspace with Google set up: run commonink login, then pass --workspace");
      const rel = vault.resolve(a.note);
      if (!rel || kindOf(rel) === "asset") throw new VaultError(`No note matches "${a.note}". Try search_notes to find it.`, "not_found");
      if (kindOf(rel) !== "md") throw new VaultError(`${rel} is an HTML note: only markdown notes save to ${drive.name} for now`);
      const format = (a.format ?? "doc") as SaveFormat;
      const file = await drive.save(rel, format);
      return { text: `Saved ${rel} to ${drive.name} as ${file.name}: ${file.url}`, data: { path: rel, format, name: file.name, url: file.url } };
    },
  }),
];
