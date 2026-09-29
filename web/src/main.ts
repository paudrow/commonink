import "./styles.css";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { api, clientId, connect, favoriteKey, isArchived, isTagFavorite, useWorkspace, whoAmI, ApiError, type Change, type Favorite, type NoteMeta, type Scope, type ServerMsg, type SmartFolder, type TagCount, type TagFavorite } from "./api.ts";
import { normalizeTag } from "../../src/core/tags.ts";
import { decodeTarget, proseLines } from "../../src/core/prose.ts";
import { $, avatar, displayName, el, hueFor, hydrateIcons, icon, isSelf, NOTE_DRAG, setSelfName, timeAgo } from "./dom.ts";
import { createState, linkTargetAt, remote, vimSlot } from "./editor/setup.ts";
import { bumpEmbeds, editorContext } from "./editor/blocks.ts";
import { clearFlash, flashChanges } from "./editor/agentFlash.ts";
import { editsBetween, merge3 } from "./merge.ts";
import { sandboxFrame } from "./render.ts";
import { Palette } from "./palette.ts";
import { NotesPage } from "./notesPage.ts";
import { folderPicker } from "./folderPicker.ts";
import { History } from "./history.ts";
import { Assets } from "./assets.ts";
import { renderTasksPage } from "./tasksView.ts";
import { openQuickAdd } from "./quickAdd.ts";
import { TagsPage } from "./tagsPage.ts";
import { pickWorkspace, renderAccount, showSignIn } from "./account.ts";
import { vaultEvents } from "./events.ts";
import { groupChanges } from "../../src/core/format.ts";
import { formatQuery, parseQuery, type NoteQuery } from "../../src/core/query.ts";
import { smartFolderEditor } from "./smartFolderEditor.ts";
import { clampSide, forget, newLayout, parseLayout, SIDE_CLICK, sideClick, step, visit, type PaneTrail } from "./panes.ts";
import { NOTE_ID, notePath, parseNotePath } from "../../src/core/ids.ts";
import { watchTimers } from "./widgets/timer.ts";

// ------------------------------------------------------------------ state

interface Session {
  /** Stable ID: the note keeps it (and its URL keeps working) through renames and moves. */
  id: string;
  path: string;
  kind: "md" | "html" | "asset";
  title: string;
  base: string; // content as last synced with disk
  baseVersion: string;
  saving: boolean;
  again: boolean;
  timer: number;
  /** Set once the user edits this note. A session that was never edited never writes. */
  edited: boolean;
  /** The pane it's open in. */
  pane: Pane;
}

/**
 * A place a note shows: the main pane (which also shows the pages: Notes, Tasks…) and, split, the
 * side pane. Each has its own editor, note, and back and forward. The focused one (`active`) is
 * the one the top bar, the side panel, the status bar and the address bar follow.
 */
interface Pane {
  index: 0 | 1;
  view: EditorView;
  session: Session | null;
  host: HTMLElement;
  preview: HTMLElement;
  bar: HTMLElement;
  trail: PaneTrail;
}

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`quire.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`quire.${k}`, JSON.stringify(v));
    } catch {}
  },
};

// This PR's first version stored a "Start on Today" choice; Today is the top of Tasks now.
try {
  localStorage.removeItem("quire.startOnToday");
} catch {}

const prefs = {
  vim: store.get("vim", true),
  panel: store.get("panel", true),
  htmlMode: store.get<"preview" | "source">("htmlMode", "preview"),
  /** Folders whose subfolders are showing in the sidebar (they start closed). */
  expanded: new Set<string>(store.get<string[]>("expanded", [])),
  /** Tags whose nested tags are showing in the sidebar (they start closed). */
  tagsOpen: new Set<string>(store.get<string[]>("tagsOpen", [])),
  /** Sidebar sections folded away from their header. Folders start folded: the sidebar leads with tags. */
  folded: { favorites: false, smart: false, folders: true, tags: false, ...store.get<Record<string, boolean>>("folded", {}) } as Record<string, boolean>,
};

let notes: NoteMeta[] = [];
/** Your starred notes, in your order (archived ones too; the sidebar leaves those out). */
let favorites: Favorite[] = [];
let changes: Change[] = [];
/** Every tag in use, for suggestions and filters. */
let tags: TagCount[] = [];
/** Your smart folders (the workspace's shared ones and your own), with live counts. */
let smartFolders: SmartFolder[] = [];

const layoutKey = () => `layout:${workspaceId || "local"}`;
/** How the window was split, and each pane's trail; read again once the workspace is known (see boot). */
let layout = newLayout();
const makePane = (index: 0 | 1, host: HTMLElement, preview: HTMLElement, bar: HTMLElement): Pane => ({
  index,
  view: new EditorView({ parent: host }),
  session: null,
  host,
  preview,
  bar,
  trail: layout.panes[index],
});
const panes: [Pane, Pane] = [makePane(0, $("#editor-host"), $("#html-preview"), $("#main-bar")), makePane(1, $("#side-host"), $("#side-preview"), $("#side-bar"))];
let active = panes[0];
let split = false;
const other = (p: Pane) => panes[1 - p.index];
/** A note opened from a page: in the main pane, or beside it while split. */
const fromPage = (path: string, line?: number, side = false) => void openNote(path, { line, pane: split || side ? panes[1] : panes[0] });
const notesPage = new NotesPage({
  open: fromPage,
  starred: (id) => isStarred(id),
  toggleStar: (path) => void toggleStar(path),
  filtersChanged: () => renderTree(),
  tags: () => tags,
  saveQuery: (anchor, query) => saveSmartFolder(query, "", anchor),
  pinButton: (tag) => pinButton(tag, "chip"),
  openPerson: (assignee) => void showTasks({ assignee }),
  readOnly: () => viewer,
  toast: (t) => toast(t),
  changed: () => {
    api.clearResolveCache();
    void refreshNotes();
  },
});
const historyPage = new History({
  open: (path) => fromPage(path),
  verb: (c) => verb(c),
  toast: (t) => toast(t),
});
const assetsPage = new Assets({
  notes: () => notes,
  upload: (files) => uploadFiles(files),
  open: (path) => fromPage(path),
  archive: (path) => archivePath(path),
  embedName: (path) => embedName(path),
  tags: () => tags,
  refreshTags: () => refreshNotes(),
  toast: (t) => toast(t),
});
const tagsPage = new TagsPage($("#tags-view"), {
  tags: () => tags,
  refresh: () => refreshNotes(),
  openTag: (tag, where) => openTag(tag, where),
  toast: (t) => toast(t),
});
/** The palette's next pick opens to the side (⌘⌥\ with nothing to show there yet). */
let paletteToSide = false;
const palette = new Palette(
  () => notes,
  (path, line) => openNote(path, { line, pane: paletteToSide ? sideOf(active) : active }),
  (name) => createNote(name),
);
function openPalette(side = false) {
  paletteToSide = side;
  palette.open();
}

// ------------------------------------------------------------------ opening notes

const cursors = new Map<string, number>();

/**
 * Open a note in a pane (the focused one by default). A note shows in one pane at a time: if the
 * other pane has it, that pane takes the focus instead. `trail: false` is a step back or forward.
 */
async function openNote(path: string, opts: { line?: number; heading?: string; push?: boolean; pane?: Pane; trail?: boolean; focus?: boolean } = {}) {
  const pane = opts.pane ?? active;
  const beside = other(pane);
  if ((split || pane.index === 1) && beside.session?.path === path) {
    focusPane(beside);
    const line = opts.line ?? (opts.heading ? headingLine(beside, opts.heading) : undefined);
    if (line) goToLine(beside, line);
    return beside.view.focus();
  }
  await flushSave(pane);
  if (pane.session) await nameUntitled(pane.session);
  if (pane.session && pane.session.kind !== "asset") cursors.set(pane.session.path, pane.view.state.selection.main.head);
  const meta = notes.find((n) => n.path === path);
  if (meta?.kind === "asset") return showAssets({ open: meta.path, push: opts.push });

  let note;
  try {
    note = await api.note(path);
  } catch {
    return toast({ text: `Couldn't open ${path}` });
  }
  hideBanner();
  const next: Session = {
    id: note.id,
    path: note.path,
    kind: note.kind,
    title: note.title,
    base: note.content,
    baseVersion: note.version,
    saving: false,
    again: false,
    timer: 0,
    edited: false,
    pane,
  };
  // Build the editor before switching sessions: if this throws, the old note stays open and
  // nothing can be saved into the wrong file.
  try {
    pane.view.setState(
      createState({
        doc: note.content,
        kind: note.kind === "html" ? "html" : "md",
        vim: prefs.vim,
        readOnly: viewer,
        context: {
          path: note.path,
          // Followed from one pane of a split, a link or card opens in the other; Cmd/Ctrl-click opens it to the side.
          openTarget: (target, from, o) => void openTarget(target, from, split || o?.side ? other(pane) : pane),
          createNote,
          notes: () => notes,
          upload: (files) => uploadFiles(files),
          tags: () => tags,
          folders: () => allFolders(),
          openTag,
          openPerson: (assignee) => void showTasks({ assignee }),
          saveSmartFolder,
        },
        onUpdate: (docChanged, fromRemote, state) => onUpdate(next, docChanged, fromRemote, state),
      }),
    );
  } catch (e) {
    console.error(e);
    return showBanner(`Couldn't open ${note.path} in the editor. Reload the page to try again.`);
  }
  pane.session = next;
  pane.trail = opts.trail === false ? { ...pane.trail, note: note.id } : visit(pane.trail, note.id);
  resetVimJumps();
  if (isArchived(note.path)) {
    showBanner("This note is archived. It's hidden from search and the sidebar.", ["Unarchive", () => void archiveCurrent()]);
    $("#banner").classList.add("is-info");
  }
  pane.host.classList.toggle("is-code", note.kind === "html");
  showNoteIn(pane);
  if (pane.index === 1 && !split) setSplit(true);

  const line = opts.line ?? (opts.heading ? headingLine(pane, opts.heading) : undefined);
  if (line) goToLine(pane, line);
  else {
    // Start below the frontmatter so it renders as properties rather than raw YAML.
    const fm = note.kind === "md" ? note.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/) : null;
    const pos = Math.min(cursors.get(note.path) ?? (fm ? fm[0].length : 0), pane.view.state.doc.length);
    pane.view.dispatch({ selection: { anchor: pos } });
    pane.view.scrollDOM.scrollTop = 0;
  }
  // Following a link or a click adds to history; back/forward, renames and old links just fix the URL up.
  if (opts.focus !== false) focusPane(pane, opts.push === false || opts.trail === false ? "replace" : "push");
  else renderPaneBars();
  if (opts.focus !== false && (note.kind === "md" || prefs.htmlMode === "source")) pane.view.focus();
}

