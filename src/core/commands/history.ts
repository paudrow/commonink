// History, Trash, and files moving in and out of the vault.
import { createTwoFilesPatch } from "diff";
import { QuireError } from "../paths.ts";
import { fmtChanges, fmtTrash, fmtWrite } from "../format.ts";
import { TRASH_DAYS } from "../quire.ts";
import { parseAuthorFilter } from "../actor.ts";
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
    examples: ["quire changes --since 120", "quire changes --path Roadmap --by ai", "quire changes --by Claude --json"],
    readOnly: true,
    args: {
      since: str({ describe: "An ISO time, or a change id from before: only what came after" }),
      path: str({ describe: "One note (its name, path, ID or note URL), under earlier names too" }),
      limit: num({ min: 1, max: 200, describe: "At most this many (default 30)" }),
      by: str({ describe: '"people", "ai", or an agent\'s name' }),
    },
    run: ({ quire }, a) => {
      // A note's name finds it too; a note that's gone is only found by the path it had.
      const path = a.path === undefined ? undefined : (quire.resolve(a.path) ?? a.path);
      const cs = quire.changes({ since: a.since, path, limit: a.limit ?? 30, by: parseAuthorFilter(a.by) });
      return { text: fmtChanges(cs), data: cs };
    },
  }),
  command({
    cli: "diff",
    mcp: "show_change",
    route: "GET /diff",
    title: "Show change",
    summary: "What a change (or a run of them) did to its note, as a unified diff",
    description: "What a change did to its note, as a unified diff of the text before and after it. `to` makes it a run of changes, from `id` to `to`.",
    examples: ["quire diff 42", "quire diff 40 --to 44"],
    readOnly: true,
    args: {
      id: num({ required: true, pos: 0, min: 1, label: "change-id", describe: "A change id from recent_changes" }),
      to: num({ min: 1, describe: "The last change of a run (same note)" }),
    },
    run: ({ quire }, a) => {
      const d = quire.diff(a.id, a.to ?? a.id);
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
    examples: ["quire restore 42", "quire restore 42 --base 1a2b3c4d5e6f"],
    args: {
      id: num({ required: true, pos: 0, min: 1, label: "change-id", describe: "A change id from recent_changes" }),
      base_version: str({ flag: "base", describe: "The note's version as read: refuse if it changed since" }),
    },
    run: ({ quire, source }, a) => {
      const r = quire.restore(a.id, source, a.base_version);
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
    examples: ["quire trash", "quire trash --json"],
    readOnly: true,
    args: {},
    run: ({ quire }) => {
      const items = quire.trash();
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
    examples: ["quire trash restore 1727600000000-42"],
    args: { ids: list({ required: true, pos: "rest", label: "id" }) },
    run: ({ quire, source }, a) => {
      const back = quire.untrash(a.ids, source).map((b) => b.path);
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
    examples: ["quire upload logo.png", "quire upload *.pdf --folder Projects/Launch"],
    args: {
      files: localFiles({ required: true, pos: "rest", label: "file", describe: "Files on this computer" }),
      folder: str({ describe: "Where in the vault (default assets)" }),
    },
    run: async ({ quire, bytes, source }, a) => {
      if (!bytes) throw new QuireError("Uploading needs the CLI or the app");
      const added: Array<{ path: string; size: number }> = [];
      for (const f of a.files) {
        const rel = quire.uploadPath(f.name, a.folder ?? "assets");
        await bytes.add(rel, f.bytes, source);
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
    examples: ["quire download assets/logo.png", "quire download assets/logo.png --out ~/Desktop/logo.png", "quire download report.pdf --out - | pdftotext - -"],
    readOnly: true,
    args: {
      path: str({ required: true, pos: 0, label: "file", describe: "A file in the vault: an asset, or a note's markdown" }),
      out: str({ only: "cli", describe: "Where to save it (default: its name, here); - for stdout" }),
    },
    // What comes back is the bytes; the CLI saves them where --out says.
    run: async ({ quire, bytes }, a) => {
      if (!bytes) throw new QuireError("Downloading needs the CLI or the app");
      const rel = quire.resolve(a.path);
      const got = rel ? await bytes.read(rel) : null;
      if (!rel || !got) throw new QuireError(`No file matches "${a.path}"`, "not_found");
      return { text: `Downloaded ${rel} (${kb(got.length)})`, data: { path: rel, size: got.length }, save: { name: rel.split("/").pop()!, bytes: got } };
    },
  }),
];
