// Exports on the computer with the notes (the CLI, the local MCP server): Markdown and .zip from the
// core (core/export.ts), and a web page and Word from the app's own static render (web/src/export),
// run here under jsdom, so a file made here is the one Share → Export as makes, but for diagrams:
// there's no browser to draw Mermaid, so they stay as their code.
import fs from "node:fs";
import path from "node:path";
import { strToU8 } from "fflate";
import { coreExporter, type ExportFile, type Exporter } from "../core/export.ts";
import { notePath } from "../core/ids.ts";
import { kindOf, mimeOf } from "../core/paths.ts";
import { localDate } from "../core/tasks.ts";
import type { LocalVault } from "../core/local.ts";

/** Where the app runs, for links to notes (`COMMONINK_URL`, or the local server's default address). */
export const APP_URL = (process.env.COMMONINK_URL ?? "http://localhost:4777").replace(/\/+$/, "");

export function localExporter(vault: LocalVault, origin = APP_URL): Exporter {
  const bytes = async (rel: string) => (vault.files.stat(rel) ? new Uint8Array(await fs.promises.readFile(vault.files.abs(rel))) : null);
  return coreExporter({ vault: vault, bytes, origin, name: path.basename(vault.files.root) }, (rel, format) => render(vault, rel, format, origin));
}

let dom: Promise<void> | null = null;

/** A browser's globals, from jsdom, for the web modules the static render uses. Once per process. */
function installDom(): Promise<void> {
  return (dom ??= import("jsdom").then(({ JSDOM }) => {
    const w = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" }).window;
    const g = globalThis as Record<string, unknown>;
    for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLImageElement", "DOMParser", "DocumentFragment", "CustomEvent", "Event", "NodeFilter", "localStorage", "location", "getComputedStyle", "navigator"]) {
      if (!(key in g) || key === "navigator") Object.defineProperty(g, key, { value: (w as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
    }
  }));
}

/** A note as a web page or a Word document. */
async function render(vault: LocalVault, rel: string, format: "html" | "docx", origin: string): Promise<ExportFile> {
  await installDom();
  const [{ renderStatic }, { htmlDocument, fileName }] = await Promise.all([import("../../web/src/export/static.ts"), import("../../web/src/export/files.ts")]);
  const note = vault.read(rel);
  const url = (p: string) => {
    const meta = vault.meta(p);
    return meta ? `${origin}${notePath(meta.title, meta.id)}` : null;
  };
  const html = await renderStatic(
    rel,
    note.content,
    {
      async note(target, from) {
        const p = vault.resolve(target, from);
        if (!p || kindOf(p) === "asset") return null;
        const n = vault.read(p);
        return { path: p, title: n.title, content: n.content, url: url(p) };
      },
      url: async (target, from) => {
        const p = vault.resolve(target, from);
        return p ? url(p) : null;
      },
      tasks: async (q) => vault.tasks({ ...q, today: localDate(Date.now()) }),
      feed: async (q) => vault.feed({ ...q, scope: "active" }).items,
      today: async () => vault.today(),
      math: () => import("../../web/src/mathRender.ts"),
      image: async (src) => picture(vault, src),
    },
    { math: format === "html" ? "mathml" : "katex" },
  );
  if (format === "html") return { name: fileName(rel, "html"), mime: "text/html; charset=utf-8", data: strToU8(htmlDocument(note.title, html, new Date())) };
  const { toDocx } = await import("../../web/src/export/docx.ts");
  return { name: fileName(rel, "docx"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: await toDocx(note.title, html) };
}

/**
 * A picture the note shows, from the vault, as a data: URL. Rendered markdown points at the app's
 * file routes (`/api/files/<path>`, `/api/file-resolve?target=…&from=…`); a picture from the web keeps its address.
 */
async function picture(vault: LocalVault, src: string): Promise<string | null> {
  const at = new URL(src, "http://localhost/");
  if (at.origin !== "http://localhost") return null;
  const route = at.pathname.replace(/^\/api(\/w\/[^/]+)?/, "");
  const rel = route.startsWith("/files/") ? decodeURIComponent(route.slice("/files/".length)) : route === "/file-resolve" ? vault.resolve(at.searchParams.get("target") ?? "", at.searchParams.get("from") ?? undefined) : null;
  const mime = rel ? mimeOf(rel) : null;
  if (!rel || !mime?.startsWith("image/") || !vault.files.stat(rel)) return null;
  return `data:${mime};base64,${(await fs.promises.readFile(vault.files.abs(rel))).toString("base64")}`;
}