/**
 * Give a pane the focus: the address bar, title, top bar, side panel and status bar follow it.
 * `how` is how the address bar changes (push: a new place to go back from).
 */
function focusPane(p: Pane, how: "push" | "replace" = "replace") {
  active = p;
  const s = p.session;
  if (s) {
    setUrl(notePath(s.title, s.id), how);
    document.title = `${s.title} · Common Ink`;
  }
  attachVim();
  renderChrome();
  renderTree();
  renderOutline();
  if (s && s.kind !== "asset") renderStatus(p.view.state);
  refreshBacklinks();
  saveLayout();
}

function saveLayout() {
  layout = { split, side: layout.side, focus: active.index, panes: [panes[0].trail, panes[1].trail] };
  store.set(layoutKey(), layout);
}

/** Show or hide the side pane. Hiding it lets its note go (the caller saves it first). */
function setSplit(on: boolean) {
  split = on;
  document.body.classList.toggle("is-split", on);
  $("#side-pane").hidden = !on;
  $("#pane-divider").hidden = !on;
  $("#main-bar").hidden = !on;
  $("#stage").style.setProperty("--side", `${layout.side * 100}%`);
  if (!on) panes[1].session = null;
  renderPaneBars();
  for (const p of panes) p.view.requestMeasure();
}

/** Close a pane, back to one. Closing the main pane moves the side pane's note into it. */
async function closePane(p: Pane) {
  if (!split) return;
  const side = panes[1];
  await flushSave();
  const moving = p.index === 0 ? side.session : null;
  if (side.session) cursors.set(side.session.path, side.view.state.selection.main.head);
  setSplit(false);
  if (moving) await openNote(moving.path, { pane: panes[0], push: false });
  else focusPane(panes[0]);
  if (panes[0].session && panes[0].session.kind !== "asset") panes[0].view.focus();
}

/** Split the window: the side pane shows the note it last had, else the one the main pane showed before this one, else asks. */
async function openSplit() {
  const main = panes[0].session?.id;
  const want = [panes[1].trail.note, ...[...panes[0].trail.back].reverse()].find((id) => id && id !== main);
  const path = want ? notes.find((n) => n.id === want && n.kind !== "asset")?.path : undefined;
  if (path) await openNote(path, { pane: panes[1] });
  else openPalette(true);
}

/** Where a note opened "to the side" of a pane goes. */
const sideOf = (p: Pane) => (split ? other(p) : panes[1]);

/** The bars over the panes while split: back and forward, the note's name, star, close. */
function renderPaneBars() {
  if (!split) return;
  const page = onPage();
  const label = { notes: "Notes", tasks: "Tasks", history: "History", assets: "Assets", tags: "Tags" };
  for (const p of panes) {
    const s = p.session;
    const btn = (ico: string, title: string, run: () => void, cls = "", disabled = false) =>
      el("button", { type: "button", class: `icon-btn small ${cls}`, title, "aria-label": title, disabled, onclick: (e: Event) => (e.stopPropagation(), run()) }, icon(ico, 14));
    const starred = s ? isStarred(s.id) : false;
    p.bar.replaceChildren(
      btn("back", "Back in this pane", () => void stepPane(p, "back"), "", !p.trail.back.length),
      btn("back", "Forward in this pane", () => void stepPane(p, "forward"), "is-forward", !p.trail.forward.length),
      el("span", { class: "pane-title" }, s ? s.title : p.index === 0 && page ? label[page] : ""),
      el("span", { class: "spacer" }),
      ...(s && s.kind !== "asset" ? [btn(starred ? "starred" : "star", starred ? "Unstar" : "Star", () => void toggleStar(s.path), starred ? "is-on" : "")] : []),
      btn("close", "Close this pane (⌘⌥\\)", () => void closePane(p)),
    );
    p.bar.classList.toggle("is-focused", p === active);
  }
}

/** Go back or forward in one pane, past notes that are gone or open in the other pane. */
async function stepPane(p: Pane, dir: "back" | "forward") {
  let from = p.trail;
  for (let to = step(from, dir); to; to = step(from, dir)) {
    const path = notes.find((n) => n.id === to!.note)?.path;
    if (path && path !== other(p).session?.path) {
      p.trail = to;
      return openNote(path, { pane: p, trail: false });
    }
    from = { ...forget(from, to.note!), note: from.note };
  }
}

/** Point the address bar at `url` (path + query) unless it's already there. */
function setUrl(url: string, how: "push" | "replace" = "push") {
  if (location.pathname + location.search === url) return;
  if (how === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

let unmountTasks: (() => void) | null = null;

function showStage(which: "editor" | "html" | "notes" | "tasks" | "history" | "assets" | "tags") {
  $("#editor-host").hidden = which !== "editor";
  $("#html-preview").hidden = which !== "html";
  $("#assets-view").hidden = which !== "assets";
  $("#notes-view").hidden = which !== "notes";
  $("#tasks-view").hidden = which !== "tasks";
  $("#history-view").hidden = which !== "history";
  $("#tags-view").hidden = which !== "tags";
  if (which !== "tasks") {
    unmountTasks?.();
    unmountTasks = null;
  }

}

/** Put the open note away (saved, named, cursor remembered) before showing a page that isn't a note. */
/** Pages show in the main pane, which then has the focus. */
async function leaveNote() {
  const main = panes[0];
  await flushSave(main);
  if (main.session) await nameUntitled(main.session);
  if (main.session && main.session.kind !== "asset") cursors.set(main.session.path, main.view.state.selection.main.head);
  main.session = null;
  active = main;
  renderPaneBars();
  hideBanner();
  await setFocusMode(false);
  $("#backlink-count").textContent = "";
  $("#backlinks").replaceChildren(el("div", { class: "panel-empty" }, "—"));
}

/** Notes is home: every note, newest first. No note is open while it's showing. */
async function showNotes(opts: { scope?: Scope; filter?: boolean; folder?: string; tag?: string; query?: NoteQuery; push?: boolean } = {}) {
  await leaveNote();
  showStage("notes");
  notesPage.show(opts);
  if (opts.push !== false) setUrl("/notes");
  document.title = "Notes · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

async function showTasks(opts: { tag?: string; assignee?: string; push?: boolean } = {}) {
  await leaveNote();
  showStage("tasks");
  unmountTasks = renderTasksPage($("#tasks-view"), { open: (path, line, side) => void openNote(path, { line, pane: side ? sideOf(panes[0]) : split ? panes[1] : panes[0] }), tags: () => tags }, { tag: opts.tag, assignee: opts.assignee });
  $("#tasks-view").focus({ preventScroll: true });
  if (opts.push !== false) setUrl("/tasks");
  document.title = "Tasks · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** History, optionally for one note, with a change selected (e.g. from the activity list). */
async function showHistory(opts: { note?: string | null; select?: number; push?: boolean } = {}) {
  await leaveNote();
  showStage("history");
  await historyPage.show({ note: opts.note ?? null, select: opts.select });
  const id = opts.note ? notes.find((n) => n.path === opts.note)?.id : undefined;
  if (opts.push !== false) setUrl(id ? `/history?note=${id}` : "/history");
  document.title = `${opts.note ? `${displayName(opts.note)} · ` : ""}History · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
}

async function showTags(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("tags");
  tagsPage.show();
  refreshTagsSoon();
  if (opts.push !== false) setUrl("/tags");
  document.title = "Tags · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** Show what carries a tag (and the tags under it): its notes, or its tasks. */
function openTag(tag: string, where: "notes" | "tasks" = "notes") {
  if (where === "tasks") void showTasks({ tag });
  else void showNotes({ scope: "active", query: { tag } });
}

async function showAssets(opts: { open?: string; push?: boolean } = {}) {
  await leaveNote();
  showStage("assets");
  assetsPage.show({ open: opts.open });
  if (opts.push !== false) setUrl("/assets");
  document.title = "Assets · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

// ------------------------------------------------------------------ uploads

/** How to embed an asset: its file name, or its path if another file has the same name. */
function embedName(path: string): string {
  const name = path.split("/").pop()!;
  return notes.some((n) => n.path !== path && n.path.split("/").pop() === name) ? path : name;
}

/** Upload files into assets/; resolves to the names to embed the ones that made it. */
async function uploadFiles(files?: File[]): Promise<string[]> {
  const picked = files ?? (await pickFiles());
  const done: string[] = [];
  for (const f of picked) {
    try {
      done.push((await api.upload(f)).path);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : `Couldn't upload ${f.name}` });
    }
  }
  if (done.length) await refreshNotes();
  return done.map(embedName);
}

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", multiple: true });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

const onPage = () =>
  notesPage.visible ? "notes" : !$("#tasks-view").hidden ? "tasks" : historyPage.visible ? "history" : assetsPage.visible ? "assets" : tagsPage.visible ? "tags" : null;

// ------------------------------------------------------------------ focus mode

let focusMode = false;

/**
 * Just the words: sidebars and chrome step aside and the window goes full screen. Esc stays with
 * the editor (vim) where the browser allows it; otherwise leaving full screen keeps focus mode.
 */
async function setFocusMode(on: boolean) {
  if (on && (!active.session || active.session.kind === "asset")) return;
  if (on === focusMode) return;
  focusMode = on;
  document.body.classList.toggle("is-focus", on);
  $("#focus-btn").replaceChildren(icon(on ? "unfocus" : "focus", 16));
  $("#focus-btn").title = on ? "Leave focus mode (⌘⇧↵)" : "Focus mode (⌘⇧↵)";
  const keyboard = (navigator as any).keyboard;
  try {
    if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await keyboard?.lock?.(["Escape"]);
    } else if (!on && document.fullscreenElement) {
      keyboard?.unlock?.();
      await document.exitFullscreen();
    }
  } catch {
    // Full screen can be refused (e.g. inside a frame); focus mode still works in the window.
  }
  active.view.requestMeasure();
  if (active.session && active.session.kind !== "asset") active.view.focus();
}

/** Archive the open note (or unarchive it, if it's archived). Stays on the note, with Undo. */
async function archiveCurrent() {
  const s = active.session;
  if (!s) return;
  await flushSave();
  const restore = isArchived(s.path);
  renaming = s.path;
  let to: string;
  try {
    to = (await (restore ? api.unarchive([s.path]) : api.archive([s.path]))).moved[0].to;
  } catch {
    return toast({ text: `Couldn't ${restore ? "unarchive" : "archive"} this note` });
  } finally {
    renaming = null;
  }
  await refreshNotes();
  await openNote(to, { push: false });
  toast({
    icon: restore ? "unarchive" : "archive",
    text: `${restore ? "Unarchived" : "Archived"} ${displayName(to)}`,
    actionLabel: "Undo",
    action: async () => {
      const back = (await (restore ? api.archive([to]) : api.unarchive([to]))).moved[0].to;
      await refreshNotes();
      if (active.session?.path === to) {
        await openNote(back, { push: false });
      }
    },
  });
}

async function openTarget(target: string, from?: string, pane = active) {
  const [name, anchor] = target.split("#");
  const path = name ? await api.resolve(name, from) : from;
  const line = anchor?.match(/^L(\d+)$/)?.[1]; // Note#L12 → line 12 (used by widgets)
  if (path) openNote(path, { pane, ...(line ? { line: Number(line) } : { heading: anchor }) });
  else createNote(name);
}

async function createNote(name: string) {
  const clean = name.replace(/[\\:*?"<>|#^[\]]/g, "").replace(/^\/+/, "").trim();
  if (!clean) return;
  const path = /\.(md|html?)$/i.test(clean) ? clean : `${clean}.md`;
  const title = displayName(path).replace(/\.html?$/i, "");
  const body = /\.html?$/i.test(path)
    ? `<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n  <h1>${title}</h1>\n</body>\n</html>\n`
    : `# ${title}\n\n`;
  try {
    const r = await api.create(path, body);
    await refreshNotes();
    await openNote(r.path);
    active.view.dispatch({ selection: { anchor: active.view.state.doc.length } });
    const cm = getCM(active.view);
    if (cm && prefs.vim) Vim.handleKey(cm, "A", "user");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) openNote(e.data.path ?? path);
    else toast({ text: `Couldn't create ${path}` });
  }
}

/** New note button: create "Untitled" right away (in `folder`, if given) and put the cursor in its title. */
async function newNote(folder = "") {
  const dir = folder ? `${folder}/` : "";
  const taken = new Set(notes.map((n) => n.path.toLowerCase()));
  let name = "Untitled";
  for (let i = 2; taken.has(`${dir}${name}.md`.toLowerCase()); i++) name = `Untitled ${i}`;
  try {
    const r = await api.create(`${dir}${name}.md`, "# \n");
    await refreshNotes();
    await openNote(r.path);
    active.view.dispatch({ selection: { anchor: active.view.state.doc.line(1).to } });
    active.view.focus();
    const cm = getCM(active.view);
    if (cm && prefs.vim) Vim.handleKey(cm, "A", "user");
  } catch {
    toast({ text: "Couldn't create a note" });
  }
}

const UNTITLED = /^Untitled( \d+)?$/;
let renaming: string | null = null;

/** Once an "Untitled" note has a real title, rename the file to match (in place, without reloading the editor). */
async function nameUntitled(s: Session) {
  const stem = s.path.split("/").pop()!.replace(/\.md$/i, "");
  if (s.kind !== "md" || !UNTITLED.test(stem) || renaming) return;
  const title = s.pane.view.state.doc.line(1).text.match(/^#\s+(.+?)\s*#*$/)?.[1]?.trim();
  const clean = title?.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean || UNTITLED.test(clean)) return;
  const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/") + 1) : "";
  let target = `${dir}${clean}.md`;
  for (let i = 2; notes.some((n) => n.path.toLowerCase() === target.toLowerCase()); i++) target = `${dir}${clean} ${i}.md`;
  renaming = s.path;
  try {
    const r = await api.move(s.path, target);
    s.pane.view.state.facet(editorContext).path = r.path; // the open editor now belongs to the new path
    s.path = r.path;
    s.title = title!;
    if (s === active.session) {
      renderPaneBars();
      setUrl(notePath(s.title, s.id), "replace");
      document.title = `${s.title} · Common Ink`;
      renderChrome();
    }
    await refreshNotes();
  } catch {
    // leave it as Untitled; the user can rename from the title bar
  } finally {
    renaming = null;
  }
}

function headingLine(pane: Pane, heading: string): number | undefined {
  const want = heading.trim().toLowerCase();
  const doc = pane.view.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const m = doc.line(i).text.match(/^#{1,6}\s+(.*?)\s*#*$/);
    if (m && m[1].toLowerCase() === want) return i;
  }
}

function goToLine(pane: Pane, line: number) {
  const l = pane.view.state.doc.line(Math.min(Math.max(1, line), pane.view.state.doc.lines));
  pane.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 80 }) });
}

