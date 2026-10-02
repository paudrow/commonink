// Moving in from another notes app: what each one's export looks like, turned into the plain
// markdown notes and files Common Ink keeps. Obsidian vaults need nothing (wikilinks, embeds and
// callouts already work); Notion's export names every page "Title <32 hex>" and links by those
// names; Evernote's .enex is XML holding each note's HTML and its pictures in base64; Apple Notes
// comes out as HTML (scripts/export-apple-notes.js saves it) or plain text. No Node or DOM imports beyond
// path, so the CLI, the Worker and the app all convert the same way.
import path from "node:path";
import { htmlToMarkdown, decodeEntities, type HtmlElement } from "./html2md.ts";

/** One file of an import, at its path inside it, before it's sorted into notes and files. */
export interface ImportEntry {
  path: string;
  bytes: Uint8Array;
}

/** Where an import comes from. "auto" tells Notion's export by its names, and always reads .enex files. */
export type ImportFrom = "auto" | "obsidian" | "notion" | "evernote" | "apple-notes";
export const IMPORT_FROM: ImportFrom[] = ["auto", "obsidian", "notion", "evernote", "apple-notes"];

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The id Notion puts at the end of every page, database and folder name: "Plan 1a2b…(32 hex)". */
const NOTION_ID = /\s+[0-9a-f]{32}(?=(_all)?(\.[A-Za-z0-9]+)?$)/;

/** Which app made these files, when `from` is "auto". */
export function detectFrom(entries: ImportEntry[]): Exclude<ImportFrom, "auto"> {
  if (entries.some((e) => /\.enex$/i.test(e.path))) return "evernote";
  const notes = entries.filter((e) => /\.(md|csv)$/i.test(e.path));
  const ided = notes.filter((e) => NOTION_ID.test(path.posix.basename(e.path))).length;
  return ided && ided * 2 >= notes.length ? "notion" : "obsidian";
}

/** The entries as Common Ink notes and files: Notion's ids out of names and links, .enex files opened, Apple Notes' HTML and text made markdown. */
export function convertEntries(entries: ImportEntry[], from: ImportFrom): { entries: ImportEntry[]; from: Exclude<ImportFrom, "auto"> } {
  const src = from === "auto" ? detectFrom(entries) : from;
  // An .enex is unambiguous, so it's opened whichever app was named.
  let out = entries.flatMap((e) => (/\.enex$/i.test(e.path) ? enexEntries(e) : [e]));
  if (src === "notion") out = notionEntries(out);
  if (src === "apple-notes") out = out.map(appleNotesEntry);
  return { entries: out, from: src };
}

// ── Notion ──────────────────────────────────────────────────────────────────────────────────────

const encodeLink = (p: string) => p.split("/").map((s) => encodeURIComponent(s).replace(/%2F/gi, "/")).join("/");
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Notion's names without their ids ("Plan 1a2b….md" → "Plan.md", in folders too), two pages that
 * end up with one name told apart ("Untitled.md", "Untitled 2.md"), and every link between pages
 * pointed at the new names.
 */
