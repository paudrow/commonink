// A note as final, static HTML: what print, the HTML export and Word show (and later, read-only links
// to a note, #12). It looks like live preview with the markup hidden: task chips, highlighted code,
// drawn math and diagrams. Widgets and boards become a snapshot of what they show now, embedded notes
// are drawn in place, and videos and posts become link cards. Frontmatter is left out unless asked for,
// and collapsed sections open unless asked to stay closed.
//
// It starts from rendered markdown (render.ts, sanitized for the page as ever), adds what only this
// module draws, and runs the whole result through DOMPurify last. That last pass allows what the
// pieces we add need (KaTeX's layout styles, a diagram's SVG and its <style>) and nothing that runs.
import DOMPurify from "dompurify";
import type { FeedItem, Task, TodayView } from "../api.ts";
import { el } from "../dom.ts";
import { embedKindOf, renderMarkdown, sectionOf } from "../render.ts";
import { staticCodeBlock } from "../code.ts";
import { endTags, hydrateTaskChips, metaChips, withTaskChips } from "../taskChips.ts";
import { resolveEmbed } from "../embeds/providers.ts";
import type { Rendered } from "../mathRender.ts";
import { parseDirective, type Directive } from "../../../src/core/directive.ts";
import { boardsIn, summaryOf, type Board } from "../../../src/core/kanban.ts";
import { splitFrontmatter } from "../../../src/core/parse.ts";
import { toQuery, type NoteQuery } from "../../../src/core/query.ts";
import { parseTask } from "../../../src/core/tasks.ts";
import { safeDecode } from "../../../src/core/uri.ts";

/** A note found for a link or an embed: where it is, its markdown, and its web address (null if it has none). */
export interface StaticNote {
  path: string;
  title: string;
  content: string;
  url: string | null;
}

/** Where a static render gets what the note refers to. The app reads it over its API. */
export interface StaticSources {
  /** The note that `target` (as written in the note at `from`) names, or null. */
  note(target: string, from: string): Promise<StaticNote | null>;
  /** Just the web address of the note `target` names (a link), or null. */
  url(target: string, from: string): Promise<string | null>;
  /** Tasks, as `::tasks` asks for them. */
  tasks(q: { folder?: string; note?: string; tag?: string; assignee?: string; due?: string }): Promise<Task[]>;
  /** Notes, as `::query` asks for them. */
  feed(q: NoteQuery & { limit: number }): Promise<FeedItem[]>;
  today(): Promise<TodayView>;
  /** KaTeX's renderer (math.ts's, or mathRender.ts itself). */
  math(): Promise<{ renderTex(tex: string, display: boolean): Rendered }>;
  /** A ```mermaid diagram as sanitized SVG; without it, a diagram shows as its code. */
  diagram?(code: string): Promise<string>;
  /** An image as a data: URL, for a file that carries its images; without it, images keep their address. */
  image?(src: string): Promise<string | null>;
}

export interface StaticOptions {
  /** Show the note's properties (frontmatter) as a table at the top. */
  frontmatter?: boolean;
  /** Leave collapsed sections (`<details>`) closed; by default they print open. */
  keepFolds?: boolean;
  /** "katex": KaTeX's own HTML, for print in the app (its stylesheet and fonts are loaded); "mathml": the browser's MathML, for a file. */
  math?: "katex" | "mathml";
}

/** Embedded notes are drawn this many levels deep; deeper ones become links. */
const MAX_DEPTH = 2;
/** The most tasks or notes a widget's snapshot lists. */
const MAX_ROWS = 200;

/** The note at `path` as sanitized static HTML (the inside of an `.st-doc`). */
export async function renderStatic(path: string, md: string, sources: StaticSources, opts: StaticOptions = {}): Promise<string> {
  const root = await build(path, md, sources, opts, 0, new Set([path]));
  await finish(root, path, sources, opts);
  return DOMPurify.sanitize(root.innerHTML, FINAL);
}

/**
 * What the last pass lets through: rendered markdown (already sanitized for notes), and what this
 * module adds to it: KaTeX's HTML and MathML (its styles already cut down to layout by mathRender.ts),
 * a diagram's SVG with its scoped <style>, chips' icons. Nothing that runs, submits or embeds a page.
 */
const FINAL = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  FORBID_TAGS: ["form", "button", "textarea", "select", "option", "iframe", "frame", "frameset", "object", "embed", "script", "base", "meta", "link", "portal"],
  FORBID_ATTR: ["popover", "popovertarget", "popovertargetaction", "action", "formaction", "autofocus"],
};