// ------------------------------------------------------------------ saving & merging agent edits

function onUpdate(s: Session, docChanged: boolean, fromRemote: boolean, state: EditorState) {
  if (s !== s.pane.session) return;
  if (docChanged && !fromRemote) {
    s.edited = true;
    scheduleSave(s);
  }
  if (s.pane !== active) return;
  renderStatusSoon(state);
  if (docChanged) renderOutlineSoon();
}

/** The save status in the top bar is the focused pane's. */
const status = (s: Session, state: Parameters<typeof setSaveStatus>[0]) => s.pane === active && setSaveStatus(state);

function scheduleSave(s: Session, delay = 600) {
  if (s.kind === "asset") return;
  clearTimeout(s.timer);
  status(s, "editing");
  s.timer = window.setTimeout(() => save(s), delay);
}

async function save(s: Session) {
  const view = s.pane.view;
  if (s !== s.pane.session || !s.edited) return;
  if (view.state.facet(editorContext)?.path !== s.path) {
    console.error(`Refusing to save ${s.path}: the editor is showing a different note`);
    return status(s, "error");
  }
  if (s.saving) return void (s.again = true);
  const content = view.state.doc.toString();
  if (content === s.base) return status(s, "saved");
  s.saving = true;
  status(s, "saving");
  try {
    const r = await api.save(s.path, content, s.baseVersion, content.trim() === "");
    s.base = content;
    s.baseVersion = r.version;
    if (s === s.pane.session && view.state.doc.lineAt(view.state.selection.main.head).number > 1) void nameUntitled(s);
    if (s === s.pane.session) status(s, view.state.doc.toString() === content ? "saved" : "editing");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      applyRemote({ path: s.path, content: e.data.content, version: e.data.version, source: e.data.source ?? "external" });
    } else {
      status(s, "error");
    }
  } finally {
    s.saving = false;
    if (s.again) {
      s.again = false;
      save(s);
    }
  }
}

/** Save now whatever's waiting to be saved, in one pane or both. */
async function flushSave(...only: Pane[]) {
  for (const p of only.length ? only : panes) {
    const s = p.session;
    if (!s || s.kind === "asset" || !s.edited) continue;
    clearTimeout(s.timer);
    if (p.view.state.doc.toString() !== s.base) await save(s);
  }
}

let flashTimer = 0;
/** A new version arrived from disk. Apply it as a diff (keeps cursor, undo, vim state); 3-way merge if we have unsaved typing. */
function applyRemote(m: { path: string; content: string | null; version: string; source: string }) {
  const s = panes.find((p) => p.session?.path === m.path)?.session;
  if (!s || m.content === null || s.kind === "asset") return;
  if (m.version === s.baseVersion) return;
  const view = s.pane.view;
  const doc = view.state.doc.toString();
  if (doc === m.content) {
    s.base = m.content;
    s.baseVersion = m.version;
    return status(s, "saved");
  }
  let target = m.content;
  if (doc !== s.base) {
    const merged = merge3(s.base, doc, m.content);
    if (!merged.ok) return showConflict(s, m);
    target = merged.text;
  }
  const { changes: edits, touched } = editsBetween(doc, target);
  view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashChanges.of({ ranges: touched, source: m.source }) });
  s.base = m.content;
  s.baseVersion = m.version;
  if (target !== m.content) scheduleSave(s, 250);
  else status(s, "saved");
  if (s.kind === "html" && prefs.htmlMode === "preview") renderHtmlPreview(s.pane);
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => view.dispatch({ effects: clearFlash.of(null) }), 6000);
}

function showConflict(s: Session, m: { path: string; content: string | null; version: string; source: string }) {
  const who = m.source === "you" ? "Another window" : m.source === "external" ? "Another program" : m.source;
  clearTimeout(s.timer);
  status(s, "error");
  showBanner(
    `${who} changed ${split ? displayName(s.path) : "this note"} while you were typing, and the edits overlap.`,
    [
      "Keep mine",
      () => {
        s.base = m.content!;
        s.baseVersion = m.version;
        hideBanner();
        scheduleSave(s, 0);
      },
    ],
    [
      "Use theirs",
      () => {
        const view = s.pane.view;
        const { changes: edits, touched } = editsBetween(view.state.doc.toString(), m.content!);
        view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashChanges.of({ ranges: touched, source: m.source }) });
        s.base = m.content!;
        s.baseVersion = m.version;
        hideBanner();
        status(s, "saved");
      },
    ],
  );
}

// ------------------------------------------------------------------ live updates

function onMessage(m: ServerMsg) {
  if (m.type !== "change") vaultEvents.dispatchEvent(new Event("change"));
  switch (m.type) {
    case "note": {
      const meta = notes.find((n) => n.path === m.path);
      if (meta) meta.version = m.version;
      refreshTagsSoon(); // your own typing can add a tag too
      if (m.origin === clientId) return;
      const open = panes.some((p) => p.session?.path === m.path);
      if (open) applyRemote(m);
      for (const p of panes) if (p.session?.kind === "md" && p.session.path !== m.path && embedsPath(p, m.path)) bumpEmbeds(p.view);
      if (!isSelf(m.source) && m.change) {
        toast({
          source: m.source,
          text: `${verb(m.change)} ${displayName(m.path)}`,
          detail: m.change.summary ?? undefined,
          action: open ? undefined : () => openNote(m.path),
        });
      }
      refreshNotesSoon();
      if (active.session && m.path !== active.session.path) refreshBacklinksSoon();
      return;
    }
    case "change": {
      if (!changes.some((c) => c.id === m.change.id)) changes = [m.change, ...changes].slice(0, 60);
      for (const pane of panes) {
        if (["move", "archive", "unarchive"].includes(m.change.op) && m.change.from_path === pane.session?.path && m.change.from_path !== renaming) {
          openNote(m.change.path, { push: false, pane, trail: false, focus: pane === active });
        }
      }
      notesPage.refreshSoon();
      historyPage.refreshSoon();
      renderActivity();
      renderPresence();
      renderTree();
      return;
    }
    case "removed": {
      const path = m.path;
      setTimeout(() => {
        if (panes.some((p) => p.session?.path === path) && !notes.some((n) => n.path === path)) showBanner(`${displayName(path)} was moved or deleted on disk.`);
      }, 400);
      refreshNotesSoon();
      return;
    }
    case "tree":
      notesPage.refreshSoon();
      api.clearResolveCache();
      refreshNotesSoon();
      refreshBacklinksSoon();
      for (const p of panes) if (p.session?.kind === "md") bumpEmbeds(p.view);
      return;
  }
}

