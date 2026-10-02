// Export notes as a .zip: the markdown files as they are, in their folders, with the pictures and
// files they use, so the notes open in Obsidian or any markdown tool with their links working. Links
// between exported notes stay as written (Obsidian finds [[names]] across the folder, and relative
// paths keep pointing where they did). A link to a note that wasn't exported becomes that note's web
// address, so it still goes somewhere. The local server, workspaces online, the CLI and MCP all use
// this; a host supplies the bytes of uploaded files. No Node or DOM imports: Workers run it.
import { strToU8, zipSync } from "fflate";
import { notePath } from "./ids.ts";
import { cleanPath, isHidden, kindOf, VaultError } from "./paths.ts";
import { mapOutsideCode } from "./prose.ts";
import { safeDecode } from "./uri.ts";
import type { Vault } from "./vault.ts";

/** The most an export may hold, in bytes before zipping: it's built in memory. */
export const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

/** What to export: some notes (or files) by path, a folder, or the whole workspace (archive included). */
export type ExportWhat = { paths: string[] } | { folder: string } | { all: true };

export interface ExportHost {
  vault: Vault;
  /** An uploaded file's bytes, or null if it's gone. */
  bytes(rel: string): Promise<Uint8Array | null>;
  /** Where the app is ("https://commonink.app"), for links to notes left out. */
  origin: string;
  /** The workspace's name, for a whole-workspace export's file name. */
  name?: string;
}

export interface Exported {
  /** A file name for the .zip. */
  name: string;
  zip: Uint8Array;
  /** What's in it, by path. */
  files: string[];
}

/** How links are rewritten for an export: which notes are in it, and where the rest live on the web. */
export interface LinkPlan {
  resolve(target: string, from: string): string | null;
  included(rel: string): boolean;
  /** A note's web address, or null. */
  url(rel: string): string | null;
  /** A file the export uses (an embedded picture): it goes in the .zip too. */
  uses(rel: string): void;
}

