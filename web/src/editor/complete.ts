// Typing helpers: `@` mentions, `[[` links, `#` tags, `:` emoji, `/` tools, and smart link pasting.
import { autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fileUrl, type NoteMeta, type TagCount } from "../api.ts";
import { assetIcon, assetType } from "../assetKinds.ts";
import { displayName, icon } from "../dom.ts";
import { fuzzyScore } from "../fuzzy.ts";
import { newId, serializeDirective } from "../widgets/args.ts";
import { pendingConfig, WIDGETS } from "../widgets/index.ts";
import { editorContext } from "./blocks.ts";
import { NEW_BOARD } from "../../../src/core/kanban.ts";
import { wrapInDetails } from "../../../src/core/details.ts";
import { taskPeople } from "../taskChipEditors.ts";
import { taskTokenSource } from "./taskComplete.ts";
import { inTaskText } from "./taskEdit.ts";
import { emojiMatches } from "../../../src/core/emoji.ts";
import { did } from "../events.ts";
import { slashUsed } from "./lineHint.ts";
import { formatKeys } from "../keys.ts";

interface Option extends Completion {
  icon?: string;
  /** An image to show instead of the icon (for image assets). */
  thumb?: string;
  /** An emoji to show instead of the icon. */
  emoji?: string;
}