function embedsPath(pane: Pane, path: string): boolean {
  const name = displayName(path).toLowerCase();
  const text = pane.view.state.doc.toString().toLowerCase();
  return text.includes(`![[${name}`) || text.includes(`![[${path.toLowerCase()}`) || text.includes(`![[${path.toLowerCase().replace(/\.md$/, "")}`);
}

async function refreshNotes() {
  [notes, favorites, tags, smartFolders] = await Promise.all([api.notes(), api.favorites(), api.tags(), api.smartFolders()]);
  // The open note's title may have changed: keep the slug in its URL current.
  const open = active.session && notes.find((n) => n.id === active.session!.id);
  if (open && parseNotePath(location.pathname)?.id === open.id) setUrl(notePath(open.title, open.id), "replace");
  renderTree();
  assetsPage.refresh();
  tagsPage.refresh();
}
const refreshNotesSoon = debounce(refreshNotes, 120);
const refreshTagsSoon = debounce(async () => {
  tags = await api.tags().catch(() => tags);
  tagsPage.refresh();
  renderTree();
}, 400);

// ------------------------------------------------------------------ favorites

const isStarred = (id: string) => favorites.some((f) => !isTagFavorite(f) && f.id === id);
const isPinned = (tag: string) => favorites.some((f) => isTagFavorite(f) && f.tag === normalizeTag(tag));

/** Star a note, or unstar it if it's starred. */
async function toggleStar(path: string) {
  const on = favorites.some((f) => !isTagFavorite(f) && f.path === path);
  try {
    favorites = await (on ? api.unstar(path) : api.star(path));
  } catch {
    return toast({ text: `Couldn't ${on ? "unstar" : "star"} ${displayName(path)}` });
  }
  renderTree();
  renderChrome();
  notesPage.refreshSoon();
}

// ------------------------------------------------------------------ smart folders

/** A starting name for a query: its tag, folder and words ("#work · Projects"). */
function nameFor(query: string): string {
  const q = parseQuery(query);
  return [q.tag && `#${q.tag}`, q.folder, q.q && `“${q.q}”`].filter(Boolean).join(" · ") || "All notes";
}

/** What the settings forms' tag and folder fields suggest. */
const fieldSources = { tags: () => tags, folders: () => allFolders() };

/** Offer to keep a note query as a smart folder (from the Notes filters or a ::query widget). */
function saveSmartFolder(query: string, name: string, anchor: HTMLElement) {
  smartFolderEditor(anchor, { name: name || nameFor(query), query, shared: !viewer }, {
    canShare: !viewer,
    sources: fieldSources,
    save: async (f) => {
      const saved = await api.saveSmartFolder(f);
      smartFolders = await api.smartFolders();
      renderTree();
      toast({ icon: "folderSearch", text: `Saved ${saved.name}`, detail: saved.shared ? "Everyone in the workspace sees it in their sidebar." : "Only you see it." });
    },
  });
}

/** A new smart folder from scratch (the Smart folders header, or its empty row). Saving opens it. */
function newSmartFolder(anchor: HTMLElement) {
  smartFolderEditor(anchor, { name: "", query: "", shared: !viewer }, {
    canShare: !viewer,
    sources: fieldSources,
    save: async (f) => {
      const saved = await api.saveSmartFolder(f);
      smartFolders = await api.smartFolders();
      await showNotes({ scope: "active", query: parseQuery(saved.query) });
    },
  });
}

/** Pin a tag to Favorites (or take it off): one click, and it's in Favorites beside your notes. */
async function togglePin(tag: string) {
  const on = isPinned(tag);
  try {
    favorites = await (on ? api.unstarTag(tag) : api.starTag(tag));
  } catch (e) {
    return toast({ text: e instanceof Error ? e.message : `Couldn't pin #${tag}` });
  }
  renderTree();
  notesPage.refreshSoon();
}

/** The pin for a tag, on its sidebar row (`row`) or on the Notes tag chip (`chip`). */
function pinButton(tag: string, where: "row" | "chip"): HTMLElement {
  const pinned = isPinned(tag);
  return el(
    "button",
    {
      type: "button",
      class: `${where === "row" ? "row-act" : "chip tag-filter pin-chip"} pin-btn${pinned ? " is-pinned" : ""}`,
      title: pinned ? `Take #${tag} out of Favorites` : `Pin #${tag} to Favorites`,
      "aria-pressed": String(pinned),
      onclick: (e: Event) => (e.stopPropagation(), void togglePin(tag)),
    },
    icon(pinned ? "pinned" : "pin", 13), // filled while it's in Favorites; a click takes it out
    where === "chip" ? (pinned ? "Pinned" : "Pin") : "",
  );
}

/** Saved note queries, each with a live count. Click one to see its notes; the sliders edit it. */
function renderSmartFolders(active: string | null) {
  const rows = smartFolders.map((f) => {
    const edit = el("button", { type: "button", class: "row-act", title: "Edit or delete" }, icon("sliders", 14));
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      smartFolderEditor(edit, f, {
        canShare: !viewer,
        sources: fieldSources,
        save: async (next) => {
          await api.saveSmartFolder(next);
          smartFolders = await api.smartFolders();
          renderTree();
        },
        remove: async () => {
          if (!confirm(`Delete the smart folder ${f.name}${f.shared ? " for everyone in the workspace" : ""}? Its notes don't change.`)) return;
          smartFolders = await api.deleteSmartFolder(f.id);
          renderTree();
          toast({ icon: "folderSearch", text: `Deleted ${f.name}` });
        },
      });
    });
    return el(
      "div",
      {
        class: `tree-row is-file${f.query === active ? " is-active" : ""}`,
        style: { "--depth": "0" },
        title: `${f.query || "Every note"}${f.shared ? "" : " (just you)"}`,
        tabindex: "0",
        onclick: () => void showNotes({ scope: "active", query: parseQuery(f.query) }),
        onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && void showNotes({ scope: "active", query: parseQuery(f.query) }),
      },
      el("span", { class: "chev is-leaf" }), // the chevron column Folders and Tags rows have, so icons and names line up
      icon("folderSearch", 14),
      el("span", { class: "tree-name" }, f.name),
      f.shared ? null : el("span", { class: "sf-mine", title: "Just you" }, icon("user", 11)),
      el("span", { class: "n" }, String(f.count)),
      f.shared && viewer ? null : el("span", { class: "row-actions" }, edit),
    );
  });
  // Empty: one quiet line pointing at the header's +, the one way to add one from here.
  const hint = el("div", { class: "fav-hint" }, "Click ", el("span", { class: "hint-icon", "aria-label": "+" }, icon("plus", 11)), " to save a search here.");
  $("#smart-folders").replaceChildren(...(rows.length ? rows : [hint]));
}

const FAVORITE = "application/x-common-ink-favorite";

/** A pinned tag in Favorites: it opens Notes narrowed to the tag, like the tag's row under Tags. */
function tagFavoriteRow(f: TagFavorite, active: boolean): HTMLElement {
  return el(
    "div",
    {
      class: `tree-row is-tag${active ? " is-active" : ""}`,
      style: { "--depth": "0" },
      title: `Notes tagged #${f.display}`,
      draggable: "true",
      tabindex: "0",
      onclick: () => openTag(f.display),
      onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && openTag(f.display),
      ondragstart: (e: DragEvent) => {
        e.dataTransfer!.setData(FAVORITE, favoriteKey(f));
        document.body.classList.add("is-dragging");
        e.dataTransfer!.effectAllowed = "move";
      },
    },
    icon("hash", 14),
    el("span", { class: "tree-name" }, f.display),
    el("span", { class: "n" }, String(f.notes)),
    el("span", { class: "row-actions" }, pinButton(f.display, "row")),
  );
}

/** Starred notes and pinned tags, in your order: drag one to reorder, or drag a card in from Notes to star it. */
function renderFavorites() {
  // The tag Notes shows on its own (like a folder alone), which its favorite marks as open.
  const q = onPage() === "notes" && notesPage.scope === "active" ? notesPage.query : null;
  const shownTag = q?.tag && formatQuery(q) === formatQuery({ tag: q.tag }) ? (normalizeTag(q.tag) ?? "") : "";
  const list = favorites.filter((f) => isTagFavorite(f) || !isArchived(f.path));
  const rows = list.map((f) => {
    if (isTagFavorite(f)) {
      const row = tagFavoriteRow(f, f.tag === shownTag);
      favoriteDrop(row, "is-drop-before", favoriteKey(f));
      return row;
    }
    const row = el(
      "div",
      {
        class: `tree-row is-file${f.path === active.session?.path ? " is-active" : ""}`,
        style: { "--depth": "0" },
        title: f.path,
        draggable: "true",
        onclick: (e: MouseEvent) => openNote(f.path, { pane: sideClick(e) ? sideOf(active) : active }),
        ondragstart: (e: DragEvent) => {
          e.dataTransfer!.setData(FAVORITE, f.path);
          e.dataTransfer!.setData(NOTE_DRAG, f.path); // so it can go to a folder or Archive too
          document.body.classList.add("is-dragging");
          e.dataTransfer!.effectAllowed = "move";
        },
      },
      icon(f.kind === "html" ? "html" : "file", 14),
      el("span", { class: "tree-name" }, displayName(f.path)),
      el(
        "span",
        { class: "row-actions" },
        el("button", { type: "button", class: "row-act", title: `Open to the side (${SIDE_CLICK})`, onclick: (e: Event) => (e.stopPropagation(), void openNote(f.path, { pane: sideOf(active) })) }, icon("split", 14)),
        el("button", { type: "button", class: "row-act fav-star", title: "Unstar", onclick: (e: Event) => (e.stopPropagation(), void toggleStar(f.path)) }, icon("starred", 14)),
      ),
    );
    favoriteDrop(row, "is-drop-before", f.path);
    return row;
  });
  $("#favorites").replaceChildren(...(rows.length ? rows : [el("div", { class: "fav-hint" }, "Star a note, or pin a tag, to keep it here.")]));
}

/** Let `node` take a favorite (to reorder) or a card from Notes (to star), marking it with `cls` while over it. */
function favoriteDrop(node: HTMLElement, cls: string, before?: string) {
  node.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.some((t) => t === FAVORITE || t === NOTE_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.add(cls);
  });
  node.addEventListener("dragleave", (e) => {
    if (!node.contains(e.relatedTarget as Node)) node.classList.remove(cls);
  });
  node.addEventListener("drop", (e) => {
    const path = e.dataTransfer?.getData(FAVORITE) || e.dataTransfer?.getData(NOTE_DRAG);
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove(cls);
    endDrag();
    void dropFavorite(path, before);
  });
}