/** The note's own content: markdown rendered, then its widgets, boards and embeds swapped for static versions. */
async function build(path: string, md: string, src: StaticSources, opts: StaticOptions, depth: number, seen: Set<string>): Promise<HTMLElement> {
  const { data, body } = splitFrontmatter(md);
  const widgets: Directive[] = [];
  const { md: marked, tasks } = withTaskChips(slotWidgets(body, widgets));
  const root = el("div", { class: "st-body", html: renderMarkdown(marked, path, { boards: true }) });
  hydrateTaskChips(root, tasks);
  const boards = boardsIn(body);
  await Promise.all([
    ...[...root.querySelectorAll<HTMLElement>(".kb-slot[data-board]")].map(async (slot) => {
      const board = boards[Number(slot.dataset.board)];
      slot.replaceWith(board ? staticBoard(board, path) : el("div"));
    }),
    ...[...root.querySelectorAll<HTMLElement>(".st-slot[data-slot]")].map(async (slot) => {
      const d = widgets[Number(slot.dataset.slot)];
      slot.replaceWith(d ? await snapshot(d, path, src) : el("div"));
    }),
    ...[...root.querySelectorAll<HTMLAnchorElement>('a[href^="quire:"]')].filter(isEmbed).map((a) => embed(a, path, src, opts, depth, seen)),
  ]);
  if (opts.frontmatter && Object.keys(data).length) root.prepend(properties(data));
  return root;
}

/** Once the whole tree is built: code, math, diagrams, links, images and cards, everywhere in it. */
async function finish(root: HTMLElement, path: string, src: StaticSources, opts: StaticOptions) {
  for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) box.setAttribute("disabled", "");
  if (!opts.keepFolds) for (const d of root.querySelectorAll("details")) d.setAttribute("open", "");
  // In-page links (`[see](#risks)`, footnotes) point at ids with DOMPurify's `user-content-` prefix,
  // as rendered markdown's do in the app (gfm.ts followInPage), so they work in a file and a PDF.
  const ids = new Set([...root.querySelectorAll("[id]")].map((n) => n.id));
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const id = `user-content-${safeDecode(a.getAttribute("href")!.slice(1)).replace(/^user-content-/, "")}`;
    if (ids.has(id)) a.setAttribute("href", `#${id}`);
  }
  const math = root.querySelector("[data-tex]") ? await src.math() : null;
  for (const node of root.querySelectorAll<HTMLElement>("[data-tex]")) {
    const tex = node.dataset.tex ?? "";
    const display = node.dataset.display !== undefined;
    node.removeAttribute("data-tex");
    node.dataset.latex = tex; // for Word, which gets the formula's source (export/docx.ts)
    node.classList.add("math", display ? "math-display" : "math-inline");
    const out = math!.renderTex(tex, display);
    if ("html" in out) {
      node.innerHTML = out.html; // sanitized by mathRender.ts, and again below
      if (opts.math === "mathml") node.querySelectorAll(".katex-html").forEach((n) => n.remove());
    } else {
      node.classList.add("math-error");
      node.textContent = display ? tex : `$${tex}$`;
      node.title = out.error;
    }
  }
  await Promise.all([
    ...[...root.querySelectorAll<HTMLElement>("pre[data-code-info]")].map(async (pre) => {
      const info = pre.dataset.codeInfo ?? "";
      const code = (pre.textContent ?? "").replace(/\n$/, "");
      if (/^mermaid\b/i.test(info) && src.diagram) {
        const svg = await src.diagram(code).catch(() => null);
        if (svg) return pre.replaceWith(el("figure", { class: "st-diagram", html: svg }));
      }
      pre.replaceWith(await staticCodeBlock(code, info));
    }),
    ...[...root.querySelectorAll<HTMLAnchorElement>('a[href^="quire:"]')].map(async (a) => {
      const url = await src.url(safeDecode(a.getAttribute("href")!.slice(6)), path).catch(() => null);
      if (url) a.setAttribute("href", url);
      else a.replaceWith(el("span", { class: "st-link" }, ...a.childNodes));
    }),
    ...[...root.querySelectorAll<HTMLImageElement>("img[src]")].map(async (img) => {
      if (!src.image || img.getAttribute("src")!.startsWith("data:")) return;
      const data = await src.image(img.getAttribute("src")!).catch(() => null);
      if (data) img.setAttribute("src", data);
    }),
    ...bareLinks(root).map(async (p) => {
      const a = p.querySelector("a")!;
      const url = a.getAttribute("href")!;
      const info = await resolveEmbed(url).catch(() => null);
      const kind = info?.label ?? (embedKindOf(url, true) === "video" ? "Video" : "Link");
      p.replaceWith(linkCard(kind, new URL(url).hostname.replace(/^www\./, ""), url));
    }),
  ]);
}

