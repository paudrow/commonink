import "./styles.css";
import "./motion.css";
import "./mobile.css";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { api, clientId, connect, favoriteKey, isArchived, isTagFavorite, useWorkspace, whoAmI, ApiError, type Change, type Favorite, type NoteMeta, type Scope, type ServerMsg, type SmartFolder, type TagCount, type TagFavorite } from "./api.ts";
import { normalizeTag } from "../../src/core/tags.ts";
import { $, authorAvatar, authorName, displayName, el, hueFor, hydrateIcons, icon, isSelf, LINK_DRAG, NOTE_DRAG, setCurrent, setLabel, setPressed, setSelfName, timeAgo, typingIn, type LinkDrag } from "./dom.ts";
import { toast } from "./toast.ts";
import { hideBanner, showBanner } from "./banner.ts";
import { showConflict as conflictBanner } from "./conflict.ts";
import { createState, openLinkToSide, remote, vimSlot } from "./editor/setup.ts";
import { linkTargetAt } from "./editor/linkAt.ts";
import { bumpEmbeds, codeRange, editorContext } from "./editor/blocks.ts";
import { codeWrapByDefault, setCodeWrapByDefault } from "./code.ts";
import { foldAll, foldAt, foldCount } from "./editor/details.ts";
import { clearFlash, flashChanges } from "./editor/agentFlash.ts";
import { editsBetween, merge3 } from "./merge.ts";
import { sandboxFrame } from "./render.ts";
import { Palette } from "./palette.ts";
import { NotesPage } from "./notesPage.ts";
import { folderPicker } from "./folderPicker.ts";
import type { History } from "./history.ts";
import type { Assets } from "./assets.ts";
import { renderTasksPage } from "./tasksView.ts";
import { openQuickAdd, QUICK_ADD } from "./quickAdd.ts";
import { formatKeys, learnLayout, matchKeys } from "./keys.ts";
import { taskInputPrefs } from "./taskInput.ts";
import type { TagsPage } from "./tagsPage.ts";
import { pickWorkspace, renderAccount, showSignIn, type AccountAction } from "./account.ts";
import { appCommands } from "./commands.ts";
import { toggleShortcuts } from "./shortcuts.ts";
import { did, vaultEvents } from "./events.ts";
import { guideMessage, startGuide } from "./onboarding.ts";
import { store } from "./store.ts";
import { changeVerb, groupChanges } from "../../src/core/format.ts";
import { entryStat, loadStats, statEl, toRanges } from "./changeStats.ts";
import { clampSide, forget, newLayout, parseLayout, SIDE_CLICK, sideClick, step, visit, type PaneTrail } from "./panes.ts";
import { headingName, headingText, proseLines } from "../../src/core/prose.ts";
import { headingMatches } from "../../src/core/gfm.ts";
import { formatQuery, parseQuery, type NoteQuery } from "../../src/core/query.ts";
import { smartFolderEditor } from "./smartFolderEditor.ts";
import { NOTE_ID, notePath, parseNotePath } from "../../src/core/ids.ts";
import { watchTimers } from "./widgets/timer.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { AGENTS_BLURB, isAgentsNote } from "./agentsNote.ts";
import { closeDrawer, setupMobileNav } from "./mobileNav.ts";

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
  /** Counts what the pane was asked to show, so a note that loads after a later request doesn't replace it. */
  opens: number;
}

// This PR's first version stored a "Start on Today" choice; Today is the top of Tasks now.
try {
  localStorage.removeItem("quire.startOnToday");
} catch {}

