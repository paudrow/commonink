// Rendering untrusted note content. Anything an agent can write is treated as hostile:
// markdown goes through DOMPurify before it touches our origin, and HTML notes only ever
// run inside a sandboxed iframe with an opaque origin (no API access, no cookies, no parent DOM).
import { marked } from "marked";
import DOMPurify from "dompurify";
import { assetUrl } from "./api.ts";
import { currentScheme } from "./dom.ts";
import { isEmbeddable } from "./embeds/providers.ts";
import { boardsIn } from "../../src/core/kanban.ts";
import { SANDBOX_PATH } from "../../src/core/sandbox.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { headingName, headingText } from "../../src/core/prose.ts";

export { currentScheme };

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO = /\.(mp4|webm)$/i;

export type EmbedKind = "note" | "image" | "video" | "html" | "social" | "bookmark" | "data";

/**
 * What an embed target renders as. `bare` is a URL alone on its own line (a pasted link):
 * known providers embed, media files show inline, anything else becomes a link card.
 */
export function embedKindOf(target: string, bare = false): EmbedKind {
  const clean = target.replace(/[#?].*$/, "");
  if (/^https?:\/\//i.test(target)) {
    if (isEmbeddable(target)) return "social";
    if (IMAGE.test(clean)) return "image";
    if (VIDEO.test(clean)) return "video";
    return bare ? "bookmark" : "image";
  }
  if (IMAGE.test(clean)) return "image";
  if (VIDEO.test(clean)) return "video";
  if (/\.html?$/i.test(clean)) return "html";
  if (/\.(csv|json|txt)$/i.test(clean)) return "data";
  return "note";
}

/** Cut a note down to one heading's section (for ![[Note#Heading]]). */
export function sectionOf(md: string, heading: string): string {
  const lines = md.split("\n");
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => {
    const m = l.match(/^#{1,6}[ \t]+(.*)$/);
    return !!m && headingName(headingText(m[1])).toLowerCase() === want;
  });
  if (start < 0) return md;
  const level = lines[start].match(/^#+/)![0].length;
  // A board's column ends with the board.
  let end = boardsIn(md).find((b) => b.from < start && start < b.close)?.close ?? lines.length;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const SAFE_URI = /^(?:(?:https?|mailto|quire):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * What note content may be as HTML. No styles or forms. Its ids and names are prefixed, so a note
 * can't stand in for the app's own elements (`#backlinks`), and it can't put itself in the top
 * layer as a popover.
 */
export const NOTE_HTML = {
  ALLOWED_URI_REGEXP: SAFE_URI,
  FORBID_TAGS: ["style", "form"],
  FORBID_ATTR: ["style", "popover", "popovertarget", "popovertargetaction"],
  SANITIZE_NAMED_PROPS: true,
};

/** Markdown to safe HTML. `boards` leaves a slot for each Kanban board to draw a live board in (see hydrateBoards); otherwise a board shows as its headings and lists. */
export function renderMarkdown(md: string, from: string, opts: { boards?: boolean } = {}): string {
  const body = boardSlots(md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""), !!opts.boards);
  const pre = body
    // Each class leaves out "[" so no pattern backtracks across a long line of them.
    .replace(/!\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g, (_m, target: string) => {
      const kind = embedKindOf(target);
      if (kind === "image") return `![${target}](${assetUrl(target, from)})`;
      return `[↳ ${target}](quire:${encodeURIComponent(target)})`;
    })
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g, (_m, target: string, alias?: string) => `[${alias ?? target.replace(/#/, " › ")}](quire:${encodeURIComponent(target)})`)
    .replace(/!\[([^[\]]*)\]\((?!https?:|\/)([^()\s]+)\)/g, (_m, alt, src) => `![${alt}](${assetUrl(safeDecode(src), from)})`);
  // marked recurses once per ">", so thousands of them overflow the stack: 20 levels is plenty.
  const flat = pre.replace(/^((?:[ \t]*>){20})(?:[ \t]*>)+/gm, "$1");
  const html = marked.parse(flat, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, NOTE_HTML);
}

function boardSlots(md: string, slots: boolean): string {
  const boards = boardsIn(md);
  if (!boards.length) return md;
  const lines = md.split("\n");
  boards.forEach((b, i) => {
    if (slots) lines.fill("", b.from, b.close + 1).splice(b.from, 1, `<div class="kb-slot" data-board="${i}"></div>`);
    else [lines[b.from], lines[b.close]] = ["", ""];
  });
  return lines.join("\n");
}

/** Render an HTML note in a sandbox. With autoHeight the frame reports its height via postMessage. */
export function sandboxFrame(html: string, opts: { autoHeight?: boolean; title?: string } = {}): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = opts.title ?? "HTML note";
  frame.style.colorScheme = currentScheme();
  if (opts.autoHeight) {
    frame.dataset.autoheight = "";
    frame.setAttribute("loading", "lazy"); // embeds only; the full-page preview should paint at once
  }
  const reporter = opts.autoHeight
    ? `<script>(()=>{const p=()=>parent.postMessage({quireFrameHeight:document.documentElement.scrollHeight},"*");new ResizeObserver(p).observe(document.documentElement);addEventListener("load",p);p()})()</script>`
    : "";
  // Not srcdoc: that would inherit the app's CSP, which only lets our own scripts run. The sandbox
  // page asks for its HTML each time it loads (moving a frame in the DOM reloads it).
  sandboxHtml.set(frame, html + reporter);
  frame.src = SANDBOX_PATH;
  return frame;
}

const sandboxHtml = new WeakMap<HTMLIFrameElement, string>();

window.addEventListener("message", (e) => {
  if ((e.data as { quireSandbox?: unknown })?.quireSandbox === "ready") {
    for (const f of document.querySelectorAll<HTMLIFrameElement>("iframe")) {
      if (f.contentWindow === e.source && sandboxHtml.has(f)) f.contentWindow?.postMessage({ quireHtml: sandboxHtml.get(f) }, "*");
    }
    return;
  }
  const h = (e.data as { quireFrameHeight?: unknown })?.quireFrameHeight;
  if (typeof h !== "number") return;
  for (const f of document.querySelectorAll<HTMLIFrameElement>("iframe[data-autoheight]")) {
    if (f.contentWindow === e.source) {
      const px = `${Math.min(Math.max(h, 60), 1400)}px`;
      if (f.style.height !== px) {
        f.style.height = px;
        f.dispatchEvent(new CustomEvent("quire-resize", { bubbles: true }));
      }
    }
  }
});

// A link in note content never replaces the app (a look-alike sign-in page could stand in for it).
// Where nothing else handled the click, an http(s) link opens in a new tab and any other kind
// except mailto: does nothing.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.protocol === "mailto:" || a.origin === location.origin) return;
  e.preventDefault();
  if (/^https?:$/.test(a.protocol)) window.open(a.href, "_blank", "noopener,noreferrer");
});
