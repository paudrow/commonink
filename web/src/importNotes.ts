// Import notes in the app: markdown files, or a .zip of a folder of them (an Obsidian vault, an
// export), unpacked here and sent in batches (POST /import), with pictures and other files from the
// .zip uploaded beside them. Folders are kept; a note that's already there is left as it is.
import { strFromU8, unzipSync } from "fflate";
import { api } from "./api.ts";

const NOTE = /\.(md|markdown|html?)$/i;
const HIDDEN = (rel: string) => rel.split("/").some((s) => s.startsWith(".")) || /(^|\/)__MACOSX(\/|$)/i.test(rel);
/** A request's worth: well under the server's 20 MB body limit, and a few hundred notes. */
const BATCH_BYTES = 4 * 1024 * 1024;
const BATCH_NOTES = 500;

/** Bring `picked` in; `known` is every path already in the vault (lowercased). Resolves to what happened, in a line. */
export async function importNotes(picked: File[], known: Set<string>): Promise<string> {
  const notes: Array<[string, string]> = [];
  const files: Array<[string, Uint8Array]> = [];
  let ignored = 0;
  for (const f of picked) {
    if (!/\.zip$/i.test(f.name)) {
      if (NOTE.test(f.name)) notes.push([f.name, (await f.text()).replace(/^﻿/, "")]);
      else ignored++;
      continue;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => !e.name.endsWith("/") && !HIDDEN(e.name) });
    } catch {
      throw new Error(`${f.name} isn't a .zip that can be opened`);
    }
    for (const [rel, bytes] of Object.entries(entries)) {
      if (NOTE.test(rel)) notes.push([rel, strFromU8(bytes).replace(/^﻿/, "")]);
      else files.push([rel, bytes]);
    }
  }
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
    `Imported ${n(created, "note")}`,
    uploaded ? `${n(uploaded, "file")}` : "",
    skipped ? `${skipped} already here` : "",
    ignored ? `${ignored} left out` : "",
  ].filter(Boolean).join(", ");
}