const prefs = {
  /** Off until you turn it on: in Vim, a stray Esc then `dd` deletes a line. */
  vim: store.get("vim", false),
  panel: store.get("panel", true),
  htmlMode: store.get<"preview" | "source">("htmlMode", "preview"),
  /** Folders whose subfolders are showing in the sidebar (they start closed). */
  expanded: new Set<string>(store.get<string[]>("expanded", [])),
  /** Tags whose nested tags are showing in the sidebar (they start closed). */
  tagsOpen: new Set<string>(store.get<string[]>("tagsOpen", [])),
  /** Sidebar sections folded away from their header. Folders start folded: the sidebar leads with tags. */
  folded: { favorites: false, smart: false, folders: true, tags: false, ...store.get<Record<string, boolean>>("folded", {}) } as Record<string, boolean>,
};
taskInputPrefs.vim = prefs.vim; // every task input (quick-add, inline edit, a card) types with the editor's keys

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
  opens: 0,
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
  starButton: (tag) => tagStarButton(tag, "chip"),
  openPerson: (assignee) => void showTasks({ assignee }),
  readOnly: () => viewer,
  toast: (t) => toast(t),
  changed: () => {
    api.clearResolveCache();
    void refreshNotes();
  },
  newNote: () => void newNote(),
});
// History, Assets and Tags load the first time they're opened (each is null until then).
let historyPage: History | null = null;
let assetsPage: Assets | null = null;
let tagsPage: TagsPage | null = null;
const once = <T>(load: () => Promise<T>) => {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load());
};
const loadHistory = once(async () =>
  (historyPage = new (await import("./history.ts")).History({
    open: (path) => fromPage(path),
    toast: (t) => toast(t),
    newNote: viewer ? undefined : () => void newNote(),
  })),
);
const loadAssets = once(async () =>
  (assetsPage = new (await import("./assets.ts")).Assets({
    notes: () => notes,
    upload: (files) => uploadFiles(files),
    open: (path) => fromPage(path),
    archive: (path) => archivePath(path),
    embedName: (path) => embedName(path),
    tags: () => tags,
    refreshTags: () => refreshNotes(),
    toast: (t) => toast(t),
  })),
);
const loadTags = once(async () =>
  (tagsPage = new (await import("./tagsPage.ts")).TagsPage($("#tags-view"), {
    tags: () => tags,
    refresh: () => refreshNotes(),
    openTag: (tag, where) => openTag(tag, where),
    toast: (t) => toast(t),
  })),
);
/** The palette's next pick opens to the side (⌘⌥\ with nothing to show there yet). */
let paletteToSide = false;
const palette = new Palette(
  () => notes,
  (path, line, side) => openNote(path, { line, pane: side || paletteToSide ? sideOf(active) : active }),
  (name) => createNote(name),
  () => commands(),
);
function openPalette(side = false) {
  paletteToSide = side;
  did("search");
  palette.open();
}