/** A favorite (a note path or "#tag") or a note dropped on Favorites: starred if it wasn't, and put before `before` (or at the end). */
async function dropFavorite(key: string, before?: string) {
  if (!key || key === before) return;
  try {
    if (!favorites.some((f) => favoriteKey(f) === key)) favorites = await (key.startsWith("#") ? api.starTag(key) : api.star(key));
    const order = favorites.map(favoriteKey).filter((k) => k !== key);
    const at = before ? order.indexOf(before) : -1;
    order.splice(at < 0 ? order.length : at, 0, key);
    favorites = await api.orderFavorites(order);
  } catch {
    return toast({ text: `Couldn't add ${key.startsWith("#") ? key : displayName(key)} to Favorites` });
  }
  renderTree();
  renderChrome();
}

// ------------------------------------------------------------------ sidebar folders

/** Who (other than you) edited something under each folder in the last 15 minutes. */
function recentAgentFolders(): Map<string, string> {
  const since = Date.now() - 15 * 60_000;
  const out = new Map<string, string>();
  for (const c of changes) {
    if (c.ts <= since || isSelf(c.source)) continue;
    for (let f = parentOf(c.path); f; f = parentOf(f)) if (!out.has(f)) out.set(f, c.source);
  }
  return out;
}

// Folders are the paths notes live under. One you've just made has no notes yet, so it's kept
// here (per workspace, in this browser) until a note lands in it.
const emptyFoldersKey = () => `folders:${workspaceId || "local"}`;
const emptyFolders = () => new Set(store.get<string[]>(emptyFoldersKey(), []));
function setEmptyFolders(s: Set<string>) {
  store.set(emptyFoldersKey(), [...s]);
}

/** Every folder: ones with notes in them (outside the archive), and new empty ones. */
function allFolders(): string[] {
  const out = new Set<string>(emptyFolders());
  for (const n of notes) {
    if (isArchived(n.path) || n.kind === "asset") continue;
    const parts = n.path.split("/").slice(0, -1);
    parts.forEach((_, i) => out.add(parts.slice(0, i + 1).join("/")));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function setExpanded(folder: string, open: boolean) {
  if (open) prefs.expanded.add(folder);
  else prefs.expanded.delete(folder);
  store.set("expanded", [...prefs.expanded]);
}

/**
 * The sidebar: the views' counts and highlights, Favorites, and the folders. Folders start closed
 * (the chevron shows subfolders) and hold no notes: clicking one shows Notes narrowed to it.
 */
function renderTree() {
  renderFavorites();
  const page = onPage();
  // What Notes is showing, as a query: the Notes view, a folder and a smart folder each match one.
  const showing = page === "notes" && notesPage.scope === "active" ? formatQuery(notesPage.query) : null;
  renderSmartFolders(showing);
  const archivedCount = notes.filter((n) => isArchived(n.path) && n.kind !== "asset").length;
  $("#archive-count").textContent = archivedCount ? String(archivedCount) : "";
  const assetCount = notes.filter((n) => n.kind === "asset" && !isArchived(n.path)).length;
  $("#assets-count").textContent = assetCount ? String(assetCount) : "";
  $("#notes-btn").classList.toggle("is-active", showing === "");
  const shownTag = showing === null ? "" : (parseQuery(showing).tag ?? "");
  renderTagTree(shownTag && showing === formatQuery({ tag: shownTag }) ? shownTag.toLowerCase() : ""); // a tag alone, like a folder alone
  $("#tasks-btn").classList.toggle("is-active", page === "tasks");
  $("#history-btn").classList.toggle("is-active", page === "history" && !historyPage.noteFilter);
  $("#assets-btn").classList.toggle("is-active", page === "assets");
  $("#tags-page-btn").classList.toggle("is-on", page === "tags");

  const empty = emptyFolders();
  for (const f of [...empty]) if (notes.some((n) => n.path.startsWith(`${f}/`))) empty.delete(f); // it has notes now: it's a real folder
  setEmptyFolders(empty);
  const folders = allFolders();
  const count = new Map<string, number>();
  for (const n of notes) {
    if (isArchived(n.path) || n.kind === "asset") continue;
    for (let f = parentOf(n.path); f; f = parentOf(f)) count.set(f, (count.get(f) ?? 0) + 1);
  }
  const agents = recentAgentFolders();
  const action = (title: string, ico: string, fn: () => void) =>
    el("button", { type: "button", class: "row-act", title, onclick: (e: Event) => (e.stopPropagation(), fn()) }, icon(ico, 14));
  const walk = (parent: string, depth: number): HTMLElement[] =>
    folders
      .filter((f) => parentOf(f) === parent)
      .flatMap((path) => {
        const subs = folders.some((f) => parentOf(f) === path);
        const open = subs && prefs.expanded.has(path);
        const n = count.get(path) ?? 0;
        const agent = agents.get(path);
        const row = el(
          "div",
          {
            class: `tree-row is-folder${open ? "" : " is-collapsed"}${showing === formatQuery({ folder: path }) ? " is-active" : ""}`,
            style: { "--depth": String(depth) },
            "data-folder": path,
            title: n ? `Show the notes in ${path}` : `${path} is empty. Drag notes here.`,
            tabindex: "0",
            onclick: () => void showNotes({ scope: "active", query: { folder: path } }),
            onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && void showNotes({ scope: "active", query: { folder: path } }),
          },
          subs
            ? el(
                "button",
                {
                  type: "button",
                  class: "chev",
                  title: open ? "Hide subfolders" : "Show subfolders",
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    setExpanded(path, !open);
                    renderTree();
                    $(`#tree .tree-row[data-folder="${CSS.escape(path)}"] .chev`).focus(); // the row was rebuilt; keep the keyboard here
                  },
                },
                icon("chevron", 13),
              )
            : el("span", { class: "chev is-leaf" }),
          icon("folder", 14),
          el("span", { class: "tree-name" }, path.split("/").pop()!),
          agent ? el("span", { class: "agent-dot", title: `${agent} edited notes here`, style: { "--hue": String(hueFor(agent)) } }) : null,
          n ? el("span", { class: "n" }, String(n)) : null,
          el(
            "span",
            { class: "row-actions" },
            action(`New note in ${path}`, "plus", () => void newNote(path)),
            !n && empty.has(path) ? action("Remove this empty folder", "close", () => (empty.delete(path), setEmptyFolders(empty), renderTree())) : null,
          ),
        );
        dropTarget(row, () => path);
        return [row, ...(open ? walk(path, depth + 1) : [])];
      });
  $("#tree").replaceChildren(...walk("", 0));
}

/**
 * Tags in the sidebar, as a tree with how many notes carry each (tags under it included). Nested
 * tags start closed; clicking a tag shows Notes narrowed to it, the way a folder does.
 */
function renderTagTree(active: string) {
  const shown = tags.filter((t) => t.notes > 0);
  const parent = (t: string) => (t.includes("/") ? t.slice(0, t.lastIndexOf("/")) : "");
  const walk = (under: string, depth: number): HTMLElement[] =>
    shown
      .filter((t) => parent(t.tag) === under)
      .flatMap((t) => {
        const subs = shown.some((s) => parent(s.tag) === t.tag);
        // The tag being shown stays visible: its parents open for it.
        const open = subs && (prefs.tagsOpen.has(t.tag) || active.startsWith(`${t.tag}/`));
        const row = el(
          "div",
          {
            class: `tree-row is-tag${open ? "" : " is-collapsed"}${t.tag === active ? " is-active" : ""}`,
            style: { "--depth": String(depth) },
            "data-tag": t.tag,
            title: `Notes tagged #${t.display}`,
            tabindex: "0",
            onclick: () => openTag(t.display),
            onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && openTag(t.display),
          },
          subs
            ? el(
                "button",
                {
                  type: "button",
                  class: "chev",
                  title: open ? "Hide nested tags" : "Show nested tags",
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    if (open) prefs.tagsOpen.delete(t.tag);
                    else prefs.tagsOpen.add(t.tag);
                    store.set("tagsOpen", [...prefs.tagsOpen]);
                    renderTree();
                    $(`#tag-tree .tree-row[data-tag="${CSS.escape(t.tag)}"] .chev`).focus(); // the row was rebuilt; keep the keyboard here
                  },
                },
                icon("chevron", 13),
              )
            : el("span", { class: "chev is-leaf" }),
          icon("hash", 14),
          el("span", { class: "tree-name" }, t.display.split("/").pop()!),
          isPinned(t.display) ? el("span", { class: "fav-pinned", title: "Pinned to Favorites" }, icon("pinned", 11)) : null,
          el("span", { class: "n" }, String(t.notes)),
          el("span", { class: "row-actions" }, pinButton(t.display, "row")),
        );
        return [row, ...(open ? walk(t.tag, depth + 1) : [])];
      });
  const rows = walk("", 0);
  $("#tag-tree").replaceChildren(...(rows.length ? rows : [el("div", { class: "fav-hint" }, "Write #tag in a note to see it here.")]));
}

/** Fold a sidebar section away from its header, or open it again. Remembered in this browser. */
function setupSections() {
  document.querySelectorAll<HTMLElement>(".tree-head[data-section]").forEach((head) => {
    const section = head.dataset.section!;
    const toggle = head.querySelector<HTMLButtonElement>(".section-toggle")!;
    const body = $(`#${toggle.getAttribute("aria-controls")}`);
    const apply = () => {
      const folded = !!prefs.folded[section];
      toggle.setAttribute("aria-expanded", String(!folded));
      head.classList.toggle("is-folded", folded);
      body.hidden = folded;
    };
    toggle.addEventListener("click", () => {
      prefs.folded[section] = !prefs.folded[section];
      store.set("folded", prefs.folded);
      apply();
    });
    apply();
  });
}

/** Highlight where a dragged note would land: a folder row, or the whole tree for the top level. */
function markDrop(folder: string | null) {
  document.querySelectorAll(".is-drop, .is-drop-before").forEach((n) => n.classList.remove("is-drop", "is-drop-before"));
  if (folder === null) return;
  (folder ? document.querySelector(`.tree-row[data-folder="${CSS.escape(folder)}"]`) : $("#tree"))?.classList.add("is-drop");
}
function endDrag() {
  document.body.classList.remove("is-dragging");
  markDrop(null);
}
function dropTarget(node: HTMLElement, folder: () => string, onDrop?: (path: string) => void) {
  node.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(NOTE_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (onDrop) node.classList.add("is-drop");
    else markDrop(folder());
  });
  node.addEventListener("dragleave", (e) => {
    if (!node.contains(e.relatedTarget as Node)) node.classList.remove("is-drop");
  });
  node.addEventListener("drop", (e) => {
    const path = e.dataTransfer?.getData(NOTE_DRAG);
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    if (onDrop) onDrop(path);
    else void moveToFolder(path, folder());
  });
}