const WIKILINK = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[([^[\]\n]*)\]\(([^()\s]+)((?:\s+"[^"\n]*")?)\)/g;
const label = (s: string) => s.replace(/[[\]\\]/g, (c) => `\\${c}`);

/**
 * A note's markdown with its links made to work outside the app: links to notes in the export and to
 * files stay as written (and the files join the export); a link or embed of a note left out becomes a
 * markdown link to its web address. Code is left alone.
 */
export function relink(md: string, from: string, plan: LinkPlan): string {
  return mapOutsideCode(md, (text) =>
    text
      .replace(WIKILINK, (m, bang: string, target: string, heading = "", alias = "") => {
        const rel = plan.resolve(target.trim(), from);
        if (!rel) return m;
        if (kindOf(rel) === "asset") return plan.uses(rel), m;
        if (plan.included(rel)) return m;
        const url = plan.url(rel);
        const name = alias ? alias.slice(1) : `${target.trim()}${heading ? ` › ${heading.slice(1)}` : ""}`;
        return url ? `${bang ? "↳ " : ""}[${label(name)}](${url})` : m;
      })
      .replace(MDLINK, (m, bang: string, text: string, href: string) => {
        const target = safeDecode(href);
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return m;
        const rel = plan.resolve(target.replace(/#.*$/, ""), from);
        if (!rel) return m;
        if (kindOf(rel) === "asset") return plan.uses(rel), m;
        if (plan.included(rel)) return m;
        const url = plan.url(rel);
        return url ? `${bang ? "↳ " : ""}[${text}](${url})` : m;
      }),
  );
}

/** The notes and files an export takes, by path. */
function pick(vault: Vault, what: ExportWhat): string[] {
  if ("all" in what) return vault.list(undefined, "all").map((n) => n.path);
  if ("folder" in what) {
    const folder = cleanPath(what.folder);
    const inside = vault.list(folder).map((n) => n.path);
    if (!inside.length) throw new VaultError(`No folder "${what.folder}" with notes in it`, "not_found");
    return inside;
  }
  return what.paths.map((p) => {
    const rel = vault.resolve(p);
    if (!rel) throw new VaultError(`No note matches "${p}". Try search_notes to find it.`, "not_found");
    return rel;
  });
}

/** Notes (and their files) as one .zip, folders and all. */
export async function exportZip(host: ExportHost, what: ExportWhat): Promise<Exported> {
  const { vault } = host;
  const paths = [...new Set(pick(vault, what))].filter((p) => !isHidden(p));
  if (!paths.length) throw new VaultError("Nothing to export");
  const inZip = new Set(paths.map((p) => p.toLowerCase()));
  const used = new Set<string>();
  const plan: LinkPlan = {
    resolve: (target, from) => vault.resolve(target, from),
    included: (rel) => inZip.has(rel.toLowerCase()),
    url: (rel) => {
      const meta = vault.meta(rel);
      return meta ? `${host.origin}${notePath(meta.title, meta.id)}` : null;
    },
    uses: (rel) => void (inZip.has(rel.toLowerCase()) || used.add(rel)),
  };
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const add = (rel: string, data: Uint8Array) => {
    total += data.byteLength;
    if (total > MAX_EXPORT_BYTES) throw new VaultError(`That's more than ${MAX_EXPORT_BYTES / 1024 / 1024} MB: export a folder at a time`, "invalid");
    files[rel] = data;
  };
  for (const rel of paths) {
    const kind = kindOf(rel);
    if (kind === "asset") continue;
    const text = vault.files.read(rel);
    if (text === null) continue;
    add(rel, strToU8(kind === "md" ? relink(text, rel, plan) : text));
  }
  for (const rel of [...paths.filter((p) => kindOf(p) === "asset"), ...used]) {
    const data = await host.bytes(rel);
    if (data) add(rel, data);
  }
  const names = Object.keys(files);
  if (!names.length) throw new VaultError("Nothing to export");
  const zip = zipSync(Object.fromEntries(names.map((n) => [n, [files[n], { level: kindOf(n) === "asset" ? 0 : 6 }]])));
  return { name: `${zipName(what, paths, host.name)}.zip`, zip, files: names.sort() };
}

export type ExportFormat = "md" | "html" | "docx" | "zip";
export const EXPORT_FORMATS: ExportFormat[] = ["md", "html", "docx", "zip"];

/** A file an export made. */
export interface ExportFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

/** Exports for the CLI and MCP: `target` is a note, a folder, or "/" for the whole workspace. */
export type Exporter = (target: string, format: ExportFormat) => Promise<ExportFile>;

/**
 * Markdown and .zip from the core. A web page and Word need the app's static render, which runs
 * where there's a DOM to run it in (locally, under jsdom: server/export.ts); `render` does those.
 */
export function coreExporter(host: ExportHost, render?: (rel: string, format: "html" | "docx") => Promise<ExportFile>): Exporter {
  const { vault } = host;
  return async (target, format) => {
    const t = target.trim();
    const rel = t && t !== "/" ? vault.resolve(t) : null;
    const note = rel && kindOf(rel) !== "asset" ? rel : null;
    if (format === "zip") {
      const out = await exportZip(host, !t || t === "/" ? { all: true } : note ? { paths: [note] } : { folder: t });
      return { name: out.name, mime: "application/zip", data: out.zip };
    }
    if (!note) throw new VaultError(`No note matches "${target}". A folder, or "/" for everything, exports as a zip (format "zip").`, "not_found");
    if (format === "md") {
      if (kindOf(note) !== "md") throw new VaultError(`${note} isn't markdown: export it as "html"`);
      return { name: note.split("/").pop()!, mime: "text/markdown; charset=utf-8", data: strToU8(vault.read(note).content) };
    }
    if (kindOf(note) === "html") {
      if (format !== "html") throw new VaultError(`${note} is an HTML note: export it as "html" (the file itself)`);
      return { name: note.split("/").pop()!, mime: "text/html; charset=utf-8", data: strToU8(vault.read(note).content) };
    }
    if (!render) throw new VaultError(`A web page and Word are drawn by the app: use Share → Export as, or \`commonink export\` on the computer with the notes. Markdown and zip work here.`, "invalid");
    return render(note, format);
  };
}

function zipName(what: ExportWhat, paths: string[], workspace = "Workspace"): string {
  if ("all" in what) return workspace;
  if ("folder" in what) return cleanPath(what.folder).split("/").pop() || workspace;
  if (paths.length === 1) return paths[0].split("/").pop()!.replace(/\.(md|html?)$/i, "");
  return "Notes";
}

/** What a note becomes when it's saved somewhere else (Google Drive, online): a Google Doc, a PDF, or its markdown file. */
export const SAVE_FORMATS = ["doc", "pdf", "md"] as const;
export type SaveFormat = (typeof SAVE_FORMATS)[number];

/**
 * A note's markdown for somewhere outside the app (Google Drive): every link to another note,
 * itself included, becomes a link to its web address, as a link to a note left out of a .zip does.
 * Pictures and files keep their links.
 */
export function webMarkdown(host: Pick<ExportHost, "vault" | "origin">, rel: string): string {
  const { vault } = host;
  return relink(vault.read(rel).content, rel, {
    resolve: (target, from) => vault.resolve(target, from),
    included: () => false,
    url: (to) => {
      const meta = vault.meta(to);
      return meta ? `${host.origin}${notePath(meta.title, meta.id)}` : null;
    },
    uses: () => {},
  });
}