/** Online, the account menu's actions (⌘K offers them too). */
let account: AccountAction[] = [];
/** Everything ⌘K can do right now, and every shortcut the sheet lists. */
function commands() {
  const s = active.session;
  return appCommands({
    note: s ? { kind: s.kind, starred: isStarred(s.id), archived: isArchived(s.path) } : null,
    vim: prefs.vim,
    split,
    focusMode,
    htmlMode: prefs.htmlMode,
    hasStart: tags.some((t) => t.tag === "start" && t.notes > 0),
    folds: s?.kind === "md" ? foldCount(active.view.state) : 0,
    account,
    newNote: () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : ""),
    newFolder: startNewFolder,
    go: (page) => {
      if (page === "notes" || page === "archive") void showNotes({ scope: page === "notes" ? "active" : "archived", query: {} });
      else void { tasks: showTasks, tags: showTags, assets: showAssets, history: showHistory }[page]();
    },
    filterNotes: () => void showNotes({ filter: true }),
    quickAdd,
    toggleTheme,
    toggleVim,
    togglePanel: () => togglePanel(),
    toggleFocus: () => void setFocusMode(!focusMode),
    toggleSplit: () => void (split ? closePane(active) : openSplit()),
    toggleHtml: () => setHtmlMode(prefs.htmlMode === "preview" ? "source" : "preview"),
    star: () => s && void toggleStar(s.path),
    archive: () => void archiveCurrent(),
    move: () => openMovePicker($("#move-btn")),
    noteHistory: () => s && void showHistory({ note: s.path }),
    gettingStarted: async () => {
      const start = (await api.feed({ tag: "start", limit: 1 }).catch(() => null))?.items[0];
      if (start) void openNote(start.path);
    },
    shortcuts: () => toggleShortcuts(commands(), { vim: prefs.vim }),
    foldAll: (open) => foldAll(open)(active.view),
  });
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
  if (pane.session?.path === path && (opts.line || opts.heading)) {
    const line = opts.line ?? headingLine(pane, opts.heading!);
    if (line) goToLine(pane, line);
    return pane.view.focus();
  }
  const ticket = ++pane.opens;
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
  if (ticket !== pane.opens) return; // something else was opened here while this loaded
  hideBanner();
  // The same note again (renamed, moved or archived while open) keeps its place.
  const keep = pane.session?.id === note.id ? { scroll: pane.view.scrollSnapshot(), head: pane.view.state.selection.main.head } : null;
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
          noteUrl: () => notePath(next.title, next.id),
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
  } else if (isAgentsNote(note.path)) {
    showBanner(AGENTS_BLURB);
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
    const pos = Math.min(keep?.head ?? cursors.get(note.path) ?? (fm ? fm[0].length : 0), pane.view.state.doc.length);
    // Scrolled by the view, as goToLine scrolls: setting scrollDOM.scrollTop = 0 lost to CodeMirror,
    // which on focus puts back the scroll position the last note had.
    pane.view.dispatch({ selection: { anchor: pos }, effects: keep?.scroll ?? EditorView.scrollIntoView(0, { y: "start", yMargin: 80 }) });
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
      btn("close", `Close this pane (${formatKeys("Mod-Alt-\\")})`, () => void closePane(p)),
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
  closeDrawer();
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

/** Put the open note away (saved, named, cursor remembered) before showing a page that isn't a note. Pages show in the main pane, which then has the focus. */
async function leaveNote() {
  const main = panes[0];
  main.opens++; // a note still loading into it doesn't come back over the page
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
  await (await loadHistory()).show({ note: opts.note ?? null, select: opts.select });
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
  (await loadTags()).show();
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
  (await loadAssets()).show({ open: opts.open });
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
  notesPage.visible ? "notes" : !$("#tasks-view").hidden ? "tasks" : historyPage?.visible ? "history" : assetsPage?.visible ? "assets" : tagsPage?.visible ? "tags" : null;

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
  setLabel($("#focus-btn"), `${on ? "Leave focus mode" : "Focus mode"} (${formatKeys("Mod-Shift-Enter")})`);
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

/** The line of the heading `anchor` names (its words, or GitHub's slug of them), outside code. */
function headingLine(pane: Pane, anchor: string): number | undefined {
  for (const [n, text] of proseLines(pane.view.state.doc.toString())) {
    const m = text.match(/^#{1,6}[ \t]+(.*)$/);
    if (m && headingMatches(headingName(headingText(m[1])), anchor)) return n;
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
    const r = await api.save(s.path, content, s.baseVersion, content.trim() === "", clientId);
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

/** Each editor's pending end to its agent highlight, so a change in one pane doesn't keep the other's lit. */
const flashTimers = new WeakMap<EditorView, number>();
/** A new version arrived from disk. Apply it as a diff (keeps cursor, undo, vim state); 3-way merge if we have unsaved typing. */
/** Who a live change is by, from its message: its change if it has one, else just its source. */
const byOf = (m: { source: string; change?: Change | null }) => m.change ?? { source: m.source, person: null, agent: null };
/** The editor highlight for lines someone else changed, labelled with who. */
const flashOf = (ranges: Array<{ from: number; to: number }>, m: { source: string; change?: Change | null }) =>
  flashChanges.of({ ranges, source: m.source, label: authorName(byOf(m)), agent: !!byOf(m).agent });

function applyRemote(m: { path: string; content: string | null; version: string; source: string; change?: Change | null }) {
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
  view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashOf(touched, m) });
  s.base = m.content;
  s.baseVersion = m.version;
  if (target !== m.content) scheduleSave(s, 250);
  else status(s, "saved");
  if (s.kind === "html" && prefs.htmlMode === "preview") renderHtmlPreview(s.pane);
  clearTimeout(flashTimers.get(view));
  flashTimers.set(view, window.setTimeout(() => view.dispatch({ effects: clearFlash.of(null) }), 6000));
}

function showConflict(s: Session, m: { path: string; content: string | null; version: string; source: string; change?: Change | null }) {
  const who = m.source === "you" ? "Another window" : m.source === "external" ? "Another program" : authorName(byOf(m));
  const theirs = m.content!;
  clearTimeout(s.timer);
  status(s, "error");
  conflictBanner({
    who,
    where: split ? displayName(s.path) : "this note",
    mine: () => s.pane.view.state.doc.toString(),
    theirs,
    keepMine: () => {
      s.base = theirs;
      s.baseVersion = m.version;
      scheduleSave(s, 0);
      toast({ icon: "check", text: "Kept your version", detail: "Theirs is in History", actionLabel: "Undo", action: () => replaceText(s, theirs) });
    },
    useTheirs: () => {
      const view = s.pane.view;
      const mine = view.state.doc.toString();
      const { changes: edits, touched } = editsBetween(mine, theirs);
      view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashOf(touched, m) });
      s.base = theirs;
      s.baseVersion = m.version;
      status(s, "saved");
      toast({ icon: "check", text: "Switched to their version", actionLabel: "Undo", action: () => replaceText(s, mine) });
    },
  });
}

/** Put `text` in a note's editor as your own edit, which saves it. */
function replaceText(s: Session, text: string) {
  if (s !== s.pane.session) return toast({ text: `${displayName(s.path)} isn't open any more` });
  s.pane.view.dispatch({ changes: editsBetween(s.pane.view.state.doc.toString(), text).changes });
}

/**
 * Undo someone else's edit. In an open note it comes out of the editor, and what's been typed since
 * stays; a note that isn't open is put back only if nothing has changed it since.
 */
async function undoChange(c: Change, after: string | null) {
  const name = displayName(c.path);
  const history = { actionLabel: "History", action: () => void showHistory({ note: c.path }) };
  const d = await api.diff(c.id).catch(() => null);
  const s = panes.find((p) => p.session?.path === c.path)?.session;
  if (s && s.kind !== "asset" && d?.before != null && after !== null) {
    const undone = merge3(after, s.pane.view.state.doc.toString(), d.before);
    if (!undone.ok) return toast({ text: `${name} changed there since, so that edit can't be undone`, ...history });
    replaceText(s, undone.text);
    return toast({ icon: "reset", text: `Undid the edit to ${name}` });
  }
  try {
    const r = await api.restore(c.id, c.version ?? undefined);
    toast({ icon: "reset", text: `Undid the edit to ${displayName(r.path)}`, actionLabel: "Open", action: () => void openNote(r.path) });
  } catch (e) {
    toast({ text: e instanceof ApiError && e.status === 409 ? `${name} changed since, so that edit wasn't undone` : `Couldn't undo the edit to ${name}`, ...history });
  }
}

// ------------------------------------------------------------------ live updates

function onMessage(m: ServerMsg) {
  guideMessage(m);
  if (m.type !== "change") vaultEvents.dispatchEvent(new Event("change"));
  switch (m.type) {
    case "note": {
      const meta = notes.find((n) => n.path === m.path);
      if (meta) meta.version = m.version;
      // The other pane may embed this note, and typing here changes what it shows there too.
      for (const p of panes) if (p.session?.kind === "md" && p.session.path !== m.path && embedsPath(p, m.path)) bumpEmbeds(p.view);
      if (m.origin === clientId) {
        refreshTagsSoon(); // your own typing can add a tag too (anyone else's refreshes the notes, tags included)
        return;
      }
      const open = panes.some((p) => p.session?.path === m.path);
      if (open) applyRemote(m);
      if (!isSelf(m.source) && m.change) {
        const c = m.change;
        const undo = c.op === "edit";
        toast({
          by: c,
          text: `${changeVerb(c)} ${displayName(m.path)}`,
          detail: c.summary ?? undefined,
          actionLabel: undo ? "Undo" : undefined,
          action: undo ? () => void undoChange(c, m.content) : open ? undefined : () => openNote(m.path),
          open: undo && !open ? () => void openNote(m.path) : undefined,
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
      historyPage?.refreshSoon();
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
  assetsPage?.refresh();
  tagsPage?.refresh();
}
const refreshNotesSoon = debounce(refreshNotes, 120);
const refreshTagsSoon = debounce(async () => {
  tags = await api.tags().catch(() => tags);
  tagsPage?.refresh();
  renderTree();
}, 400);

// ------------------------------------------------------------------ favorites

const isStarred = (id: string) => favorites.some((f) => !isTagFavorite(f) && f.id === id);
const isTagStarred = (tag: string) => favorites.some((f) => isTagFavorite(f) && f.tag === normalizeTag(tag));

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

/** Star a tag (or unstar it): one click, and it's in Favorites beside your notes. */
async function toggleTagStar(tag: string) {
  const on = isTagStarred(tag);
  try {
    favorites = await (on ? api.unstarTag(tag) : api.starTag(tag));
  } catch (e) {
    return toast({ text: e instanceof Error ? e.message : `Couldn't ${on ? "unstar" : "star"} #${tag}` });
  }
  renderTree();
  notesPage.refreshSoon();
}

/** A tag's star, the same control notes have: on its sidebar row (`row`) or beside the Notes tag filter (`chip`). */
function tagStarButton(tag: string, where: "row" | "chip"): HTMLElement {
  const starred = isTagStarred(tag);
  const label = starred ? "Remove from Favorites" : "Add to Favorites";
  return el(
    "button",
    {
      type: "button",
      class: `${where === "row" ? "row-act" : "fc-action tag-star"} star-btn${starred ? " is-starred" : ""}`,
      title: label,
      "aria-label": `${label}: #${tag}`,
      "aria-pressed": String(starred),
      onclick: (e: Event) => (e.stopPropagation(), void toggleTagStar(tag)),
    },
    icon(starred ? "starred" : "star", where === "row" ? 14 : 15), // filled while it's a favorite; a click takes it out
  );
}

/** How a sidebar row opens what it names: a click, or Enter while the row (not a button in it) has the keyboard. */
const opens = (go: (e?: MouseEvent) => void) => ({
  tabindex: "0",
  onclick: (e: MouseEvent) => go(e),
  onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && go(),
});

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
        "aria-current": f.query === active && "page",
        style: { "--depth": "0" },
        title: `${f.query || "Every note"}${f.shared ? "" : " (just you)"}`,
        ...opens(() => void showNotes({ scope: "active", query: parseQuery(f.query) })),
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

/** A starred tag in Favorites: it opens Notes narrowed to the tag, like the tag's row under Tags. */
function tagFavoriteRow(f: TagFavorite, active: boolean): HTMLElement {
  return el(
    "div",
    {
      class: `tree-row is-tag${active ? " is-active" : ""}`,
      "aria-current": active && "page",
      style: { "--depth": "0" },
      title: `Notes tagged #${f.display}`,
      draggable: "true",
      ...opens(() => openTag(f.display)),
      ondragstart: (e: DragEvent) => {
        e.dataTransfer!.setData(FAVORITE, favoriteKey(f));
        document.body.classList.add("is-dragging");
        e.dataTransfer!.effectAllowed = "move";
      },
    },
    el("span", { class: "chev is-leaf" }), // the chevron column Folders and Tags rows have, so icons and names line up
    icon("hash", 14),
    el("span", { class: "tree-name" }, f.display),
    el("span", { class: "n" }, String(f.notes)),
    el("span", { class: "row-actions" }, tagStarButton(f.display, "row")),
  );
}

/** Starred notes and tags, in your order: drag one to reorder, or drag a card in from Notes to star it. */
function renderFavorites() {
  // The tag Notes shows on its own (like a folder alone), which its favorite marks as open.
  const q = onPage() === "notes" && notesPage.scope === "active" ? notesPage.query : null;
  const shownTag = q?.tag && formatQuery(q) === formatQuery({ tag: q.tag }) ? (normalizeTag(q.tag) ?? "") : "";
  const rows = favorites.map((f) => {
    if (isTagFavorite(f)) {
      const row = tagFavoriteRow(f, f.tag === shownTag);
      favoriteDrop(row, "is-drop-before", favoriteKey(f));
      return row;
    }
    // An archived favorite stays, dimmed: archiving tidies search and the sidebar, not your stars.
    const archived = isArchived(f.path);
    const row = el(
      "div",
      {
        class: `tree-row is-file${f.path === active.session?.path ? " is-active" : ""}${archived ? " is-archived" : ""}`,
        "aria-current": f.path === active.session?.path && "page",
        style: { "--depth": "0" },
        title: f.path,
        draggable: "true",
        ...opens((e) => void openNote(f.path, { pane: e && sideClick(e) ? sideOf(active) : active })),
        ondragstart: (e: DragEvent) => {
          e.dataTransfer!.setData(FAVORITE, f.path);
          e.dataTransfer!.setData(NOTE_DRAG, f.path); // so it can go to a folder or Archive too
          document.body.classList.add("is-dragging");
          e.dataTransfer!.effectAllowed = "move";
        },
      },
      el("span", { class: "chev is-leaf" }),
      icon(f.kind === "html" ? "html" : "file", 14),
      el("span", { class: "tree-name" }, displayName(f.path)),
      archived ? el("span", { class: "n" }, "Archived") : null,
      el(
        "span",
        { class: "row-actions" },
        el("button", { type: "button", class: "row-act", title: `Open to the side (${SIDE_CLICK})`, onclick: (e: Event) => (e.stopPropagation(), void openNote(f.path, { pane: sideOf(active) })) }, icon("split", 14)),
        el("button", { type: "button", class: "row-act fav-star", title: "Remove from Favorites", onclick: (e: Event) => (e.stopPropagation(), void toggleStar(f.path)) }, icon("starred", 14)),
      ),
    );
    favoriteDrop(row, "is-drop-before", f.path);
    return row;
  });
  $("#favorites").replaceChildren(...(rows.length ? rows : [el("div", { class: "fav-hint" }, "Star a note or a tag to keep it here. A note's star is in its top bar: ", icon("star", 12))]));
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
  setCurrent($("#notes-btn"), showing === "");
  const shownTag = showing === null ? "" : (parseQuery(showing).tag ?? "");
  renderTagTree(shownTag && showing === formatQuery({ tag: shownTag }) ? shownTag.toLowerCase() : ""); // a tag alone, like a folder alone
  setCurrent($("#tasks-btn"), page === "tasks");
  setCurrent($("#history-btn"), page === "history" && !historyPage?.noteFilter);
  setCurrent($("#assets-btn"), page === "assets");
  setCurrent($("#archive-nav"), page === "notes" && notesPage.scope === "archived");
  setCurrent($("#tags-page-btn"), page === "tags", "is-on");

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
            "aria-current": showing === formatQuery({ folder: path }) && "page",
            style: { "--depth": String(depth) },
            "data-folder": path,
            title: n ? `Show the notes in ${path}` : `${path} is empty. Drag notes here.`,
            ...opens(() => void showNotes({ scope: "active", query: { folder: path } })),
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
            "aria-current": t.tag === active && "page",
            style: { "--depth": String(depth) },
            "data-tag": t.tag,
            title: `Notes tagged #${t.display}`,
            ...opens(() => openTag(t.display)),
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
          isTagStarred(t.display) ? el("span", { class: "fav-mark", title: "In Favorites" }, icon("starred", 11)) : null,
          el("span", { class: "n" }, String(t.notes)),
          el("span", { class: "row-actions" }, tagStarButton(t.display, "row")),
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
  if (prefs.folded.folders) $('[aria-controls="tree"]').click(); // unfold Folders, or the name field is hidden
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
  setLabel($("#split-btn"), `${split ? "Close the side pane" : "Split view"} (${formatKeys("Mod-Alt-\\")})`);
  $("#split-btn").classList.toggle("is-on", split);
  $("#save-status").hidden = !s;
  renderPaneBars();
  if (!s) {
    $("#html-toggle").hidden = true;
    for (const id of ["#vim-mode", "#cursor-pos", "#word-count"]) $(id).textContent = "";
    $("#vim-mode").dataset.mode = "";
    const label = { notes: "Notes", tasks: "Tasks", history: "History", assets: "Assets", tags: "Tags" };
    const note = page === "history" ? (historyPage?.noteFilter ?? null) : null;
    return crumbs.replaceChildren(
      ...(page ? [el("span", { class: "crumb-file" }, label[page])] : []),
      ...(note ? [el("span", { class: "crumb-sep" }, "·"), el("span", { class: "crumb" }, displayName(note))] : []),
    );
  }
  const starred = isStarred(s.id);
  $("#star-btn").classList.toggle("is-on", starred);
  setLabel($("#star-btn"), starred ? "Unstar (take out of Favorites)" : "Star (add to Favorites)");
  $("#star-btn").replaceChildren(icon(starred ? "starred" : "star", 16));
  const archived = isArchived(s.path);
  setLabel($("#archive-btn"), `${archived ? "Unarchive note" : "Archive note"} (${formatKeys("Mod-Shift-e")})`);
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
  $("#html-toggle").querySelectorAll("button").forEach((b) => setPressed(b, b.dataset.mode === prefs.htmlMode));
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
        if (r.updated.length) toast({ by: { source: "you", person: "you", agent: null }, text: `Renamed · updated links in ${r.updated.length} note${r.updated.length > 1 ? "s" : ""}` });
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
  const toggle = $("#vim-toggle");
  setPressed(toggle, prefs.vim);
  toggle.textContent = `Vim keys: ${prefs.vim ? "on" : "off"}`;
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
      const m = t.match(/^(#{1,6})[ \t]+(.+)$/);
      const words = m && headingText(m[2]);
      if (words) outlineHeadings.push({ level: m[1].length, text: (headingName(words) || words).replace(/[*_`~]|\[\[|\]\]/g, ""), line: i });
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
function renderActivity() {
  const entries = groupChanges(changes).slice(0, 30);
  const idsOf = (g: (typeof entries)[number]) => toRanges(changes.filter((c) => c.id >= g.first && c.id <= g.id).map((c) => c.id));
  void loadStats(entries.filter((g) => g.count > 1).map(idsOf)).then((fresh) => fresh && renderActivity());
  $("#activity").replaceChildren(
    ...(entries.length
      ? entries.map((c) => {
          const stat = entryStat(c, c.count > 1 ? idsOf(c) : "");
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
            authorAvatar(c, 22),
            el(
              "div",
              { class: "act-body" },
              el(
                "div",
                { class: "act-line" },
                el("b", {}, authorName(c)),
                ` ${changeVerb(c)} `,
                el("a", { onclick: (e: Event) => (e.stopPropagation(), openNote(c.path)) }, displayName(c.path)),
              ),
              el(
                "div",
                { class: "act-meta" },
                stat ? statEl(stat) : null,
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
  const bySource = new Map<string, Change>();
  for (const c of changes) if (c.ts > since && !isSelf(c.source) && !bySource.has(c.source)) bySource.set(c.source, c);
  const active = [...bySource.values()].slice(0, 4);
  $("#agents").replaceChildren(...active.map((c) => authorAvatar(c, 22)));
  $("#agents").title = active.length ? `Active in the last 15 min: ${active.map(authorName).join(", ")}` : "";
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
// `ic`, the inner code block: the code between a fenced block's fences, for yic, dic, cic and vic.
Vim.defineMotion("quireInnerCode", (_cm: unknown, head: { line: number; ch: number }) => {
  const { state } = active.view;
  const r = codeRange(state, state.doc.line(head.line + 1).from + head.ch);
  if (!r || r.to <= r.from) return head;
  const pos = (at: number) => {
    const line = state.doc.lineAt(at);
    return { line: line.number - 1, ch: at - line.from };
  };
  return [pos(r.from), pos(r.to)];
});
Vim.mapCommand("ic", "motion", "quireInnerCode", {}, { context: "operatorPending" });
Vim.mapCommand("ic", "motion", "quireInnerCode", {}, { context: "visual" });
Vim.defineAction("quireFollowLink", () => followLinkAtCursor());
Vim.mapCommand("gd", "action", "quireFollowLink", {}, { context: "normal" });
Vim.mapCommand("gf", "action", "quireFollowLink", {}, { context: "normal" });
Vim.defineAction("quireOpenSide", () => openLinkToSide(active.view));
Vim.mapCommand("gs", "action", "quireOpenSide", {}, { context: "normal" });
// Collapsible sections: za toggles the one under the cursor, zo/zc open and close it, zR/zM all of them.
for (const [keys, run] of [["za", foldAt("toggle")], ["zo", foldAt("open")], ["zc", foldAt("close")], ["zR", foldAll(true)], ["zM", foldAll(false)]] as const) {
  Vim.defineAction(`quireFold${keys}`, () => run(active.view));
  Vim.mapCommand(keys, "action", `quireFold${keys}`, {}, { context: "normal" });
}

function followLinkAtCursor() {
  const link = linkTargetAt(active.view.state, active.view.state.selection.main.head);
  if (!link) return;
  if (link.target) openTarget(link.target, active.session?.path);
  else if (link.href && /^https?:/i.test(link.href)) window.open(link.href, "_blank", "noopener");
  else if (link.href) openTarget(safeDecode(link.href), active.session?.path);
}

window.addEventListener(
  "keydown",
  (e) => {
    // Matched by the character typed, so they work on any keyboard layout (keys.ts).
    const is = (keys: string) => matchKeys(e, keys);
    const quickOpen = is("Mod-p") || is("Mod-k");
    if (quickOpen || is("Mod-Shift-p")) {
      e.preventDefault();
      paletteToSide = false;
      if (quickOpen && !palette.isOpen) did("search");
      palette.toggle(quickOpen ? "" : ">");
    } else if (is("Mod-\\")) {
      e.preventDefault();
      togglePanel();
    } else if (is("Mod-s")) {
      e.preventDefault();
      flushSave();
    } else if (is("Mod-Shift-e")) {
      e.preventDefault();
      void archiveCurrent();
    } else if (is("Mod-Shift-Enter")) {
      e.preventDefault();
      void setFocusMode(!focusMode);
    } else if (is("Mod-Shift-f")) {
      e.preventDefault();
      void showNotes({ filter: true });
    } else if (is("Mod-Alt-\\")) {
      e.preventDefault();
      void (split ? closePane(active) : openSplit());
    } else if ((is("Mod-Alt-[") || is("Mod-Alt-]")) && split) {
      e.preventDefault();
      const p = panes[is("Mod-Alt-[") ? 0 : 1];
      focusPane(p);
      if (p.session && p.session.kind !== "asset") p.view.focus();
    } else if (is(QUICK_ADD)) {
      // ⌘⇧. anywhere, the editor in any Vim mode too: the quick-add bar.
      e.preventDefault();
      e.stopPropagation(); // not the editor's (or Vim's) key as well
      quickAdd();
    } else if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !typingIn(e.target)) {
      // ? where you aren't typing: the shortcut sheet (a character, whichever key types it).
      e.preventDefault();
      toggleShortcuts(commands(), { vim: prefs.vim });
    } else if (is("Mod-e") && active.session?.kind === "html") {
      e.preventDefault();
      setHtmlMode(prefs.htmlMode === "preview" ? "source" : "preview");
    }
  },
  true,
);

/** The floating quick-add bar. From a note, Tab in it sends the task to that note. */
function quickAdd() {
  openQuickAdd({
    added: (r) => toast({ icon: "check", text: `Added to ${r.path.replace(/\.md$/, "")}`, actionLabel: "Open", action: () => void openNote(r.path, { line: r.line }) }),
    open: (path, line) => void openNote(path, { line }),
    note: active.session?.kind === "md" ? active.session.path : undefined,
  });
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

function toggleVim() {
  prefs.vim = !prefs.vim;
  store.set("vim", prefs.vim);
  taskInputPrefs.vim = prefs.vim;
  for (const p of panes) p.view.dispatch({ effects: vimSlot.reconfigure(prefs.vim ? vim() : []) });
  attachVim();
  active.view.focus();
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

  // Drag a note (a sidebar row, a Notes card, a task) or a link (in a note, a board's link card) to
  // the right edge to open it there. Inside a board, its columns take the drag first.
  const zone = $("#side-drop");
  const atEdge = (x: number) => x > stage.getBoundingClientRect().right - Math.max(96, stage.clientWidth * 0.18);
  const edge = (e: DragEvent) => !!e.dataTransfer?.types.some((t) => t === NOTE_DRAG || t === LINK_DRAG) && atEdge(e.clientX);
  stage.addEventListener("dragover", (e) => {
    zone.hidden = !edge(e);
    if (!zone.hidden) e.preventDefault();
  });
  stage.addEventListener("dragleave", (e) => !stage.contains(e.relatedTarget as Node) && (zone.hidden = true));
  stage.addEventListener("drop", (e) => {
    const on = !zone.hidden;
    zone.hidden = true;
    if (!on) return;
    const link = e.dataTransfer!.getData(LINK_DRAG);
    const path = e.dataTransfer!.getData(NOTE_DRAG);
    if (link) {
      e.preventDefault();
      const { target, from } = JSON.parse(link) as { target: string; from: string };
      return void openTarget(target, from, panes[1]);
    }
    if (!path || notes.find((n) => n.path === path)?.kind === "asset") return;
    e.preventDefault();
    void openNote(path, { pane: panes[1] });
  });
  document.addEventListener("dragend", () => (zone.hidden = true));
  // A [[link]] dragged in the editor (a pointer drag, see dragLink in editor/setup.ts).
  window.addEventListener(LINK_DRAG, (ev) => {
    const d = (ev as CustomEvent<LinkDrag>).detail;
    zone.hidden = d.phase === "drop" || !atEdge(d.x);
    if (d.phase === "drop" && atEdge(d.x)) void openTarget(d.target, d.from, panes[1]);
  });

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
  const onNote = !!parseNotePath(location.pathname);
  if (!onNote && (hash.startsWith("#/") || /^#(feed|tasks|assets|history)\b/.test(hash))) {
    const legacy = hash.startsWith("#/") ? safeDecode(hash.slice(2)) : "";
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
  const spot = onNote ? spotOf(hash) : {};
  if (path) return path === active.session?.path && !spot.line && !spot.heading ? undefined : openNote(path, { push: false, ...spot });
  if (link && workspaceId) {
    // Online, the link may be to a note in another of your workspaces: switch to it (?w= picks it).
    const where = await api.locate(link.id).catch(() => null);
    if (where && where.workspace.id !== workspaceId) return void (location.href = `${location.pathname}?w=${where.workspace.id}`);
  }
  if (link) toast({ text: workspaceId ? "That note doesn't exist, or you don't have access to it" : "That note doesn't exist any more" });
  setUrl("/notes", "replace");
  return showNotes({ push: false });
}

/**
 * Where in a note its address's #anchor points (it opens there, in whichever pane has the note): a
 * line (#L12), or a heading by its words or GitHub's slug of them (a copied heading link).
 */
function spotOf(hash: string): { line?: number; heading?: string } {
  const anchor = hash.length > 1 ? safeDecode(hash.slice(1)) : "";
  return /^L\d+$/.test(anchor) ? { line: Number(anchor.slice(1)) } : anchor ? { heading: anchor } : {};
}

/** The Tasks badge: how many checkboxes are still open across the workspace. */
async function refreshTaskCount() {
  const open = await api.openTasks().catch(() => null);
  if (open === null) return;
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
    account = renderAccount(who.me, ws, (t) => toast(t));
  }

  hydrateIcons();
  setupMobileNav();
  void learnLayout();
  window.addEventListener("focus", () => void learnLayout()); // the layout may have changed while away
  togglePanel(prefs.panel);
  $("#search-btn").addEventListener("click", () => openPalette());
  // A new note goes at the top level, unless Notes is showing a folder: then it goes there.
  $("#new-note").addEventListener("click", () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : ""));
  $("#panel-btn").addEventListener("click", () => togglePanel());
  setLabel($("#panel-btn"), `Toggle side panel (${formatKeys("Mod-\\")})`);
  setupPanes();
  $("#stage").addEventListener("mousedown", () => document.body.classList.remove("panel-overlay"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  // Whether long lines in code blocks wrap, for blocks that don't say (```ts nowrap / wrap do).
  const codeWrapChip = () => {
    const on = codeWrapByDefault();
    const chip = $("#codewrap-toggle");
    setPressed(chip, on);
    chip.textContent = `Wrap code: ${on ? "on" : "off"}`;
    chip.title = on ? "Long lines in code blocks wrap. Click to scroll them instead." : "Long lines in code blocks scroll. Click to wrap them.";
  };
  codeWrapChip();
  $("#codewrap-toggle").addEventListener("click", () => {
    setCodeWrapByDefault(!codeWrapByDefault());
    codeWrapChip();
    for (const p of panes) bumpEmbeds(p.view);
  });
  $("#vim-toggle").addEventListener("click", toggleVim);
  attachVim(); // the toggle's label, before any note opens
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
      alert: true,
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
  if (!viewer) void startGuide({ archive: (path) => void archivePath(path), flush: () => flushSave() });

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
    const spot = spotOf(location.hash);
    const main = notes.find((n) => n.id === layout.panes[0].note && n.kind !== "asset");
    if (main) await openNote(main.path, { pane: panes[0], focus: false, trail: false });
    else await showNotes({ push: false });
    focusPane(panes[1]);
    if (spot.line || spot.heading) await openNote(beside.path, { pane: panes[1], ...spot });
  } else await route();
}

boot();

(window as any).quire = { panes }; // handy in devtools
