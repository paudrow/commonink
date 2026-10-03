// Import notes in the app: markdown files, a .zip of a folder of them (an Obsidian vault, a Notion
// export), Evernote .enex files, or an Apple Notes export, read and converted here with the core's
// readImport (the CLI's too), then sent in batches (POST /import), with pictures and other files
// uploaded beside them. Folders are kept; a note that's already there is left as it is.
import { readImport } from "../../src/core/import.ts";
import type { ImportFrom } from "../../src/core/convert.ts";
import { api } from "./api.ts";

/** A request's worth: well under the server's 20 MB body limit, and a few hundred notes. */
const BATCH_BYTES = 4 * 1024 * 1024;
const BATCH_NOTES = 500;
const FROM = { notion: "Notion", evernote: "Evernote", "apple-notes": "Apple Notes" } as const;

/** Bring `picked` in; `known` is every path already in the vault (lowercased). Resolves to what happened, in a line. */
export async function importNotes(picked: File[], known: Set<string>, from: ImportFrom = "auto"): Promise<string> {
  const set = readImport(await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))), undefined, from);
  const notes: Array<[string, string]> = set.notes.map((n) => [n.path, n.content]);
  const files: Array<[string, Uint8Array]> = set.files.map((f) => [f.path, f.bytes]);
  let ignored = set.ignored.length;
  if (!notes.length && !files.length) throw new Error("no notes in that");

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < notes.length; ) {
    const batch: Record<string, string> = {};
    let size = 0;
    while (i < notes.length && Object.keys(batch).length < BATCH_NOTES && (size === 0 || size + notes[i][1].length < BATCH_BYTES)) {
      size += notes[i][1].length;
      batch[notes[i][0]] = notes[i][1];
      i++;
    }
    const r = await api.importNotes(batch);
    created += r.created.length;
    skipped += r.skipped.length;
  }

  let uploaded = 0;
  for (const [rel, bytes] of files) {
    if (known.has(rel.toLowerCase())) {
      skipped++;
      continue;
    }
    const slash = rel.lastIndexOf("/");
    try {
      await api.upload(new File([bytes as Uint8Array<ArrayBuffer>], rel.slice(slash + 1)), slash < 0 ? "" : rel.slice(0, slash));
      uploaded++;
    } catch {
      ignored++; // a file type the vault doesn't keep
    }
  }

  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return [
    `Imported ${n(created, "note")}${set.from && set.from !== "obsidian" ? ` from ${FROM[set.from]}` : ""}`,
    uploaded ? `${n(uploaded, "file")}` : "",
    skipped ? `${skipped} already here` : "",
    ignored ? `${ignored} left out` : "",
  ].filter(Boolean).join(", ");
}