/** Move a note into `folder` ("" = top level). Links to it keep working; Undo puts it back. */
async function moveToFolder(path: string, folder: string, opts: { undo?: boolean } = {}) {
  const from = parentOf(path);
  if (folder === from) return;
  const dest = `${folder ? `${folder}/` : ""}${path.split("/").pop()}`;
  const wasOpen = active.session?.path === path;
  if (wasOpen) await flushSave();
  renaming = path;
  let r;
  try {
    r = await api.move(path, dest);
  } catch (e) {
    return toast({ text: e instanceof ApiError && e.status === 409 ? `${folder || "The top level"} already has a note called ${displayName(path)}` : `Couldn't move ${displayName(path)}` });
  } finally {
    renaming = null;
  }
  notes = await api.notes();
  if (from && !notes.some((n) => n.path.startsWith(`${from}/`))) {
    const empty = emptyFolders(); // moving the last note out shouldn't make the folder vanish
    empty.add(from);
    setEmptyFolders(empty);
  }
  renderTree();
  if (wasOpen) {
    await openNote(r.path, { push: false });
  }
  if (!opts.undo) {
    toast({
      icon: "move",
      text: `Moved ${displayName(path)} to ${folder || "the top level"}`,
      actionLabel: "Undo",
      action: () => void moveToFolder(r.path, from, { undo: true }),
    });
  }
}

/** Archive a note dropped on Archive. The open note stays open (marked archived), like ⌘⇧E. */
async function archivePath(path: string) {
  if (active.session?.path === path) return archiveCurrent();
  const r = await api.archive([path]).catch(() => null);
  if (!r) return toast({ text: `Couldn't archive ${displayName(path)}` });
  await refreshNotes();
  notesPage.refreshSoon();
  toast({
    icon: "archive",
    text: `Archived ${displayName(path)}`,
    actionLabel: "Undo",
    action: async () => {
      await api.unarchive(r.moved.map((m) => m.to));
      await refreshNotes();
      notesPage.refreshSoon();
    },
  });
}

/** An inline name field at the top of the tree; the folder appears (empty) when you press Enter. */
function startNewFolder() {
  $("#tree").querySelector(".tree-row.is-input")?.remove();
  const input = el("input", { class: "tree-input", placeholder: "Folder name", spellcheck: "false" });
  const row = el("div", { class: "tree-row is-input", style: { "--depth": "0" } }, icon("folder", 14), input);
  $("#tree").prepend(row);
  input.focus();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim().replace(/[\\:*?"<>|#^[\]]/g, "").replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");
    if (commit && name && !allFolders().some((f) => f.toLowerCase() === name.toLowerCase())) {
      const empty = emptyFolders();
      empty.add(name);
      setEmptyFolders(empty);
      if (parentOf(name)) setExpanded(parentOf(name), true); // show where the new folder went
      toast({ icon: "folder", text: `Made ${name}`, detail: "Drag notes onto it, or use Move on a note." });
    }
    renderTree();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// ------------------------------------------------------------------ chrome: crumbs, status, panel

function renderChrome() {
  const s = active.session;
  const crumbs = $("#crumbs");
  const page = onPage();
  $("#back-btn").hidden = page === "notes";
  $("#archive-btn").hidden = !s;
  $("#move-btn").hidden = !s;
  $("#star-btn").hidden = !s || s.kind === "asset";
  $("#note-history-btn").hidden = !s || s.kind === "asset";
  $("#focus-btn").hidden = !s || s.kind === "asset";
  $("#split-btn").hidden = !split && (!s || s.kind === "asset");
  $("#split-btn").title = split ? "Close the side pane (⌘⌥\\)" : "Split view (⌘⌥\\)";
  $("#split-btn").classList.toggle("is-on", split);
  $("#save-status").hidden = !s;
  renderPaneBars();
  if (!s) {
    $("#html-toggle").hidden = true;
    for (const id of ["#vim-mode", "#cursor-pos", "#word-count"]) $(id).textContent = "";
    $("#vim-mode").dataset.mode = "";
    const label = { notes: "Notes", tasks: "Tasks", history: "History", assets: "Assets", tags: "Tags" };
    const note = page === "history" ? historyPage.noteFilter : null;
    return crumbs.replaceChildren(
      ...(page ? [el("span", { class: "crumb-file" }, label[page])] : []),
      ...(note ? [el("span", { class: "crumb-sep" }, "·"), el("span", { class: "crumb" }, displayName(note))] : []),
    );
  }
  const starred = isStarred(s.id);
  $("#star-btn").classList.toggle("is-on", starred);
  $("#star-btn").title = starred ? "Unstar (take out of Favorites)" : "Star (add to Favorites)";
  $("#star-btn").replaceChildren(icon(starred ? "starred" : "star", 16));
  const archived = isArchived(s.path);
  $("#archive-btn").title = archived ? "Unarchive note (⌘⇧E)" : "Archive note (⌘⇧E)";
  $("#archive-btn").replaceChildren(icon(archived ? "unarchive" : "archive", 16));
  const parts = s.path.split("/");
  const file = parts.pop()!;
  const name = el("span", { class: "crumb-file", title: "Click to rename" }, file.replace(/\.(md|markdown)$/i, ""));
  name.addEventListener("click", () => startRename(name));
  const folderCrumbs = parts.flatMap((p, i) => {
    const crumb = el("button", { type: "button", class: "crumb", title: "Move to another folder" }, p);
    crumb.addEventListener("click", () => openMovePicker(crumb));
    return i === 0 && p === "Archive" ? [el("span", { class: "crumb" }, p), el("span", { class: "crumb-sep" }, "/")] : [crumb, el("span", { class: "crumb-sep" }, "/")];
  });
  crumbs.replaceChildren(...folderCrumbs, name);
  $("#html-toggle").hidden = s.kind !== "html";
  $("#html-toggle").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === prefs.htmlMode));
  setSaveStatus("saved");
}

function openMovePicker(anchor: HTMLElement) {
  const s = active.session;
  if (!s) return;
  folderPicker(anchor, { folders: allFolders(), current: parentOf(s.path), onPick: (folder) => void moveToFolder(s.path, folder) });
}

function startRename(label: HTMLElement) {
  const s = active.session;
  if (!s) return;
  const ext = s.path.match(/\.[^.]+$/)?.[0] ?? "";
  const input = el("input", { class: "rename-input", value: s.path.replace(/\.(md|markdown)$/i, ""), spellcheck: "false" });
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit: boolean) => {
    if (done) return;
    done = true;
    const to = input.value.trim();
    if (commit && to && to !== s.path.replace(/\.(md|markdown)$/i, "")) {
      try {
        await flushSave();
        const r = await api.move(s.path, /\.[a-z]+$/i.test(to) ? to : to + (ext === ".md" ? "" : ext));
        await refreshNotes();
        await openNote(r.path, { push: false });
        if (r.updated.length) toast({ source: "you", text: `Renamed · updated links in ${r.updated.length} note${r.updated.length > 1 ? "s" : ""}` });
        return;
      } catch (e) {
        toast({ text: e instanceof Error ? e.message : "Rename failed" });
      }
    }
    renderChrome();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(false));
}

function setSaveStatus(state: "saved" | "editing" | "saving" | "error") {
  const labels = { saved: "Saved", editing: "Edited", saving: "Saving…", error: "Not saved" };
  const node = $("#save-status");
  node.dataset.state = state;
  node.textContent = labels[state];
}

let statusTimer = 0;
function renderStatusSoon(state: EditorState) {
  cancelAnimationFrame(statusTimer);
  statusTimer = requestAnimationFrame(() => renderStatus(state));
}
function renderStatus(state: EditorState) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  $("#cursor-pos").textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
  const words = active.session?.kind === "md" ? (state.doc.toString().match(/[\p{L}\p{N}’']+/gu)?.length ?? 0) : 0;
  $("#word-count").textContent = active.session?.kind === "md" ? `${words.toLocaleString()} words` : "";
  highlightOutline(line.number);
}

/**
 * Vim's jump list is global and holds positions from the previous note; in a shorter note the
 * next G/gg throws on them (and the keystroke falls through as typed text). Give each note a
 * fresh jump list, keeping registers and search history.
 */
function resetVimJumps() {
  const prev = { ...Vim.getVimGlobalState_() };
  Vim.resetVimGlobalState_();
  const fresh = Vim.getVimGlobalState_();
  Object.assign(fresh, prev, { jumpList: fresh.jumpList });
}

/** Editors whose vim mode the status bar already follows. */
const vimWatched = new WeakSet<object>();
function attachVim() {
  const cm = getCM(active.view);
  const node = $("#vim-mode");
  $("#vim-toggle").classList.toggle("is-on", prefs.vim);
  if (!cm || !prefs.vim) {
    node.textContent = "";
    node.dataset.mode = "";
    return;
  }
  const set = (mode: string, sub?: string) => {
    node.dataset.mode = mode;
    node.textContent = sub ? `${mode} ${sub}` : mode;
  };
  set(cm.state.vim?.insertMode ? "insert" : cm.state.vim?.visualMode ? "visual" : "normal");
  if (vimWatched.has(cm)) return;
  vimWatched.add(cm);
  cm.on("vim-mode-change", (e: { mode: string; subMode?: string }) => getCM(active.view) === cm && set(e.mode, e.subMode));
}

// outline
let outlineHeadings: Array<{ level: number; text: string; line: number }> = [];
function renderOutline() {
  const box = $("#outline");
  outlineHeadings = [];
  if (active.session?.kind === "md") {
    for (const [i, t] of proseLines(active.view.state.doc.toString())) {
      const m = t.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (m) outlineHeadings.push({ level: m[1].length, text: m[2].replace(/[*_`~]|\[\[|\]\]/g, ""), line: i });
    }
  }
  const min = Math.min(...outlineHeadings.map((h) => h.level));
  box.replaceChildren(
    ...(outlineHeadings.length
      ? outlineHeadings.map((h) =>
          el(
            "div",
            { class: "outline-item", style: { "--depth": String(h.level - min) }, "data-line": String(h.line), onclick: () => (goToLine(active, h.line), active.view.focus()) },
            h.text,
          ),
        )
      : [el("div", { class: "panel-empty" }, active.session?.kind === "md" ? "No headings" : "—")]),
  );
  highlightOutline(active.view.state.doc.lineAt(active.view.state.selection.main.head).number);
}
const renderOutlineSoon = debounce(renderOutline, 250);
function highlightOutline(line: number) {
  let current = -1;
  for (const h of outlineHeadings) if (h.line <= line) current = h.line;
  $("#outline").querySelectorAll<HTMLElement>(".outline-item").forEach((n) => n.classList.toggle("is-current", Number(n.dataset.line) === current));
}

// backlinks
async function refreshBacklinks() {
  const s = active.session;
  if (!s) return;
  const links = await api.backlinks(s.path).catch(() => []);
  if (s !== active.session) return;
  $("#backlink-count").textContent = links.length ? String(links.length) : "";
  $("#backlinks").replaceChildren(
    ...(links.length
      ? links.map((b) =>
          el(
            "div",
            { class: "backlink", onclick: (e: MouseEvent) => openNote(b.path, { line: b.line, pane: sideClick(e) ? sideOf(active) : active }) },
            el("div", { class: "bl-title" }, icon(b.kind === "embed" ? "open" : "link", 12), b.title),
            el("div", { class: "bl-text", html: highlightLink(b.text) }),
          ),
        )
      : [el("div", { class: "panel-empty" }, "No backlinks yet")]),
  );
}
const refreshBacklinksSoon = debounce(refreshBacklinks, 300);
const highlightLink = (t: string) =>
  t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!).replace(/!?\[\[([^\]]+)\]\]/g, (_m, x) => `<b>${x.split("|").pop()}</b>`);

// activity
const verb = (c: Change) => ({ create: "created", edit: "edited", move: "moved", delete: "deleted", archive: "archived", unarchive: "unarchived" })[c.op];
function renderActivity() {
  $("#activity").replaceChildren(
    ...(changes.length
      ? groupChanges(changes).slice(0, 30).map((c) => {
          const [add, del] = (c.summary ?? "").match(/^\+(\d+) −(\d+)$/)?.slice(1) ?? [];
          return el(
            "div",
            {
              class: "act",
              role: "button",
              tabindex: "0",
              title: "See what changed",
              onclick: () => void showHistory({ select: c.id }),
              onkeydown: (e: KeyboardEvent) => e.key === "Enter" && void showHistory({ select: c.id }),
            },
            avatar(c.source, 22),
            el(
              "div",
              { class: "act-body" },
              el(
                "div",
                { class: "act-line" },
                el("b", {}, c.source),
                ` ${verb(c)} `,
                el("a", { onclick: (e: Event) => (e.stopPropagation(), openNote(c.path)) }, displayName(c.path)),
              ),
              el(
                "div",
                { class: "act-meta" },
                add !== undefined ? el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${add}`), el("span", { class: "del" }, `−${del}`)) : null,
                c.op === "move" && c.from_path ? el("span", {}, `from ${displayName(c.from_path)}`) : null,
                c.count > 1 ? el("span", {}, `${c.count} saves`) : null,
                el("span", { "data-ts": String(c.ts) }, timeAgo(c.ts)),
              ),
            ),
          );
        })
      : [el("div", { class: "panel-empty" }, "Agent and editor changes show up here.")]),
  );
}