// ------------------------------------------------------------------ widgets

/** Widgets are one line each: swap each for a slot (an HTML block of its own) that `snapshot` fills. Lines in fenced code stay. */
function slotWidgets(md: string, found: Directive[]): string {
  let fence: string | null = null;
  return md
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
      const d = fence || f ? null : parseDirective(line);
      if (!d) return line;
      found.push(d);
      return `\n<div class="st-slot" data-slot="${found.length - 1}"></div>\n`;
    })
    .join("\n");
}

const box = (title: string, ...children: Array<Node | string | null>) => el("div", { class: "st-widget" }, el("div", { class: "st-widget-title" }, title), ...children);
const empty = (text: string) => el("div", { class: "st-empty" }, text);

/** What a widget shows right now, as plain content. Interactive ones (timers, the calendar) say what they are. */
async function snapshot(d: Directive, path: string, src: StaticSources): Promise<HTMLElement> {
  const a = d.args;
  const label = a.label ? ` · ${a.label}` : "";
  switch (d.name) {
    case "tasks": {
      const show = a.status === "done" || a.status === "all" ? a.status : "open";
      const all = await src.tasks({ folder: a.folder, note: a.note, tag: a.tag, assignee: a.assignee, due: a.due }).catch(() => [] as Task[]);
      const tasks = all.filter((t) => show === "all" || t.done === (show === "done")).slice(0, MAX_ROWS);
      return box(`Tasks${label}`, tasks.length ? taskGroups(tasks, a.group === "none" ? null : "note") : empty(show === "done" ? "No finished tasks." : "Nothing to do."));
    }
    case "today": {
      const v = await src.today().catch(() => null);
      const sections = v?.sections.filter((s) => s.tasks.length) ?? [];
      return box(`Today${label}`, sections.length ? el("div", {}, ...sections.map((s) => el("div", {}, el("div", { class: "st-group" }, s.title), taskList(s.tasks, true)))) : empty("Nothing due today."));
    }
    case "query": {
      const q = toQuery(a);
      const limit = Math.min(q.limit ?? 6, MAX_ROWS);
      const items = (await src.feed({ ...q, limit: limit + 1 }).catch(() => [] as FeedItem[])).filter((i) => i.path !== path).slice(0, limit);
      return box(`Notes${label}`, items.length ? el("ul", {}, ...items.map((i) => el("li", {}, noteLink(i.path, i.title), i.excerpt ? el("span", { class: "st-note" }, ` — ${firstLine(i.excerpt)}`) : null))) : empty("No notes match."));
    }
    case "kanban": {
      const n = a.note ? await src.note(a.note, path).catch(() => null) : null;
      const board = n ? boardsIn(n.content)[Math.max(1, Math.floor(Number(a.board)) || 1) - 1] : undefined;
      return board ? box(`Board · ${n!.title}`, staticBoard(board, n!.path)) : box("Board", empty(a.note ? `No board in ${a.note}.` : "No note named for this board."));
    }
    case "timer":
      return box(`Timer${label}`, el("div", { class: "st-note" }, a.duration ? `${a.duration} timer` : "Timer"));
    case "stopwatch":
      return box(`Stopwatch${label}`, el("div", { class: "st-note" }, "Stopwatch"));
    case "calendar":
      return box(`Calendar${label}`, el("div", { class: "st-note" }, `Daily notes in ${a.folder ?? "Journal"}`));
    default:
      return el("div"); // the getting-started guide, and anything unknown: nothing on paper
  }
}

/** Tasks under the notes they're in (or as one list). */
function taskGroups(tasks: Task[], by: "note" | null): HTMLElement {
  if (!by) return taskList(tasks, false);
  const groups = new Map<string, Task[]>();
  for (const t of tasks) groups.set(t.path, [...(groups.get(t.path) ?? []), t]);
  return el("div", {}, ...[...groups].map(([p, ts]) => el("div", {}, el("div", { class: "st-group" }, noteLink(p, ts[0].title)), taskList(ts, false))));
}

