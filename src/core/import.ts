// Bringing many notes in at once: markdown files, a .zip of a folder of them (an Obsidian vault, or
// a Common Ink export), or path → text pairs from an agent. Notes keep their folders; pictures and
// other files in a .zip come along where the host can store bytes. Everything is checked before
// anything is written, so a bad path or a clash refuses the whole import. No Node or DOM imports:
// Workers run it, and the app unzips with it too.
import { strFromU8, unzipSync } from "fflate";
import { cleanPath, isHidden, kindOf, VaultError } from "./paths.ts";
import type { LocalFile, VaultBytes } from "./commands/types.ts";
import { MAX_NOTE_BYTES, type Vault } from "./vault.ts";
import { convertEntries, type ImportEntry, type ImportFrom } from "./convert.ts";

/** The most notes one import may bring: a bigger vault goes a folder (or a .zip) at a time. */
export const MAX_IMPORT_NOTES = 2000;
/** The most an import may hold, unzipped, in bytes: it's all in memory at once. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** What to do with a note that's already at an imported path. */
export type OnExisting = "skip" | "replace";
export const ON_EXISTING: OnExisting[] = ["skip", "replace"];

/** What an import brings, before it's written: notes as text, other files as bytes. */
export interface ImportSet {
  notes: Array<{ path: string; content: string }>;
  files: Array<{ path: string; bytes: Uint8Array }>;
  /** What was left out, and why ("not a note or a file type the vault keeps"). */
  ignored: Array<{ path: string; why: string }>;
  /** The app it was read as coming from (convert.ts), when it was read from files. */
  from?: Exclude<ImportFrom, "auto">;
}

export interface ImportResult {
  /** The app the files were read as coming from, when it wasn't plain markdown. */
  from?: "notion" | "evernote" | "apple-notes";
  created: string[];
  replaced: string[];
  /** Already there (and `existing` was "skip"), or the same text. */
  skipped: string[];
  /** Pictures and other files stored. */
  files: string[];
  ignored: Array<{ path: string; why: string }>;
}

// What zip tools add that isn't anyone's notes.
const JUNK = /(^|\/)(__MACOSX|Thumbs\.db|desktop\.ini)(\/|$)/i;

const join = (folder: string | undefined, rel: string) => (folder?.trim() ? `${folder.trim().replace(/\/+$/, "")}/${rel}` : rel);

/**
 * The notes and files in what someone picked: each .md or .html file is a note at its name (under
 * `folder`), a .zip brings what's inside it at its paths (under `folder`), and a picture or PDF is a
 * file. Hidden folders (.obsidian, .git, .trash) and zip tools' leftovers are passed over quietly.
 * What another app exported is made Common Ink's first, as `from` says (convert.ts): Notion's
 * names and links, Evernote's .enex, Apple Notes' HTML and text.
 */
export function readImport(picked: LocalFile[], folder?: string, from: ImportFrom = "auto"): ImportSet {
  const raw: ImportEntry[] = [];
  let declared = 0;
  const unzip = (name: string, bytes: Uint8Array): Record<string, Uint8Array> => {
    try {
      return unzipSync(bytes, {
        // Sizes are counted before anything is inflated, so a zip that unpacks to gigabytes is refused unread.
        filter: (e) => {
          if (e.name.endsWith("/") || isHidden(e.name) || JUNK.test(e.name)) return false;
          declared += e.originalSize;
          if (declared > MAX_IMPORT_BYTES) throw new VaultError(`${name} unpacks to more than ${MAX_IMPORT_BYTES / 1024 / 1024} MB: import a folder at a time`);
          return true;
        },
      });
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw new VaultError(`${name} isn't a .zip that can be opened`);
    }
  };
  for (const f of picked) {
    const name = f.name.replace(/\\/g, "/").split("/").pop()!;
    if (!/\.zip$/i.test(name)) {
      declared += f.bytes.byteLength;
      raw.push({ path: name, bytes: f.bytes });
      continue;
    }
    let entries = Object.entries(unzip(name, f.bytes)).map(([entry, bytes]) => ({ path: entry.replace(/\\/g, "/"), bytes }));
    // Notion wraps a big export in a .zip of .zips ("Export-…-Part-1.zip"): those are opened too.
    if (entries.length && entries.every((e) => /\.zip$/i.test(e.path))) {
      entries = entries.flatMap((z) => Object.entries(unzip(z.path, z.bytes)).map(([entry, bytes]) => ({ path: entry.replace(/\\/g, "/"), bytes })));
    }
    raw.push(...entries);
  }

  const converted = convertEntries(raw, from);
  const out: ImportSet = { notes: [], files: [], ignored: [], from: converted.from };
  let total = 0;
  for (const { path, bytes } of converted.entries) {
    const rel = join(folder, path);
    if (isHidden(rel) || JUNK.test(rel)) continue;
    const kind = kindOf(rel);
    if (!kind) {
      out.ignored.push({ path: rel, why: "not a note or a file type the vault keeps" });
      continue;
    }
    total += bytes.byteLength;
    if (total > MAX_IMPORT_BYTES) throw new VaultError(`That's more than ${MAX_IMPORT_BYTES / 1024 / 1024} MB: import a folder at a time`);
    if (kind === "asset") out.files.push({ path: rel, bytes });
    else out.notes.push({ path: rel, content: strFromU8(bytes).replace(/^\uFEFF/, "") });
  }
  return out;
}