function renderPresence() {
  const since = Date.now() - 15 * 60_000;
  const active = [...new Set(changes.filter((c) => c.ts > since && !isSelf(c.source)).map((c) => c.source))].slice(0, 4);
  $("#agents").replaceChildren(...active.map((a) => avatar(a, 22)));
  $("#agents").title = active.length ? `Active in the last 15 min: ${active.join(", ")}` : "";
}

// ------------------------------------------------------------------ html notes

function renderHtmlPreview(pane = active) {
  if (pane.session?.kind !== "html") return;
  const frame = sandboxFrame(pane.view.state.doc.toString(), { title: pane.session.title });
  frame.className = "html-frame";
  pane.preview.replaceChildren(frame);
}

function setHtmlMode(mode: "preview" | "source") {
  prefs.htmlMode = mode;
  store.set("htmlMode", mode);
  for (const p of panes) if (p.session?.kind === "html") showNoteIn(p);
  if (active.session?.kind !== "html") return;
  if (mode === "source") active.view.focus();
  renderChrome();
}

/** Show a pane's note as its editor, or an HTML note as its preview if that's the mode. */
function showNoteIn(pane: Pane) {
  const preview = pane.session?.kind === "html" && prefs.htmlMode === "preview";
  if (pane.index === 0) showStage(preview ? "html" : "editor");
  else [pane.host.hidden, pane.preview.hidden] = [preview, !preview];
  if (preview) renderHtmlPreview(pane);
}

// ------------------------------------------------------------------ banner, toasts

function showBanner(text: string, ...actions: Array<[string, () => void]>) {
  const b = $("#banner");
  b.hidden = false;
  b.className = "";
  b.replaceChildren(
    icon("spark", 15),
    el("span", { class: "banner-text" }, text),
    ...actions.map(([label, fn]) => el("button", { class: "banner-btn", type: "button", onclick: fn }, label)),
    el("button", { class: "banner-x", type: "button", title: "Dismiss", onclick: hideBanner }, "×"),
  );
}
function hideBanner() {
  $("#banner").hidden = true;
}

function toast(t: { text: string; source?: string; icon?: string; detail?: string; action?: () => void; actionLabel?: string; sticky?: boolean }) {
  const button = t.action && t.actionLabel ? el("button", { class: "toast-action", type: "button" }, t.actionLabel) : null;
  const node = el(
    "div",
    {
      class: `toast${t.action && !button ? " is-clickable" : ""}${t.icon === "timer" ? " is-alert" : ""}`,
      onclick: () => {
        if (!button) t.action?.();
        node.remove();
      },
    },
    t.source ? avatar(t.source, 22) : el("span", { class: "toast-icon" }, icon(t.icon ?? "spark", 16)),
    el("div", { class: "toast-body" }, el("div", { class: "toast-text" }, t.source ? el("b", {}, t.source) : null, t.source ? ` ${t.text}` : t.text), t.detail ? el("div", { class: "toast-detail" }, t.detail) : null),
    button,
  );
  button?.addEventListener("click", (e) => {
    e.stopPropagation();
    t.action!();
    node.remove();
  });
  $("#toasts").append(node);
  const life = t.sticky ? 12_000 : 4200;
  setTimeout(() => node.classList.add("is-leaving"), life);
  setTimeout(() => node.remove(), life + 400);
}

// ------------------------------------------------------------------ vim + keyboard

Vim.defineEx("write", "w", () => void flushSave());
Vim.defineEx("edit", "e", (_cm: unknown, params: { args?: string[] }) => {
  const arg = params.args?.join(" ");
  if (arg) openTarget(arg, active.session?.path);
  else openPalette();
});
Vim.defineEx("archive", "arch", () => void archiveCurrent());
Vim.defineEx("notes", "note", () => void showNotes());
Vim.defineEx("star", "star", () => active.session && void toggleStar(active.session.path));
Vim.defineEx("focus", "foc", () => void setFocusMode(!focusMode));
Vim.defineEx("vsplit", "vs", (_cm: unknown, params: { args?: string[] }) => {
  const arg = params.args?.join(" ");
  if (arg) void openTarget(arg, active.session?.path, sideOf(active));
  else if (!split) void openSplit();
});
Vim.defineEx("only", "on", () => split && void closePane(other(active)));
Vim.defineEx("close", "clo", () => void closePane(active));
Vim.defineAction("quireFollowLink", () => followLinkAtCursor());
Vim.mapCommand("gd", "action", "quireFollowLink", {}, { context: "normal" });
Vim.mapCommand("gf", "action", "quireFollowLink", {}, { context: "normal" });

function followLinkAtCursor() {
  const link = linkTargetAt(active.view.state, active.view.state.selection.main.head);
  if (!link) return;
  if (link.target) openTarget(link.target, active.session?.path);
  else if (link.href && /^https?:/i.test(link.href)) window.open(link.href, "_blank", "noopener");
  else if (link.href) openTarget(decodeTarget(link.href), active.session?.path);
}

window.addEventListener(
  "keydown",
  (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "p")) {
      e.preventDefault();
      palette.isOpen ? palette.close() : openPalette();
    } else if (mod && !e.altKey && e.key === "\\") {
      e.preventDefault();
      togglePanel();
    } else if (mod && e.key === "s") {
      e.preventDefault();
      flushSave();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void archiveCurrent();
    } else if (mod && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      void setFocusMode(!focusMode);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      void showNotes({ filter: true });
    } else if (e.key === "q" && !mod && !e.altKey && !typingIn(e.target)) {
      // q, anywhere you aren't typing: the quick-add bar (Todoist's key, and free here).
      e.preventDefault();
      openQuickAdd({
        added: (r) => toast({ icon: "check", text: `Added to ${r.path.replace(/\.md$/, "")}`, actionLabel: "Open", action: () => void openNote(r.path, { line: r.line }) }),
        open: (path, line) => void openNote(path, { line }),
      });
    } else if (mod && e.altKey && (e.code === "Backslash" || e.key === "\\")) {
      e.preventDefault();
      void (split ? closePane(active) : openSplit());
    } else if (mod && e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight") && split) {
      e.preventDefault();
      const p = panes[e.code === "BracketLeft" ? 0 : 1];
      focusPane(p);
      if (p.session && p.session.kind !== "asset") p.view.focus();
    } else if (mod && e.key === "e" && active.session?.kind === "html") {
      e.preventDefault();
      setHtmlMode(prefs.htmlMode === "preview" ? "source" : "preview");
    }
  },
  true,
);

/** Whether a key pressed here is someone typing: a field, a text area, or the editor. */
function typingIn(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false]), .cm-editor");
}

const narrow = matchMedia("(max-width: 1100px)");
function togglePanel(force?: boolean) {
  if (narrow.matches && force === undefined) {
    document.body.classList.toggle("panel-overlay"); // narrow windows: the panel floats over the editor
    return;
  }
  prefs.panel = force ?? !prefs.panel;
  store.set("panel", prefs.panel);
  document.body.classList.toggle("panel-closed", !prefs.panel);
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("theme", next);
  try {
    localStorage.setItem("quire.theme", next);
  } catch {}
  $("#theme-toggle").replaceChildren(icon(next === "dark" ? "sun" : "moon", 15));
  for (const p of panes) {
    if (p.session?.kind === "html") renderHtmlPreview(p);
    if (p.session?.kind === "md") bumpEmbeds(p.view);
  }
}

// ------------------------------------------------------------------ split view