function taskList(tasks: Task[], withNote: boolean): HTMLElement {
  return el(
    "ul",
    { class: "contains-task-list" },
    ...tasks.map((t) =>
      el(
        "li",
        { class: "task-list-item" },
        el("input", { type: "checkbox", disabled: true, checked: t.done }),
        " ",
        inline(t.summary, t.path, t.done),
        ...metaChips(t.meta, t.done, endTags(t.summary, t.meta.tags)),
        withNote ? el("span", { class: "st-note" }, " · ", noteLink(t.path, t.title)) : null,
      ),
    ),
  );
}

/** A line of markdown (a task's words, a card) drawn inline, links and all. */
function inline(md: string, from: string, done = false): HTMLElement {
  const html = renderMarkdown(md, from);
  const span = el("span", { class: done ? "is-done-text" : "" });
  const p = el("div", { html });
  span.append(...(p.firstElementChild?.tagName === "P" ? p.firstElementChild.childNodes : p.childNodes));
  return span;
}

/** A link to a note by its path, which `finish` points at the note's web address. */
const noteLink = (path: string, title: string) => el("a", { href: `quire:${encodeURIComponent(path)}` }, title);

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim().slice(0, 140) ?? "";

/** A board as its columns side by side, each with its cards and their chips. */
function staticBoard(board: Board, from: string): HTMLElement {
  return el(
    "div",
    { class: "st-board" },
    ...board.columns.map((c) =>
      el(
        "div",
        { class: "st-column" },
        el("div", { class: "st-column-title" }, c.title, el("span", { class: "n" }, ` ${c.cards.length}`)),
        ...c.cards.map((card) => {
          const task = parseTask(`- [${card.checked ? "x" : " "}] ${card.text}`);
          const done = card.checked === true || c.done;
          return el("div", { class: `st-cardline${done ? " is-done" : ""}` }, inline(summaryOf(card.text), from), ...(task ? metaChips(task.meta, done, endTags(task.summary, task.meta.tags)) : []));
        }),
      ),
    ),
  );
}

// ------------------------------------------------------------------ embeds, links and cards

/** Rendered markdown writes `![[x]]` as a "↳ x" link to `quire:x` (see render.ts). */
const isEmbed = (a: HTMLAnchorElement) => !!a.textContent?.startsWith("↳ ");

/** An embedded note drawn in place (to MAX_DEPTH, and never inside itself); any other embed as a card. */
async function embed(a: HTMLAnchorElement, from: string, src: StaticSources, opts: StaticOptions, depth: number, seen: Set<string>) {
  const target = safeDecode(a.getAttribute("href")!.slice(6));
  const [name, heading] = target.split("#");
  const kind = embedKindOf(name);
  const p = a.parentElement;
  const put = (node: HTMLElement) => (p?.tagName === "P" && p.childNodes.length === 1 ? p.replaceWith(node) : a.replaceWith(node));
  if (kind !== "note") {
    const url = await src.url(name, from).catch(() => null);
    return put(linkCard(kind === "html" ? "HTML page" : kind === "data" ? "Data" : kind === "video" ? "Video" : "File", name, url));
  }
  const n = await src.note(name, from).catch(() => null);
  if (!n) return put(el("p", { class: "st-note" }, `↳ ${target} (not found)`));
  if (depth >= MAX_DEPTH || seen.has(n.path)) return put(linkCard("Note", n.title + (heading ? ` › ${heading}` : ""), n.url));
  const md = heading ? sectionOf(n.content, heading) : n.content;
  const inner = await build(n.path, md, src, { ...opts, frontmatter: false }, depth + 1, new Set([...seen, n.path]));
  put(el("section", { class: "st-embed" }, el("div", { class: "st-embed-title" }, n.title + (heading ? ` › ${heading}` : "")), inner));
}

/** A card for something paper can't play or show: what it is, a name, and where to find it. */
function linkCard(kind: string, title: string, url: string | null): HTMLElement {
  return el("div", { class: "st-card" }, el("span", { class: "st-card-kind" }, kind), el("span", { class: "st-card-title" }, title), url ? el("a", { href: url }, url) : null);
}

/** Paragraphs that are only a pasted web address: live preview embeds these (a video, a post) or shows a link card. */
function bareLinks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("p")].filter((p) => {
    if (p.childNodes.length !== 1 || p.firstElementChild?.tagName !== "A") return false;
    const href = p.firstElementChild.getAttribute("href") ?? "";
    return /^https?:\/\//i.test(href) && p.textContent?.trim() === href;
  });
}

/** The note's properties (frontmatter), as a small table. */
function properties(data: Record<string, string>): HTMLElement {
  return el("table", { class: "st-props" }, el("tbody", {}, ...Object.entries(data).map(([k, v]) => el("tr", {}, el("th", {}, k), el("td", {}, v)))));
}