const NOT_PROSE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "Frontmatter", "FrontmatterContent", "HTMLBlock", "CommentBlock", "URL", "Autolink", "WikiLink", "Embed"]);
function inProse(state: EditorState, pos: number): boolean {
  for (let n: any = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (NOT_PROSE.has(n.name)) return false;
  return true;
}

const iconOf = (n: NoteMeta) => (n.kind === "html" ? "html" : n.kind === "asset" ? assetIcon(n.path) : "file");
const folderOf = (p: string) => p.split("/").slice(0, -1).join("/");

/** The shortest name a [[link]] needs to resolve to this note. */
function linkName(n: NoteMeta, all: NoteMeta[]): string {
  const name = n.kind === "md" ? displayName(n.path) : n.path.split("/").pop()!;
  const clash = all.filter((o) => o !== n && (o.kind === "md" ? displayName(o.path) : o.path.split("/").pop()) === name).length;
  return clash ? n.path.replace(/\.(md|markdown)$/i, "") : name;
}

/** Best matches first; archived notes always after active ones. */
function rankNotes(notes: NoteMeta[], query: string): NoteMeta[] {
  const archivedLast = (a: NoteMeta, b: NoteMeta) => Number(a.path.startsWith("Archive/")) - Number(b.path.startsWith("Archive/"));
  if (!query) return [...notes].sort((a, b) => archivedLast(a, b) || b.mtime - a.mtime);
  return notes
    .map((n) => ({ n, s: Math.max(fuzzyScore(query, n.title), fuzzyScore(query, displayName(n.path)), fuzzyScore(query, n.path) - 40) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => archivedLast(a.n, b.n) || b.s - a.s)
    .map((x) => x.n);
}

// ------------------------------------------------------------------ @ mentions

/**
 * A source of things you can @-mention. Notes today; people plug in here later
 * (e.g. { section: "People", search: (q) => members matching q, insert: (m) => `@${m.handle}` }).
 */
interface MentionProvider {
  section: string;
  rank: number;
  search(query: string, state: EditorState): Array<{ label: string; detail?: string; icon: string; insert: string }>;
}

const noteMentions: MentionProvider = {
  section: "Notes",
  rank: 0,
  search(query, state) {
    const ctx = state.facet(editorContext);
    const all = ctx.notes().filter((n) => n.kind !== "asset");
    return rankNotes(all.filter((n) => n.path !== ctx.path), query)
      .slice(0, 12)
      .map((n) => ({ label: n.title, detail: folderOf(n.path), icon: iconOf(n), insert: `[[${linkName(n, all)}]]` }));
  },
};

const MENTIONS: MentionProvider[] = [noteMentions];

/** People already on tasks, for `@` on a task line; fetched at most every half minute. */
let people: { at: number; list: Promise<string[]> } | null = null;
const peopleOnTasks = () => {
  if (!people || Date.now() - people.at > 30_000) people = { at: Date.now(), list: taskPeople() };
  return people.list;
};

async function mentionSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(/(?:^|[\s([{"'])@[^@\n]{0,40}$/);
  if (!m) return null;
  const at = m.from + m.text.indexOf("@");
  if (!inProse(ctx.state, at)) return null;
  const query = ctx.state.sliceDoc(at + 1, ctx.pos);
  // On a task line, @ is first a person to put on it: someone already on a task, or a new name.
  const onTask = inTaskText(ctx.state, at);
  const found = onTask ? (await peopleOnTasks().catch(() => [])).filter((p) => p.toLowerCase().includes(query.toLowerCase())) : [];
  const person = (name: string): Option => ({
    label: `@${name}`,
    icon: "at",
    section: { name: "People", rank: -1 },
    apply: (view: EditorView, _c: Completion, _from: number, to: number) =>
      view.dispatch({ changes: { from: at, to, insert: `@${name}` }, selection: { anchor: at + name.length + 1 }, userEvent: "input.complete" }),
  });
  const typedName = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(query) && !found.some((p) => p.toLowerCase() === query.toLowerCase());
  const options: Option[] = [...found.slice(0, 8).map(person), ...(onTask && typedName ? [person(query)] : [])];
  options.push(...MENTIONS.flatMap((p) =>
    p.search(query, ctx.state).map((r) => ({
      label: r.label,
      detail: r.detail,
      icon: r.icon,
      section: { name: p.section, rank: p.rank },
      apply: (view: EditorView, _c: Completion, _from: number, to: number) => {
        view.dispatch({ changes: { from: at, to, insert: r.insert }, selection: { anchor: at + r.insert.length }, userEvent: "input.complete" });
        did("link");
      },
    })),
  ));
  if (!options.length && /\s/.test(query)) return null; // "@ " in ordinary prose: get out of the way
  return { from: at + 1, options, filter: false };
}

// ------------------------------------------------------------------ [[ links

function linkSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/!?\[\[[^\]\n|#]*$/);
  if (!m) return null;
  const embed = m.text.startsWith("!");
  const start = m.from + (embed ? 3 : 2);
  const env = ctx.state.facet(editorContext);
  const all = env.notes();
  const query = ctx.state.sliceDoc(start, ctx.pos);
  const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
  const options: Option[] = rankNotes(all.filter((n) => embed || n.kind !== "asset"), query)
    .slice(0, 30)
    .map((n) => {
      const name = linkName(n, all);
      return {
        label: n.kind === "md" ? n.title : name,
        detail: n.kind === "md" && n.title !== name ? name : folderOf(n.path),
        icon: iconOf(n),
        thumb: n.kind === "asset" && assetType(n.path) === "image" ? fileUrl(n.path) : undefined,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const insert = name + (closed ? "" : "]]");
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + name.length + 2 }, userEvent: "input.complete" });
          if (!embed) did("link");
        },
      };
    });
  return { from: start, options, filter: false };
}

// ------------------------------------------------------------------ : emoji

/**
 * `:` and two letters where a word starts, in prose: emoji shortcodes (GitHub's names). Not in a
 * time (10:30), a URL, or code. The shortcode goes in, so the note reads the same on GitHub.
 */
function emojiSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?<![\w:/]):[a-z0-9_+-]{2,}$/);
  if (!m || !inProse(ctx.state, m.from)) return null;
  // An inline code span still being typed (its closing backtick not there yet) is code too.
  const before = ctx.state.sliceDoc(ctx.state.doc.lineAt(m.from).from, m.from);
  if ((before.match(/`/g)?.length ?? 0) % 2) return null;
  const found = emojiMatches(m.text.slice(1));
  if (!found.length) return null;
  return { from: m.from, filter: false, options: found.map(([name, emoji], i): Option => ({ label: `:${name}:`, emoji, boost: -i, apply: `:${name}:` })) };
}

// ------------------------------------------------------------------ # tags

const uses = (t: TagCount) => t.notes + t.tasks + t.assets;

/** Tags in use that match what's typed after `from`, most used first, each with its full nested path. */
function tagOptions(ctx: CompletionContext, from: number): CompletionResult | null {
  const query = ctx.state.sliceDoc(from, ctx.pos);
  const ranked = ctx.state
    .facet(editorContext)
    .tags()
    .map((t) => ({ t, s: query ? fuzzyScore(query, t.display) : 0 }))
    .filter((x) => x.s >= 0 && x.t.display !== query)
    .sort((a, b) => b.s - a.s || uses(b.t) - uses(a.t));
  if (!ranked.length) return null;
  return {
    from,
    filter: false,
    options: ranked.slice(0, 30).map(({ t }, i) => ({
      label: t.display,
      detail: [t.notes && `${t.notes} note${t.notes === 1 ? "" : "s"}`, t.tasks && `${t.tasks} task${t.tasks === 1 ? "" : "s"}`].filter(Boolean).join(", "),
      icon: "hash",
      boost: -i,
      apply: t.display,
    })) as Option[],
  };
}

/** `#` in prose. Not at the start of a line until a letter follows (that's a heading), and not in a heading. */
function tagSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?<!\S)#[\p{L}\p{N}_/-]*$/u);
  if (!m || !inProse(ctx.state, m.from)) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  if (/^ {0,3}#{1,6}\s/.test(line.text)) return null;
  if (m.text === "#" && !ctx.state.sliceDoc(line.from, m.from).trim()) return null;
  return tagOptions(ctx, m.from + 1);
}

/** The frontmatter `tags:` field: `tags: [a, b`, `tags: a, b`, or a `- item` under `tags:`. */
function frontmatterTagSource(ctx: CompletionContext): CompletionResult | null {
  let inside = false;
  for (let n: any = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent) if (n.name === "Frontmatter") inside = true;
  if (!inside) return null;
  const doc = ctx.state.doc;
  const line = doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  let m = before.match(/^tags:\s*\[?(?:[^,\]]*,\s*)*#?([^,\]\s]*)$/);
  if (!m) {
    m = before.match(/^\s*-\s+#?(\S*)$/);
    let n = line.number - 1;
    while (m && n >= 1 && /^\s*-\s/.test(doc.line(n).text)) n--;
    if (!m || n < 1 || !/^tags:\s*$/.test(doc.line(n).text)) return null;
  }
  return tagOptions(ctx, ctx.pos - m[1].length);
}

// ------------------------------------------------------------------ / tools

interface Tool {
  title: string;
  hint: string;
  icon: string;
  keywords: string;
  section: "Embed" | "Widgets" | "Blocks" | "Insert";
  run(view: EditorView, from: number, to: number): void;
}

/**
 * Replace the typed `/command` with `text`. Block-level content goes on its own line: a newline is
 * added before it if the line already has text, and `own` puts the cursor on a fresh line after it.
 */
function insert(view: EditorView, from: number, to: number, text: string, opts: { cursor?: number; select?: number; own?: boolean; block?: boolean } = {}) {
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const after = view.state.sliceDoc(to, line.to);
  const pre = (opts.block || opts.own) && before.trim() ? "\n" : "";
  const post = opts.own ? "\n" : opts.block && after.trim() ? "\n" : "";
  const anchor = from + pre.length + (opts.cursor ?? text.length) + (opts.own && opts.cursor === undefined ? post.length : 0);
  view.dispatch({
    changes: { from, to, insert: pre + text + post },
    selection: { anchor, head: opts.select !== undefined ? anchor + opts.select : anchor },
    userEvent: "input.complete",
  });
}

const soon = (view: EditorView) => setTimeout(() => startCompletion(view), 0);

function widgetTool(name: string, keywords: string, title?: string): Tool {
  const spec = WIDGETS[name];
  return {
    title: title ?? spec.title,
    hint: spec.hint,
    icon: spec.icon,
    keywords,
    section: "Widgets",
    run(view, from, to) {
      const id = newId();
      pendingConfig.add(id); // open its settings as soon as it renders
      insert(view, from, to, serializeDirective({ name, args: { ...spec.defaults, id } }), { own: true });
    },
  };
}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

const TOOLS: Tool[] = [
  { title: "Embed a note", hint: "Show another note inline", icon: "file", keywords: "embed note transclude include", section: "Embed", run: (v, f, t) => (insert(v, f, t, "![[]]", { cursor: 3, block: true }), soon(v)) },
  { title: "Image or file", hint: "From your assets", icon: "image", keywords: "image picture photo file asset embed pdf", section: "Embed", run: (v, f, t) => (insert(v, f, t, "![[]]", { cursor: 3, block: true }), soon(v)) },
  {
    title: "Upload a file",
    hint: "Image, PDF, audio, video…",
    icon: "upload",
    keywords: "upload file image photo pdf attach attachment",
    section: "Embed",
    run: (v, f, t) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      void embedUploads(v, undefined, f);
    },
  },
  { title: "Link embed", hint: "YouTube, X, Bluesky, Spotify… or any page", icon: "video", keywords: "embed link url youtube video tweet x twitter bluesky mastodon instagram tiktok spotify vimeo loom bookmark", section: "Embed", run: (v, f, t) => insert(v, f, t, "https://", { cursor: 0, select: 8, block: true }) },
  widgetTool("tasks", "tasks todo checklist rollup dashboard open"),
  widgetTool("query", "notes list query dashboard recent folder tag"),
  widgetTool("calendar", "calendar journal daily month diary"),
  widgetTool("timer", "timer countdown pomodoro alarm"),
  widgetTool("stopwatch", "stopwatch count up laps"),
  {
    title: "Collapsible section",
    hint: `<details> · ${formatKeys("Mod-Alt-s")} wraps a selection`,
    icon: "chevron",
    keywords: "collapsible section details summary fold spoiler toggle accordion",
    section: "Blocks",
    run: (v, f, t) => insert(v, f, t, wrapInDetails(""), { cursor: "<details>\n<summary>".length, select: "Details".length, block: true }),
  },
  { title: "Kanban board", hint: "Columns of cards", icon: "kanban", keywords: "kanban board columns cards pipeline trello", section: "Widgets", run: (v, f, t) => insert(v, f, t, NEW_BOARD, { own: true }) },
  widgetTool("kanban", "kanban board embed another note", "Kanban from another note"),
  {
    title: "Diagram",
    hint: "Mermaid: flowcharts, sequences, timelines",
    icon: "divider",
    keywords: "diagram mermaid flowchart chart graph sequence",
    section: "Widgets",
    run: (v, f, t) => insert(v, f, t, "```mermaid\nflowchart LR\n  A[Idea] --> B[Note] --> C[Agent]\n```", { cursor: 58, block: true }),
  },
  { title: "Link to note", hint: "[[Note]]", icon: "link", keywords: "link wikilink note reference", section: "Insert", run: (v, f, t) => (insert(v, f, t, "[[]]", { cursor: 2 }), soon(v)) },
  { title: "Checkbox", hint: "- [ ]", icon: "task", keywords: "todo task checkbox check", section: "Blocks", run: (v, f, t) => insert(v, f, t, "- [ ] ", { block: true }) },
  { title: "Heading 1", hint: "#", icon: "heading", keywords: "heading h1 title", section: "Blocks", run: (v, f, t) => insert(v, f, t, "# ", { block: true }) },
  { title: "Heading 2", hint: "##", icon: "heading", keywords: "heading h2 subtitle", section: "Blocks", run: (v, f, t) => insert(v, f, t, "## ", { block: true }) },
  { title: "Heading 3", hint: "###", icon: "heading", keywords: "heading h3", section: "Blocks", run: (v, f, t) => insert(v, f, t, "### ", { block: true }) },
  { title: "Bulleted list", hint: "-", icon: "list", keywords: "list bullet unordered", section: "Blocks", run: (v, f, t) => insert(v, f, t, "- ", { block: true }) },
  { title: "Numbered list", hint: "1.", icon: "listOrdered", keywords: "list numbered ordered", section: "Blocks", run: (v, f, t) => insert(v, f, t, "1. ", { block: true }) },
  { title: "Quote", hint: ">", icon: "quote", keywords: "quote blockquote citation", section: "Blocks", run: (v, f, t) => insert(v, f, t, "> ", { block: true }) },
  { title: "Code block", hint: "```", icon: "braces", keywords: "code block snippet fence", section: "Blocks", run: (v, f, t) => insert(v, f, t, "```\n\n```", { cursor: 3, block: true }) },
  { title: "Table", hint: "2 × 2", icon: "table", keywords: "table grid columns", section: "Blocks", run: (v, f, t) => insert(v, f, t, "| Column | Column |\n| ------ | ------ |\n|        |        |", { cursor: 2, select: 6, block: true }) },
  { title: "Divider", hint: "---", icon: "divider", keywords: "divider rule separator hr line", section: "Blocks", run: (v, f, t) => insert(v, f, t, "---", { own: true }) },
  { title: "Today's date", hint: today(), icon: "calendar", keywords: "date today day", section: "Insert", run: (v, f, t) => insert(v, f, t, today()) },
  { title: "Current time", hint: "HH:MM", icon: "clock", keywords: "time now clock", section: "Insert", run: (v, f, t) => insert(v, f, t, new Date().toTimeString().slice(0, 5)) },
];
const SECTION_RANK = { Embed: 0, Widgets: 1, Blocks: 2, Insert: 3 };

/** How well `q` matches a tool's words; a whole word ("time" in "Current time") beats the start of a longer one ("Timer"). */
function toolScore(q: string, text: string): number {
  const s = fuzzyScore(q, text);
  const word = ` ${text.toLowerCase()} `.includes(` ${q.toLowerCase()} `);
  return s < 0 || !word ? s : s + 50;
}

export function toolSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/[\w-]*$/);
  if (!m) return null;
  const slash = m.from + m.text.lastIndexOf("/");
  if (!inProse(ctx.state, slash)) return null;
  const q = ctx.state.sliceDoc(slash + 1, ctx.pos);
  const matches = q
    ? TOOLS.map((t) => ({ t, s: Math.max(toolScore(q, t.title), toolScore(q, t.keywords) - 20) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.t)
    : TOOLS;
  if (!matches.length) return null;
  return {
    from: slash,
    filter: false,
    options: matches.map((t, i) => ({
      label: t.title,
      detail: t.hint,
      icon: t.icon,
      boost: -i,
      section: q ? undefined : { name: t.section, rank: SECTION_RANK[t.section] },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => (slashUsed(), t.run(view, from, to), did("slash")),
    })) as Option[],
  };
}

// ------------------------------------------------------------------ pasting links

const URL_ONLY = /^https?:\/\/[^\s<>"]+$/i;

/**
 * Paste a URL and it does the obvious thing: on an empty line it stays a bare URL (which renders as
 * an embed or link card), over selected text it becomes [text](url), and mid-sentence it's a link.
 */
const pasteLinks = EditorView.domEventHandlers({
  paste(event, view) {
    const url = event.clipboardData?.getData("text/plain")?.trim() ?? "";
    if (!URL_ONLY.test(url)) return false;
    const { state } = view;
    const sel = state.selection.main;
    if (!inProse(state, sel.from)) return false;
    const line = state.doc.lineAt(sel.from);
    const selected = state.sliceDoc(sel.from, sel.to);
    const rest = state.sliceDoc(line.from, sel.from) + state.sliceDoc(sel.to, line.to);
    event.preventDefault();
    if (sel.to <= line.to && !rest.trim() && (sel.empty || /^https?:\/\/\S*$/.test(selected))) {
      // Own line → embed / link card. Move to a fresh line so it renders straight away.
      const needsLine = line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() !== "";
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: url + (needsLine ? "\n" : "") },
        selection: { anchor: line.from + url.length + 1 },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
    } else if (!sel.empty && !selected.includes("\n")) {
      const md = `[${selected}](${url})`;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: md }, selection: { anchor: sel.from + md.length }, userEvent: "input.paste" });
    } else {
      view.dispatch(state.replaceSelection(url), { userEvent: "input.paste", scrollIntoView: true });
    }
    return true;
  },
});

// ------------------------------------------------------------------ pasting and dropping files

/**
 * Upload files (or pick some) and embed them at `pos`, each on its own line. A screenshot pasted
 * from the clipboard is just "image.png", so it gets a dated name instead.
 */
async function embedUploads(view: EditorView, files: File[] | undefined, pos: number) {
  const ctx = view.state.facet(editorContext);
  const named = files?.map((f) => (/^image\.\w+$/i.test(f.name) ? new File([f], `Pasted ${stamp()}.${f.name.split(".").pop()}`, { type: f.type }) : f));
  const names = await ctx.upload(named);
  if (!names.length || view.state.facet(editorContext) !== ctx) return; // nothing uploaded, or the note changed
  const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
  const text = (line.text.trim() ? "\n" : "") + names.map((n) => `![[${n}]]`).join("\n") + "\n";
  view.dispatch({ changes: { from: line.to, insert: text }, selection: { anchor: line.to + text.length }, userEvent: "input.paste", scrollIntoView: true });
  view.focus();
}

const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".");

const pasteFiles = EditorView.domEventHandlers({
  paste(event, view) {
    const files = [...(event.clipboardData?.files ?? [])];
    // Copied text often carries a picture of itself too; only a clipboard with no text is a file paste.
    if (!files.length || event.clipboardData?.getData("text/plain")) return false;
    event.preventDefault();
    void embedUploads(view, files, view.state.selection.main.head);
    return true;
  },
  drop(event, view) {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return false;
    event.preventDefault();
    void embedUploads(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head);
    return true;
  },
});

// ------------------------------------------------------------------ extension

export function typingHelpers(): Extension {
  return [completions([toolSource, taskTokenSource, mentionSource, linkSource, tagSource, frontmatterTagSource, emojiSource]), pasteLinks, pasteFiles];
}

function completions(override: CompletionSource[]): Extension {
  return autocompletion({
    override,
    icons: false,
    closeOnBlur: true,
    maxRenderedOptions: 40,
    optionClass: () => "q-option",
    addToOptions: [
      {
        position: 20,
        render: (c) => {
          const o = c as Option;
          if (o.emoji) return Object.assign(document.createElement("span"), { className: "q-emoji", textContent: o.emoji });
          if (!o.thumb) return icon(o.icon ?? "file", 15);
          const img = document.createElement("img");
          img.className = "q-thumb";
          img.src = o.thumb;
          img.alt = "";
          img.loading = "lazy";
          return img;
        },
      },
    ],
  });
}