/** The divider, the drop zone at the right edge, the split button, and focus following clicks into a pane. */
function setupPanes() {
  const stage = $("#stage");
  const divider = $("#pane-divider");
  const resize = (clientX: number) => {
    const r = stage.getBoundingClientRect();
    layout.side = clampSide((r.right - clientX) / r.width);
    stage.style.setProperty("--side", `${layout.side * 100}%`);
    for (const p of panes) p.view.requestMeasure();
  };
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
    const move = (ev: PointerEvent) => resize(ev.clientX);
    const up = () => {
      divider.removeEventListener("pointermove", move);
      document.body.classList.remove("is-resizing");
      saveLayout();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up, { once: true });
  });
  divider.addEventListener("keydown", (e) => {
    const by = e.key === "ArrowLeft" ? 0.05 : e.key === "ArrowRight" ? -0.05 : 0;
    if (!by) return;
    e.preventDefault();
    layout.side = clampSide(layout.side + by);
    stage.style.setProperty("--side", `${layout.side * 100}%`);
    saveLayout();
  });

  // Drag a note (from the sidebar or Notes) to the right edge to open it there.
  const zone = $("#side-drop");
  const edge = (e: DragEvent) => e.dataTransfer?.types.includes(NOTE_DRAG) && e.clientX > stage.getBoundingClientRect().right - Math.max(96, stage.clientWidth * 0.18);
  stage.addEventListener("dragover", (e) => {
    zone.hidden = !edge(e);
    if (!zone.hidden) e.preventDefault();
  });
  stage.addEventListener("dragleave", (e) => !stage.contains(e.relatedTarget as Node) && (zone.hidden = true));
  stage.addEventListener("drop", (e) => {
    const on = !zone.hidden;
    zone.hidden = true;
    const path = on ? e.dataTransfer!.getData(NOTE_DRAG) : "";
    if (!path || notes.find((n) => n.path === path)?.kind === "asset") return;
    e.preventDefault();
    void openNote(path, { pane: panes[1] });
  });
  document.addEventListener("dragend", () => (zone.hidden = true));

  $("#split-btn").addEventListener("click", () => void (split ? closePane(panes[1]) : openSplit()));
  // Clicking or tabbing into a pane gives it the focus.
  // (Not from a pane bar's buttons: redrawing the bar on mousedown would swallow their click.)
  const follow = (p: Pane) => (e: Event) => p !== active && split && !(e.target as Element).closest?.(".pane-bar button") && focusPane(p);
  for (const [p, nodes] of [[panes[0], ["#editor-host", "#html-preview", "#main-bar", "#notes-view", "#tasks-view", "#history-view", "#assets-view", "#tags-view"]], [panes[1], ["#side-pane"]]] as const) {
    for (const sel of nodes) {
      $(sel).addEventListener("focusin", follow(p));
      $(sel).addEventListener("mousedown", follow(p));
    }
  }
}

// ------------------------------------------------------------------ utils + boot

function debounce<A extends unknown[]>(fn: (...a: A) => unknown, ms: number) {
  let t = 0;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

let workspaceId = "";
/** You can view this workspace but not edit it: you keep smart folders of your own but can't change shared ones. */
let viewer = false;

/**
 * Show whatever the address bar points at: /notes/<title>-<id>, /tasks, /history, /assets, or the
 * notes list (/notes, /). Links from before paths (#/Projects/Plan.md, #tasks) still work and get rewritten.
 */
async function route() {
  const hash = location.hash;
  if (hash.startsWith("#/") || /^#(feed|tasks|assets|history)\b/.test(hash)) {
    const legacy = hash.startsWith("#/") ? decodeTarget(hash.slice(2)) : "";
    const meta = legacy ? notes.find((n) => n.path === legacy) : undefined;
    const [page, query = ""] = hash.slice(1).split("?");
    const note = new URLSearchParams(query).get("note");
    const noteId = note ? notes.find((n) => n.path === note)?.id : undefined;
    const to = meta ? notePath(meta.title, meta.id) : page === "feed" || legacy ? "/notes" : `/${page}${noteId ? `?note=${noteId}` : ""}`;
    history.replaceState(null, "", to);
  }
  const at = location.pathname.replace(/\/+$/, "") || "/";
  if (at === "/tasks") return showTasks({ push: false });
  if (at === "/today") {
    setUrl("/tasks", "replace"); // Today is the top of Tasks now
    return showTasks({ push: false });
  }
  if (at === "/assets") return showAssets({ push: false });
  if (at === "/tags") return showTags({ push: false });
  if (at === "/history") {
    const id = new URLSearchParams(location.search).get("note");
    return showHistory({ note: id && NOTE_ID.test(id) ? (notes.find((n) => n.id === id)?.path ?? null) : null, push: false });
  }
  const link = parseNotePath(at);
  const path = link ? (notes.find((n) => n.id === link.id)?.path ?? (await api.resolve(link.id).catch(() => null))) : undefined;
  if (path) return path === active.session?.path ? undefined : openNote(path, { push: false });
  if (link && workspaceId) {
    // Online, the link may be to a note in another of your workspaces: switch to it (?w= picks it).
    const where = await api.locate(link.id).catch(() => null);
    if (where && where.workspace.id !== workspaceId) return void (location.href = `${location.pathname}?w=${where.workspace.id}`);
  }
  if (link) toast({ text: workspaceId ? "That note doesn't exist, or you don't have access to it" : "That note doesn't exist any more" });
  setUrl("/notes", "replace");
  return showNotes({ push: false });
}

/** The Tasks badge: how many checkboxes are still open across the workspace. */
async function refreshTaskCount() {
  const tasks = await api.tasks({}).catch(() => null);
  if (!tasks) return;
  const open = tasks.filter((t) => !t.done).length;
  $("#tasks-count").textContent = open ? String(open) : "";
}
const refreshTaskCountSoon = debounce(refreshTaskCount, 400);

async function boot() {
  // Online, the note API is per workspace and needs a signed-in person; locally it's just /api.
  const who = await whoAmI();
  // Where developer sign-in is on (local `cloud:dev`, and Previews) there's nothing to choose: go straight in.
  if (who && !who.me && who.devLogin) return location.assign(`/auth/dev?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (who && !who.me) return showSignIn();
  if (who?.me) {
    const ws = pickWorkspace(who.me);
    workspaceId = ws.id;
    viewer = ws.role === "viewer";
    useWorkspace(`/api/w/${ws.id}`, `/api/w/${ws.id}/live`);
    setSelfName(who.me.user.name);
    renderAccount(who.me, ws, (t) => toast(t));
  }

  hydrateIcons();
  togglePanel(prefs.panel);
  $("#search-btn").addEventListener("click", () => openPalette());
  // A new note goes at the top level, unless Notes is showing a folder: then it goes there.
  $("#new-note").addEventListener("click", () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : ""));
  $("#panel-btn").addEventListener("click", () => togglePanel());
  setupPanes();
  $("#stage").addEventListener("mousedown", () => document.body.classList.remove("panel-overlay"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#vim-toggle").addEventListener("click", () => {
    prefs.vim = !prefs.vim;
    store.set("vim", prefs.vim);
    for (const p of panes) p.view.dispatch({ effects: vimSlot.reconfigure(prefs.vim ? vim() : []) });
    attachVim();
    active.view.focus();
  });
  $("#html-toggle").addEventListener("click", (e) => {
    const mode = (e.target as HTMLElement).closest("button")?.dataset.mode as "preview" | "source" | undefined;
    if (mode) setHtmlMode(mode);
  });
  const isDark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#theme-toggle").replaceChildren(icon(isDark ? "sun" : "moon", 15));
  window.addEventListener("popstate", () => void route());
  $("#notes-btn").addEventListener("click", () => void showNotes({ scope: "active", query: {} }));
  $("#tasks-btn").addEventListener("click", () => void showTasks());
  $("#history-btn").addEventListener("click", () => void showHistory());
  $("#assets-btn").addEventListener("click", () => void showAssets());
  $("#tags-page-btn").addEventListener("click", () => void showTags());
  $("#new-smart-folder").addEventListener("click", () => newSmartFolder($("#new-smart-folder")));
  setupSections();
  $("#note-history-btn").addEventListener("click", () => active.session && void showHistory({ note: active.session.path }));
  $("#back-btn").addEventListener("click", () => void showNotes());
  $("#archive-nav").addEventListener("click", () => void showNotes({ scope: "archived", query: {} }));
  $("#archive-btn").addEventListener("click", () => void archiveCurrent());
  $("#star-btn").addEventListener("click", () => active.session && void toggleStar(active.session.path));
  $("#move-btn").addEventListener("click", () => openMovePicker($("#move-btn")));
  $("#focus-btn").addEventListener("click", () => void setFocusMode(!focusMode));
  $("#new-folder").addEventListener("click", () => startNewFolder());
  dropTarget($("#tree"), () => "");
  dropTarget($("#archive-nav"), () => "", (path) => void archivePath(path));
  favoriteDrop($("#favorites"), "is-drop");
  document.addEventListener("dragend", endDrag); // a drag that lands nowhere still clears its highlights
  vaultEvents.addEventListener("change", () => refreshTaskCountSoon());
  window.addEventListener("beforeunload", () => void flushSave());
  watchTimers((t) =>
    toast({
      icon: "timer",
      text: `${t.label || "Timer"} is done`,
      detail: t.note ? displayName(t.note) : undefined,
      action: t.note && t.note !== active.session?.path ? () => openNote(t.note!) : undefined,
      sticky: true,
    }),
  );
  setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-ts]").forEach((n) => (n.textContent = timeAgo(Number(n.dataset.ts))));
    renderPresence();
  }, 30_000);

  const [info, list, starred, recent, tagList, smart] = await Promise.all([api.info(), api.notes(), api.favorites(), api.changes(), api.tags(), api.smartFolders()]);
  $("#vault-name").textContent = info.name;
  notes = list;
  favorites = starred;
  tags = tagList;
  smartFolders = smart;
  changes = recent;
  renderActivity();
  renderPresence();
  connect(onMessage, (up) => {
    $("#conn").dataset.up = String(up);
    $("#conn").title = up ? "Live: watching the vault for agent edits" : "Reconnecting…";
    if (up) refreshNotesSoon();
  });

  void refreshTaskCount();
  // Home is the notes list; a note's URL (or the tasks, history or assets page) opens that instead.
  // Split as you left it: the side pane's note first, then the address bar's note in the pane that had the focus.
  layout = parseLayout(JSON.stringify(store.get(layoutKey(), null)));
  panes[0].trail = layout.panes[0];
  panes[1].trail = layout.panes[1];
  const beside = layout.split ? notes.find((n) => n.id === layout.panes[1].note && n.kind !== "asset") : undefined;
  if (beside) await openNote(beside.path, { pane: panes[1], focus: false, trail: false });
  if (beside && parseNotePath(location.pathname)?.id === beside.id) {
    // The address bar names the side pane's note: the main pane gets back what it had.
    const main = notes.find((n) => n.id === layout.panes[0].note && n.kind !== "asset");
    if (main) await openNote(main.path, { pane: panes[0], focus: false, trail: false });
    else await showNotes({ push: false });
    focusPane(panes[1]);
  } else await route();
}

boot();

(window as any).quire = { panes }; // handy in devtools