function notionEntries(entries: ImportEntry[]): ImportEntry[] {
  const renamed = new Map<string, string>();
  const taken = new Set<string>();
  for (const e of entries) {
    const clean = e.path.split("/").map((seg) => seg.replace(NOTION_ID, "")).join("/");
    let p = clean;
    const ext = path.posix.extname(clean);
    for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${clean.slice(0, clean.length - ext.length)} ${n}${ext}`;
    taken.add(p.toLowerCase());
    renamed.set(e.path, p);
  }
  return entries.map((e) => {
    const to = renamed.get(e.path)!;
    if (!/\.md$/i.test(e.path)) return { path: to, bytes: e.bytes };
    const dir = path.posix.dirname(e.path);
    const newDir = path.posix.dirname(to);
    const md = dec.decode(e.bytes).replace(/(!?\[[^[\]\n]*\])\(([^()\s]+)\)/g, (m, label: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return m;
      const [file, hash = ""] = safeDecode(target).split(/(?=#)/);
      const was = path.posix.normalize(path.posix.join(dir, file));
      const now = renamed.get(was);
      const rel = now ? path.posix.relative(newDir, now) : file.split("/").map((seg) => seg.replace(NOTION_ID, "")).join("/");
      return `${label}(${encodeLink(rel)}${hash})`;
    });
    return { path: to, bytes: enc.encode(md) };
  });
}

// ── Apple Notes ─────────────────────────────────────────────────────────────────────────────────

/** An Apple Notes note, saved as HTML (by the export script) or plain text, as a markdown note. */
function appleNotesEntry(e: ImportEntry): ImportEntry {
  const ext = path.posix.extname(e.path).toLowerCase();
  if (ext !== ".html" && ext !== ".htm" && ext !== ".txt") return e;
  const text = dec.decode(e.bytes).replace(/^﻿/, "");
  const md = ext === ".txt" ? text : htmlToMarkdown(text);
  return { path: e.path.slice(0, -ext.length) + ".md", bytes: enc.encode(md) };
}

// ── Evernote ────────────────────────────────────────────────────────────────────────────────────

export interface EnexNote {
  title: string;
  /** The note's ENML (HTML inside <en-note>). */
  content: string;
  created?: string;
  updated?: string;
  tags: string[];
  source?: string;
  resources: Array<{ data: Uint8Array; mime: string; fileName?: string; hash: string }>;
}

/** The text inside each `<name>…</name>` in `xml`, CDATA unwrapped and entities read. */
function elements(xml: string, name: string): Array<{ inner: string; start: number; end: number }> {
  const out: Array<{ inner: string; start: number; end: number }> = [];
  const lower = xml.toLowerCase();
  let at = 0;
  for (;;) {
    const open = lower.indexOf(`<${name}`, at);
    if (open < 0) return out;
    const after = lower[open + name.length + 1];
    const gt = lower.indexOf(">", open);
    if (gt < 0) return out;
    if (after !== ">" && after !== " " && after !== "/" && after !== "\n" && after !== "\t" && after !== "\r") {
      at = gt + 1;
      continue;
    }
    if (xml[gt - 1] === "/") {
      out.push({ inner: "", start: open, end: gt + 1 });
      at = gt + 1;
      continue;
    }
    const close = lower.indexOf(`</${name}>`, gt);
    const end = close < 0 ? xml.length : close;
    out.push({ inner: xml.slice(gt + 1, end), start: open, end: close < 0 ? xml.length : close + name.length + 3 });
    at = close < 0 ? xml.length : close + name.length + 3;
  }
}

const unwrap = (s: string) => {
  const t = s.trim();
  if (t.startsWith("<![CDATA[")) {
    const end = t.lastIndexOf("]]>");
    return t.slice(9, end < 0 ? t.length : end);
  }
  return decodeEntities(t);
};
const first = (xml: string, name: string) => {
  const e = elements(xml, name)[0];
  return e ? unwrap(e.inner) : undefined;
};
/** "20240115T093000Z" → "2024-01-15T09:30:00Z". */
const enexDate = (s?: string) => {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : undefined;
};
const base64 = (s: string) => {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The notes in an Evernote export (.enex). */
export function parseEnex(xml: string): EnexNote[] {
  return elements(xml, "note").map(({ inner }) => {
    // The note's HTML and its resources first, so a <tag> or <title> inside them isn't read as the note's.
    const content = first(inner, "content") ?? "";
    let rest = inner;
    const cut = (name: string) => {
      for (const e of elements(rest, name).reverse()) rest = rest.slice(0, e.start) + rest.slice(e.end);
    };
    const resources = elements(inner, "resource").map(({ inner: r }) => {
      let data: Uint8Array;
      try {
        data = base64(elements(r, "data")[0]?.inner ?? "");
      } catch {
        data = new Uint8Array();
      }
      return { data, mime: first(r, "mime") ?? "application/octet-stream", fileName: first(r, "file-name"), hash: md5(data) };
    });
    cut("content");
    cut("resource");
    return {
      title: first(rest, "title")?.trim() || "Untitled",
      content,
      created: enexDate(first(rest, "created")),
      updated: enexDate(first(rest, "updated")),
      tags: elements(rest, "tag").map((t) => unwrap(t.inner).trim()).filter(Boolean),
      source: first(rest, "source-url"),
      resources,
    };
  });
}

const EXT: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
  "application/pdf": ".pdf", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "video/mp4": ".mp4", "video/quicktime": ".mov",
  "text/plain": ".txt", "text/csv": ".csv",
};

/** A name that's safe as one path segment: no slashes, no leading dot, nothing a disk refuses. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

/** A free name in `taken` (lowercased), as "name", "name 2", "name 3"…; it's taken once returned. */
function unique(taken: Set<string>, dir: string, name: string, ext: string): string {
  let p = `${dir}/${name}${ext}`;
  for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${dir}/${name} ${n}${ext}`;
  taken.add(p.toLowerCase());
  return p;
}

/** A tag Common Ink reads: words joined by "-", nothing a #tag can't hold. */
const tagOf = (t: string) => t.trim().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_/-]/gu, "");
/** `s` as a YAML value: plain when YAML reads it back as the same text (a URL, a name), quoted otherwise. */
const yamlStr = (s: string) => (/^[\w./~][^"'\n\\]*$/.test(s) && !/: | #|:$|\s$/.test(s) ? s : JSON.stringify(s));

/**
 * An .enex as notes and files: its notes in a folder named for it (a notebook's export is
 * "Notebook.enex"), each with its dates, tags and source in frontmatter, and its pictures and
 * attachments in that folder's "attachments", embedded where the note had them.
 */
function enexEntries(e: ImportEntry): ImportEntry[] {
  const dir = path.posix.join(path.posix.dirname(e.path), safeName(path.posix.basename(e.path).replace(/\.enex$/i, "")));
  const out: ImportEntry[] = [];
  const taken = new Set<string>();
  for (const note of parseEnex(dec.decode(e.bytes))) {
    const byHash = new Map<string, string>();
    for (const r of note.resources) {
      if (!r.data.length || byHash.has(r.hash)) continue;
      const ext = path.posix.extname(r.fileName ?? "") || EXT[r.mime.split(";")[0].trim()] || ".bin";
      const base = safeName((r.fileName ?? "").replace(/\.[^.]*$/, "") || r.hash.slice(0, 8));
      const p = unique(taken, `${dir}/attachments`, base, ext.toLowerCase());
      byHash.set(r.hash, p);
      out.push({ path: p, bytes: r.data });
    }
    const media = (el: HtmlElement) => {
      const p = byHash.get((el.attrs.hash ?? "").toLowerCase());
      return p ? `![[${path.posix.relative(dir, p)}]]` : null;
    };
    const body = htmlToMarkdown(note.content, { media });
    const name = safeName(note.title);
    const fm = [
      name !== note.title ? `title: ${yamlStr(note.title)}` : "",
      note.created ? `created: ${note.created}` : "",
      note.updated ? `updated: ${note.updated}` : "",
      note.tags.length ? `tags: [${note.tags.map(tagOf).filter(Boolean).join(", ")}]` : "",
      note.source ? `source: ${yamlStr(note.source)}` : "",
    ].filter(Boolean);
    const md = (fm.length ? `---\n${fm.join("\n")}\n---\n\n` : "") + body;
    out.push({ path: unique(taken, dir, name, ".md"), bytes: enc.encode(md) });
  }
  return out;
}

// ── MD5, for Evernote: a note finds its pictures by the MD5 of their bytes ──────────────────────

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 of `bytes`, as lowercase hex. */
export function md5(bytes: Uint8Array): string {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >>> 6) * 64 + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + m[g]) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((w) => Array.from({ length: 4 }, (_, i) => ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}