/** Path → text pairs (from an agent) as an import, under `folder`. */
export function pairsImport(notes: Record<string, string>, folder?: string): ImportSet {
  return { notes: Object.entries(notes).map(([path, content]) => ({ path: join(folder, path), content })), files: [], ignored: [] };
}

/**
 * Write an import: every note is checked first (a path that can't be a note, the same note twice, too
 * many), then each is created, or replaced or left alone if it's already there, as `existing` says.
 * Files' bytes are stored through `bytes`; one that's already there is left as it is.
 */
export async function writeImport(
  vault: Vault,
  set: ImportSet,
  opts: { existing?: OnExisting; source: string; bytes?: VaultBytes },
): Promise<ImportResult> {
  const existing = opts.existing ?? "skip";
  if (!set.notes.length && !set.files.length) throw new VaultError(set.ignored.length ? "Nothing to import: no notes in that (only files the vault doesn't keep)" : "Nothing to import");
  if (set.notes.length > MAX_IMPORT_NOTES) throw new VaultError(`That's ${set.notes.length} notes; at most ${MAX_IMPORT_NOTES} come in at once: import a folder at a time`);
  if (set.files.length && !opts.bytes) throw new VaultError("Files (pictures, PDFs) come in through the CLI or the app; send only notes here");

  // Check it all before writing any of it.
  const seen = new Map<string, string>();
  const notes = set.notes.map(({ path, content }) => {
    let rel = cleanPath(path);
    if (!kindOf(rel)) rel += ".md";
    if (kindOf(rel) === "asset") throw new VaultError(`${rel} isn't a note: only .md and .html files are notes`);
    const key = rel.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new VaultError(`${rel} is in the import twice (as ${seen.get(key)} too)`);
    seen.set(key, rel);
    if (content.length > MAX_NOTE_BYTES / 4 && new TextEncoder().encode(content).length > MAX_NOTE_BYTES) {
      throw new VaultError(`${rel} is over ${MAX_NOTE_BYTES / 1024 / 1024} MB, the most a note can hold`);
    }
    return { rel, content };
  });
  const files = set.files.map(({ path, bytes }) => ({ rel: cleanPath(path), bytes }));

  const r: ImportResult = { created: [], replaced: [], skipped: [], files: [], ignored: [...set.ignored] };
  if (set.from && set.from !== "obsidian") r.from = set.from;
  for (const { rel, content } of notes) {
    if (!vault.files.stat(rel)) {
      vault.create(rel, content, opts.source);
      r.created.push(rel);
    } else if (existing === "replace" && vault.files.read(rel) !== content) {
      vault.save(rel, content, { source: opts.source });
      r.replaced.push(rel);
    } else r.skipped.push(rel);
  }
  for (const { rel, bytes } of files) {
    if (vault.files.stat(rel)) {
      r.skipped.push(rel);
      continue;
    }
    r.files.push(await opts.bytes!.add(() => rel, bytes, opts.source));
  }
  return r;
}

/** An import's outcome in a few lines, for people and agents. */
export function fmtImport(r: ImportResult): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const app = { notion: "a Notion export", evernote: "Evernote", "apple-notes": "Apple Notes" };
  const lines = [
    `${r.from ? `From ${app[r.from]}: i` : "I"}mported ${n(r.created.length, "new note")}${r.replaced.length ? `, replaced ${n(r.replaced.length, "note")}` : ""}${r.files.length ? `, added ${n(r.files.length, "file")}` : ""}.`,
  ];
  if (r.skipped.length) lines.push(`Left as they were (already there): ${r.skipped.join(", ")}`);
  if (r.ignored.length) lines.push(`Left out: ${r.ignored.map((i) => `${i.path} (${i.why})`).join(", ")}`);
  return lines.join("\n");
}
