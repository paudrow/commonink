import "./styles.css";
import "./motion.css";
import "./mobile.css";
import { EditorView } from "@codemirror/view";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { api, clientId, connect, favoriteKey, isArchived, isNoteFavorite, isSmartFavorite, isTagFavorite, unusedTag, useWorkspace, whoAmI, ApiError, type Backlink, type Change, type Favorite, type NoteMeta, type ServerMsg, type SmartFavorite, type SmartFolder, type TagCount, type TagFavorite, type UnlinkedMention } from "./api.ts";
import { cleanTag, normalizeTag, tagMatches } from "../../src/core/tags.ts";
import { $, authorAvatar, dragsPage, draggedPage, endPageDrag, onPageClick, PAGE_DRAG, startPageDrag, authorName, displayName, el, hueFor, hydrateIcons, icon, isSelf, LINK_DRAG, NOTE_DRAG, setCurrent, setLabel, setPressed, setSelfName, timeAgo, typingIn, type LinkDrag } from "./dom.ts";
import { toast } from "./toast.ts";
import { setSaveToDrive, setShareState, setShareWithPeople, SHARE_KEYS, toggleShareMenu, type ShareNote } from "./share.ts";
import type { Billing, Label, Me } from "./api.ts";
import { hideBanner, showBanner } from "./banner.ts";
import { showConflict as conflictBanner } from "./conflict.ts";
import { notesChanged } from "./editor/livePreview.ts";
import { createState, lineNumbersFor, lineNumbersSlot, openLinkToSide, remote, setVimDisplayLines, vimSlot } from "./editor/setup.ts";
import { linkTargetAt } from "./editor/linkAt.ts";
import { bumpEmbeds, codeRange, editorContext } from "./editor/blocks.ts";
import { refreshFolder } from "./editor/folderLine.ts";
import { codeWrapByDefault, setCodeWrapByDefault } from "./code.ts";
import { hasFencedCode } from "../../src/core/fence.ts";
import { foldAll, foldAt, foldCount } from "./editor/details.ts";
import { clearFlash, flashChanges } from "./editor/agentFlash.ts";
import { editsBetween, merge3 } from "./merge.ts";
import { sandboxFrame } from "./render.ts";
import { Palette } from "./palette.ts";
import { ensureContact } from "./people.ts";
import { NotesPage, type NotesTab } from "./notesPage.ts";
import { folderPicker } from "./folderPicker.ts";
import type { History } from "./history.ts";
import type { Assets } from "./assets.ts";
import { renderTasksPage } from "./tasksView.ts";
import { renderTodayPage } from "./todayView.ts";
import { askFor, askName, pickTemplate, templatePeople } from "./templatePicker.ts";
import { localNow, type TemplateInfo } from "../../src/core/templates.ts";
import { openQuickAdd, QUICK_ADD } from "./quickAdd.ts";
import { formatKeys, learnLayout, matchKeys } from "./keys.ts";
import { navArrows, type Dir, type NavArrows } from "./navArrows.ts";
import { cleanName, fixedName, nameFromHeading, nameLine, renamedPath } from "./noteName.ts";
import { taskInputPrefs } from "./taskInput.ts";
import type { TagsPage } from "./tagsPage.ts";
import type { QueryHelpPage } from "./queryHelpPage.ts";
import { QUERY_HELP } from "./queryHelp.ts";
import { lazyPage } from "./lazyPage.ts";
import type { CheckupPage } from "./checkupPage.ts";
import type { Theme } from "./settings.ts";
import { pickWorkspace, renderAccount, showSignIn, type AccountAction } from "./account.ts";
import { ADVANCED_KEYS, appCommands, type Renamable } from "./commands.ts";
import { toggleShortcuts } from "./shortcuts.ts";
import { NO_TIPS, tipText, watchTips, type TipsState } from "./shortcutTips.ts";
import { did, vaultEvents } from "./events.ts";
import { guideMessage, startGuide } from "./onboarding.ts";
import { watchTodayCleared } from "./todayCleared.ts";
import { awayStrip, startAway } from "./away.ts";
import { watchTodayRing } from "./todayRing.ts";
import { inkState, setInk, startInks } from "./inkUnlocks.ts";
import { gamified, loadGamified, onGamified, setGamified } from "./gamify.ts";
import { isTestSite, store } from "./store.ts";
import { changeVerb, groupChanges } from "../../src/core/format.ts";
import { entryStat, loadStats, statEl, toRanges } from "./changeStats.ts";
import { closeOthers, closeTabs, closeToRight, currentTab, emptyGroup, insertTab, jumpIndex, moveTab, newLayout, nudgeTab, openEntry, parseLayout, pinTab, setTrail, showTab, stepIndex, tabIndex, takeTab, type Group, type Tab } from "./tabs.ts";
import { openMenu, under, type MenuItem } from "./menu.ts";
import { clampSide, clickWhere, dropDock, forget, historyStep, IS_MAC, pageEntry, pageOf, rememberPlace, SIDE_CLICK, step, trailAhead, type Dock, type PaneTrail, type Place, type Where } from "./panes.ts";
import { headingName, headingText, proseLines } from "../../src/core/prose.ts";
import { headingMatches } from "../../src/core/gfm.ts";
import { formatQuery, parseQuery, tagList, type NoteQuery } from "../../src/core/query.ts";
import { tagPicker } from "./tagPicker.ts";
import { NEW_BOARD } from "../../src/core/kanban.ts";
import { smartFolderEditor, suggestName } from "./smartFolderEditor.ts";
import { NOTE_ID, notePath, parseNotePath } from "../../src/core/ids.ts";
import { watchTimers } from "./widgets/timer.ts";
import { safeDecode } from "../../src/core/uri.ts";
import { deleteFolder, deletePaths, Trash, type DeleteHooks } from "./trash.ts";
import { confirmAction } from "./modal.ts";
import { mountSharedView, sharedRoute } from "./sharedView.ts";
import { showShareDialog } from "./shareDialog.ts";
import { rowMenu, type RowMenuItem } from "./rowMenu.ts";
import { renderSharedList, sharedPage } from "./sharedPage.ts";
import { CapturePage, registerWorker } from "./capture.ts";
import { AGENTS_BLURB, isAgentsNote } from "./agentsNote.ts";
import { closeDrawer, renderMore, setupMobileNav } from "./mobileNav.ts";
import { nameField, plusMark, sectionHint, shownItems, sidebarTags, type OptionalItem } from "./sidebar.ts";
import { PEOPLE } from "../../src/core/contacts.ts";
import type { CalendarPage } from "./calendar/page.ts";
import { calendarChanged, calendars, setCalendarContext } from "./calendar/data.ts";
import { calendarTarget, OPEN_CALENDAR } from "./links.ts";
import { connectUrl, googleChanged, googleKnown, googleOutcome, googleStatus, leave } from "./calendar/google.ts";

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
  /** The last save didn't reach the server (offline, or it failed): it's tried again until it does. */
  failed: boolean;
  /** The words of the heading that names it (see noteName.ts), as last seen; null without one. */
  heading: string | null;
  /** You changed that heading here, so the file is renamed to match (see retitle). An agent changing it on disk doesn't. */
  retitle: boolean;
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
  /** The strip over its note, for something about that note (archived, a conflict…). */
  banner: HTMLElement;
  /** Its tabs (tabs.ts): notes, and in the main pane pages too, the one showing first among them. */
  group: Group;
  /** The showing tab's back and forward (setting it changes that tab's). */
  trail: PaneTrail;
  /** Counts what the pane was asked to show, so a note that loads after a later request doesn't replace it. */
  opens: number;
}

// An early Today page stored a "Start on Today" choice; the app always opens on Notes.
try {
  localStorage.removeItem("commonink.startOnToday");
} catch {}

const prefs = {
  /** Off until you turn it on (in Vim, a stray Esc then `dd` deletes a line); on where we test it. */
  vim: store.get("vim", isTestSite()),
  /** In vim, j and k move by the line on screen (gj, gk), not the line in the file. */
  vimDisplayLines: store.get("vimDisplayLines", false),
  lineNumbers: store.get("lineNumbers", false),
  panel: store.get("panel", true),
  htmlMode: store.get<"preview" | "source">("htmlMode", "preview"),
  /** Folders whose subfolders are showing in the sidebar (they start closed). */
  expanded: new Set<string>(store.get<string[]>("expanded", [])),
  /** Tags whose nested tags are showing in the sidebar (they start closed). */
  tagsOpen: new Set<string>(store.get<string[]>("tagsOpen", [])),
  /** Sidebar sections folded away from their header. Folders start folded: the sidebar leads with tags. */
  folded: { favorites: false, smart: false, folders: true, tags: false, ...store.get<Record<string, boolean>>("folded", {}) } as Record<string, boolean>,
  /** Contacts, Calendar, Assets and Smart folders kept in the sidebar before they're in use (Settings, Sidebar). */
  sidebarPinned: store.get<Partial<Record<OptionalItem, boolean>>>("sidebarPinned", {}),
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
/** You see a calendar here: a subscription, a Google calendar, or the workspace's own, which its first event makes. */
let hasCalendars = false;
/** Optional sidebar items asked for from ⌘K this visit (New smart folder), kept showing until you reload. */
const revealed = new Set<OptionalItem>();

const layoutKey = () => `layout:${workspaceId || "local"}`;
/** How the window was split, and each pane's trail; read again once the workspace is known (see boot). */
let layout = newLayout();
const makePane = (index: 0 | 1, host: HTMLElement, preview: HTMLElement, bar: HTMLElement, banner: HTMLElement): Pane => ({
  index,
  view: new EditorView({ parent: host }),
  session: null,
  host,
  preview,
  bar,
  banner,
  group: emptyGroup(),
  get trail(): PaneTrail {
    return currentTab(this.group) ?? { note: null, back: [], forward: [] };
  },
  set trail(t: PaneTrail) {
    this.group = setTrail(this.group, t);
  },
  opens: 0,
});
const panes: [Pane, Pane] = [makePane(0, $("#editor-host"), $("#html-preview"), $("#main-bar"), $("#banner")), makePane(1, $("#side-host"), $("#side-preview"), $("#side-bar"), $("#side-banner"))];
let active = panes[0];
let split = false;
const other = (p: Pane) => panes[1 - p.index];
/** A note opened from a page: in the main pane, or beside it while split; in a new tab there, or to the side. */
const fromPage = (path: string, line?: number, where: Where = "here") => void openNote(path, { line, pane: split || where === "side" ? panes[1] : panes[0], newTab: where === "tab" });
const notesPage = new NotesPage({
  open: fromPage,
  starred: (id) => isStarred(id),
  toggleStar: (path) => void toggleStar(path),
  filtersChanged: () => {
    renderTree();
    syncNotesTab();
  },
  tags: () => tags,
  saveQuery: (anchor, query) => saveSmartFolder(query, "", anchor),
  advanced: (anchor) => saveSmartFolder(formatQuery(notesPage.query), "", anchor, false, true),
  starButton: (q) => queryStarButton(q),
  openPerson: (assignee) => void showTasks({ assignee }),
  readOnly: () => viewer,
  shared: (item) => !!workspaceId && isShared(item.id, item.path),
  delete: (paths) => deletePaths(paths, deleteHooks),
  rename: (path) => void renamePath(path),
  toast: (t) => toast(t),
  changed: () => {
    api.clearResolveCache();
    void refreshNotes();
  },
  newNote: (folder) => void newNote(folder),
  goTab: (tab) => void showNotes({ tab }),
  trash: () => (viewer ? null : (trash ??= new Trash({ ...deleteHooks, canPurge: () => owner, open: (path) => fromPage(path) }))),
});
/** What deleting (and restoring from Trash) needs: a toast, and everything that lists notes brought up to date. */
const deleteHooks: DeleteHooks = {
  toast: (t) => toast(t),
  changed: async () => {
    api.clearResolveCache();
    await refreshNotes();
    notesPage.refreshSoon();
    assetsPage?.refresh();
  },
};
let trash: Trash | null = null;
let capturePage: CapturePage | null = null;
// History, Assets and Tags load the first time they're opened (each is null until then).
let historyPage: History | null = null;
let assetsPage: Assets | null = null;
let tagsPage: TagsPage | null = null;
let queryHelpPage: QueryHelpPage | null = null;
let checkupPage: CheckupPage | null = null;
let replacePage: import("./replacePage.ts").ReplacePage | null = null;
let contactsPage: import("./contactsPage.ts").ContactsPage | null = null;
let calendarPage: CalendarPage | null = null;
/** A page whose code is fetched the first time it's shown; see lazyPage.ts for when that fetch fails. */
const page = <T>(at: string, load: () => Promise<T>) =>
  lazyPage(at, load, (err) => {
    console.error(err);
    toast({ error: true, text: "Couldn't load that page. Check your connection, then try again." });
    void showNotes({ tab: "notes" });
  });
const loadHistory = page("/history", async () =>
  (historyPage = new (await import("./history.ts")).History({
    open: (path) => fromPage(path),
    toast: (t) => toast(t),
    readOnly: viewer,
  })),
);
const loadAssets = page("/assets", async () =>
  (assetsPage = new (await import("./assets.ts")).Assets({
    notes: () => notes,
    upload: (files) => uploadFiles(files),
    open: (path) => fromPage(path),
    archive: (path) => archivePath(path),
    delete: (paths) => (viewer ? Promise.resolve([]) : deletePaths(paths, deleteHooks)),
    rename: (path) => renameAsset(path),
    readOnly: () => viewer,
    embedName: (path) => embedName(path),
    tags: () => tags,
    refreshTags: () => refreshNotes(),
    toast: (t) => toast(t),
  })),
);
const loadContacts = page("/contacts", async () =>
  (contactsPage = new (await import("./contactsPage.ts")).ContactsPage($("#contacts-view"), {
    open: (path, line, where) => fromPage(path, line, where),
    openTag: (tag) => openTag(tag, "tasks"),
    openPerson: (assignee) => void showTasks({ assignee }),
    // A contact's page is drawn already: just the address bar and title. Back to the list shows it.
    navigate: (c) => (c ? (setUrl(`/contacts?c=${c.id}`), (document.title = `${c.name} · Contacts · Common Ink`)) : void showContacts()),
    canEdit: () => !viewer,
    toast: (t) => toast(t),
  })),
);
const loadTags = page("/tags", async () =>
  (tagsPage = new (await import("./tagsPage.ts")).TagsPage($("#tags-view"), {
    tags: () => tags,
    refresh: () => refreshNotes(),
    openTag: (tag, where) => openTag(tag, where),
    deleteTag: (t) => deleteTag(t),
    readOnly: () => viewer,
    toast: (t) => toast(t),
  })),
);
const loadQueryHelp = page("/query-help", async () =>
  (queryHelpPage = new (await import("./queryHelpPage.ts")).QueryHelpPage($("#query-help-view"), {
    tryQuery: (q) => void showNotes({ tab: "notes", query: { q } }),
  })),
);
const loadCheckup = page("/checkup", async () =>
  (checkupPage = new (await import("./checkupPage.ts")).CheckupPage($("#checkup-view"), {
    open: (path, line) => fromPage(path, line),
    contacts: () => void showContacts(),
    delete: (path) => deletePaths([path], deleteHooks),
    archive: (path) => archivePath(path),
    readOnly: () => viewer,
  })),
);
const loadCalendar = page("/calendar", async () =>
  (calendarPage = new (await import("./calendar/page.ts")).CalendarPage($("#calendar-view"), {
    open: (path, line, where) => fromPage(path, line, where),
    setUrl: (url) => setUrl(url, "replace"),
  })),
);
/** Where the palette's next pick opens: to the side (⌘⌥\ with nothing to show there yet), in a new tab (the tab strip's +), or in place. */
let paletteHow: Where = "here";
const palette = new Palette(
  () => notes,
  (path, line, how) => {
    const to = how === "here" ? paletteHow : how;
    return openNote(path, { line, pane: to === "side" ? sideOf(active) : active, newTab: to === "tab" });
  },
  (name) => createNote(name),
  () => commands(),
  {
    headings: () => noteHeadings(),
    goToHeading: (line) => (goToLine(active, line), active.view.focus()),
    tags: () => tags.filter((t) => !unusedTag(t)),
    // A tag only tasks carry opens in Tasks, as its sidebar row does.
    openTag: (tag) => void pageFromPalette(() => openTag(tag, tags.some((t) => t.display === tag && !t.notes && !t.assets && t.tasks > 0) ? "tasks" : "notes")),
    folders: () => allFolders(),
    smartFolders: () => smartFolders,
    // Picked from ⌘T, a folder or smart folder opens in a new tab too.
    openFolder: (folder) => void pageFromPalette(() => showNotes({ tab: "notes", query: { folder } })),
    openSmartFolder: (query) => void pageFromPalette(() => showNotes({ tab: "notes", query: parseQuery(query) })),
    openPerson: async (p) => {
      // A member with no contact gets one, as `@` does when you mention them.
      const path = p.contact?.path ?? (await ensureContact(p.name, p.member?.email).catch(() => null));
      const id = p.contact?.id ?? (path && (await api.contacts().catch(() => [])).find((c) => c.path === path)?.id);
      if (id) void showContacts({ contact: id });
    },
  },
);
/** A page picked in the palette: in a new tab if it was opened for one (⌘T), else here. */
const pageFromPalette = (open: () => unknown) => (paletteHow === "tab" ? openPageInTab(open) : open());
function openPalette(side = false) {
  paletteHow = side ? "side" : "here";
  did("search");
  palette.open();
}

/** Online, the account menu's actions (⌘K offers them too). */
let account: AccountAction[] = [];
/** Everything ⌘K can do right now, and every shortcut the sheet lists. */
function commands() {
  const s = active.session;
  const onNotes = onPage() === "notes";
  const tagNames = onNotes ? tagList(notesPage.query.tag) : [];
  const tag = tagNames.length === 1 ? tagNames[0] : null;
  return appCommands({
    tag: tag ? { name: tag, starred: isTagStarred(tag) } : null,
    notesFiltered: onNotes && notesPage.tab === "notes" && !!formatQuery(notesPage.query),
    note: s ? { kind: s.kind, starred: isStarred(s.id), archived: isArchived(s.path) } : null,
    vim: prefs.vim,
    vimDisplayLines: prefs.vimDisplayLines,
    lineNumbers: prefs.lineNumbers,
    split,
    tabs: active.group.tabs.length,
    pinned: !!currentTab(active.group)?.pinned,
    closedTabs: closedTabs.length,
    focusMode,
    htmlMode: prefs.htmlMode,
    hasStart: tags.some((t) => t.tag === "start" && t.notes > 0),
    canBack: active.trail.back.length > 0,
    canForward: active.trail.forward.length > 0,
    onLink: s?.kind === "md" && !!linkTargetAt(active.view.state, active.view.state.selection.main.head),
    canDelete: !viewer,
    online: !!workspaceId,
    canSubscribe: !viewer,
    canConnectGoogle: !!googleKnown() && googleKnown()!.mode !== "off" && !googleKnown()!.connection?.calendar,
    folds: s?.kind === "md" ? foldCount(active.view.state) : 0,
    renames: renameTarget()?.what ?? null,
    account,
    newNote: () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : ""),
    newFromTemplate: () => void newFromTemplate(undefined, onPage() === "notes" ? (notesPage.query.folder ?? "") : ""),
    newBoard: () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : "", `\n${NEW_BOARD}\n`),
    newFolder: startNewFolder,
    newTag: startNewTag,
    newSmartFolder: newSmartFolderFromPalette,
    saveFilters: () => notesPage.saveFilters(),
    starTag: () => (tag ? void toggleTagStar(tag) : pickTag("Star or unstar a tag…", (t) => void toggleTagStar(t))),
    renameTag: () => (tag ? void renameTagOnPage(tag) : pickTag("Rename which tag?", (t) => void renameTagOnPage(t))),
    newContact: async () => {
      await showContacts();
      void contactsPage?.newContact();
    },
    importContacts: async () => {
      await showContacts();
      contactsPage?.importFile();
    },
    restoreVersion: () => void restoreVersion(),
    go: (page) => {
      if (page === "notes" || page === "archive" || page === "trash") void showNotes({ tab: page, query: {} });
      else void { today: showToday, tasks: showTasks, calendar: showCalendar, contacts: showContacts, tags: showTags, assets: showAssets, history: showHistory, shared: showShared, checkup: showCheckup, "query-help": showQueryHelp }[page]();
    },
    subscribeCalendar: () => void subscribeCalendar(),
    refreshCalendars: () => void refreshCalendars(),
    connectGoogle: () => leave.to(connectUrl()),
    newEvent: async () => {
      await showCalendar();
      calendarPage?.newEvent();
    },
    filterNotes: () => void showNotes({ filter: true }),
    advancedSearch: () => void advancedSearch(),
    quickAdd,
    toggleTheme,
    toggleVim,
    toggleVimDisplayLines,
    toggleLineNumbers,
    togglePanel: () => togglePanel(),
    toggleFocus: () => void setFocusMode(!focusMode),
    toggleSplit: () => void (split ? closePane(active) : openSplit()),
    newTab: () => newTab(),
    closeTab: closeActiveTab,
    reopenTab: () => void reopenTab(),
    closeOtherTabs: () => void closeIn(active, closeOthers(active.group, active.group.at), active.group.at),
    closeTabsToRight: () => void closeIn(active, closeToRight(active.group, active.group.at), active.group.at + 1),
    togglePin: () => pinTabIn(active, active.group.at, !currentTab(active.group)?.pinned),
    stepTab: (by) => stepTabIn(active, by),
    moveTab: (by) => nudgeTabIn(active, active.group.at, by),
    toggleHtml: () => setHtmlMode(prefs.htmlMode === "preview" ? "source" : "preview"),
    star: () => s && void toggleStar(s.path),
    archive: () => void archiveCurrent(),
    delete: () => void deleteCurrent(),
    shareWithPeople: () => active.session && openShareDialog({ path: active.session.path }),
    move: () => openMovePicker($("#move-btn")),
    rename: () => renameTarget()?.run(),
    noteHistory: () => s && void showHistory({ note: s.path }),
    labelVersion: () => void labelCurrent(),
    noteLabels: () => s && void showHistory({ note: s.path }),
    gettingStarted: async () => {
      const start = (await api.feed({ tag: "start", limit: 1 }).catch(() => null))?.items[0];
      if (start) void openNote(start.path);
    },
    shortcuts: () => toggleShortcuts(commands(), { vim: prefs.vim }),
    share: openShare,
    copyLink: () => void copyLink(),
    replaceAcross: () => void showReplace(),
    exportAs: (how) => void exportNote(how),
    saveToDrive: () => void saveNoteToDrive(),
    exportWorkspace: () => void exportZip({ all: true }),
    importNotes: () => void importNotes(),
    settings: openSettings,
    connectAgent,
    back: () => void stepPane(active, "back"),
    forward: () => void stepPane(active, "forward"),
    followLink: () => followLinkAtCursor(),
    foldAll: (open) => foldAll(open)(active.view),
  });
}

// ------------------------------------------------------------------ opening notes

/** Where you were in each note (by ID): the cursor and the scroll, so going back puts you there. Kept in this browser. */
let places: Record<string, Place> = store.get("places", {});
/**
 * The scroll for a remembered place: a scroll snapshot (see EditorView.scrollSnapshot) rebuilt from
 * its line and offset, since a snapshot itself can't be kept across a reload. A snapshot restores
 * the view exactly; a scrollIntoView with the same margin lands elsewhere. CodeMirror doesn't export
 * its ScrollTarget, so this takes the class and the effect type from a fresh snapshot.
 */
function placeScroll(view: EditorView, place: Place) {
  const like = view.scrollSnapshot() as unknown as { value: object; type: { of(value: unknown): ReturnType<EditorView["scrollSnapshot"]> } };
  const Target = like.value.constructor as new (range: unknown, y: string, x: string, yMargin: number, xMargin: number, isSnapshot: boolean) => object;
  return like.type.of(new Target(EditorSelection.cursor(Math.min(place.top, view.state.doc.length)), "start", "start", place.off, 0, true));
}

/** Remember where a pane is in its note, before it shows something else. */
function keepPlace(p: Pane) {
  const s = p.session;
  if (!s || s.kind === "asset") return;
  // The line at the top of the view and how far into it, as CodeMirror's scroll snapshot has them,
  // so the view comes back the same (a snapshot itself can't be kept across a reload).
  const snap = p.view.scrollSnapshot().value as { range: { head: number }; yMargin: number };
  places = rememberPlace(places, s.id, { pos: p.view.state.selection.main.head, top: snap.range.head, off: Math.round(snap.yMargin) });
  store.set("places", places);
}

/**
 * Open a note in a pane (the focused one by default). A note shows in one pane at a time: if the
 * other pane has it, that pane takes the focus instead. `trail: false` is a step back or forward.
 */
async function openNote(path: string, opts: { line?: number; heading?: string; push?: boolean; pane?: Pane; trail?: boolean; focus?: boolean; newTab?: boolean; index?: number } = {}) {
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
  if (pane.session) await retitle(pane.session);
  keepPlace(pane);
  const meta = notes.find((n) => n.path === path);
  if (meta?.kind === "asset") return showAssets({ open: meta.path, push: opts.push });

  let note;
  try {
    note = await api.note(path);
  } catch {
    return toast({ text: `Couldn't open ${path}` });
  }
  if (ticket !== pane.opens) return; // something else was opened here while this loaded
  hideBanner(pane.banner);
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
    failed: false,
    timer: 0,
    edited: false,
    heading: null,
    retitle: false,
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
        lineNumbers: prefs.lineNumbers,
        readOnly: viewer,
        context: {
          path: note.path,
          id: note.id,
          // Followed from one pane of a split, a link or card opens in the other. ⌘-click opens it in a
          // new tab there, ⌘⌥-click to the side.
          openTarget: (target, from, o) => void openTarget(target, from, split || o?.where === "side" ? other(pane) : pane, o?.where === "tab"),
          createNote,
          notes: () => notes,
          upload: (files) => uploadFiles(files),
          tags: () => tags,
          folders: () => allFolders(),
          openTag,
          openPerson: (assignee) => void showTasks({ assignee }),
          openFolder: (folder) => void showNotes({ folder }),
          saveSmartFolder,
          noteUrl: () => notePath(next.title, next.id),
        },
        onUpdate: (docChanged, fromRemote, state) => onUpdate(next, docChanged, fromRemote, state),
      }),
    );
  } catch (e) {
    console.error(e);
    return showBanner(`Couldn't open ${note.path} in the editor. Reload the page to try again.`, [], { in: pane.banner });
  }
  if (note.kind === "md") next.heading = nameLine(pane.view.state.doc).text;
  pane.session = next;
  // Its tab: the one you're on, a new one, or (a step back or forward, a tab picked) the one showing.
  if (opts.trail === false) pane.trail = { ...pane.trail, note: note.id };
  else placeTab(pane, note.id, opts.newTab, opts.index);
  resetVimJumps();
  // Split, the banner is over this pane only: Unarchive puts back this pane's note, whichever has the focus.
  if (isArchived(note.path)) showBanner("This note is archived. It's hidden from search and the sidebar.", [["Unarchive", () => void archiveCurrent(pane)]], { in: pane.banner, info: true });
  else if (isAgentsNote(note.path)) showBanner(AGENTS_BLURB, [], { in: pane.banner, info: true });
  pane.host.classList.toggle("is-code", note.kind === "html");
  showNoteIn(pane);
  if (pane.index === 1 && !split) setSplit(true);

  const line = opts.line ?? (opts.heading ? headingLine(pane, opts.heading) : undefined);
  if (line) goToLine(pane, line);
  else {
    // Start below the frontmatter so it renders as properties rather than raw YAML.
    const fm = note.kind === "md" ? note.content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/) : null;
    // Back where you were in it (the same note reopened keeps its view), else the top. Scrolled by
    // the view, as goToLine scrolls: setting scrollDOM.scrollTop = 0 lost to CodeMirror, which on
    // focus puts back the scroll position the last note had.
    const place = keep ? null : places[note.id];
    const pos = Math.min(keep?.head ?? place?.pos ?? (fm ? fm[0].length : 0), pane.view.state.doc.length);
    const top = place ? placeScroll(pane.view, place) : EditorView.scrollIntoView(0, { y: "start", yMargin: 80 });
    pane.view.dispatch({ selection: { anchor: pos }, effects: keep?.scroll ?? top, userEvent: "select.jump" });
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
  layout = { split, at: layout.at, side: layout.side, focus: active.index, groups: [panes[0].group, panes[1].group] };
  store.set(layoutKey(), layout);
}

/** Show or hide the side pane. Hiding it lets its note go (the caller saves it first). */
function setSplit(on: boolean) {
  split = on;
  document.body.classList.toggle("is-split", on);
  document.body.dataset.dock = layout.at;
  $("#pane-divider").setAttribute("aria-orientation", layout.at === "top" || layout.at === "bottom" ? "horizontal" : "vertical");
  $("#side-pane").hidden = !on;
  $("#pane-divider").hidden = !on;
  $("#main-bar").hidden = !on;
  if (!on) hideBanner(panes[1].banner);
  $("#stage").style.setProperty("--side", `${layout.side * 100}%`);
  if (!on) {
    // The side pane's tabs close; the one it showed is kept, for the next split to show again.
    panes[1].session = null;
    const kept = currentTab(panes[1].group);
    rememberClosed(panes[1], panes[1].group.tabs.filter((t) => t !== kept), 0);
    panes[1].group = kept ? { tabs: [kept], at: 0 } : emptyGroup();
    saveLayout();
  }
  renderPaneBars();
  for (const p of panes) p.view.requestMeasure();
}

/** Where the side pane goes when the window next splits (an open split stays where it is). */
function dockAt(at: Dock) {
  if (split) return;
  layout.at = at;
  document.body.dataset.dock = at;
}

/** Close a pane, back to one. Closing the main pane moves the side pane's note into it. */
async function closePane(p: Pane) {
  if (!split) return;
  const side = panes[1];
  await flushSave();
  const moving = p.index === 0 ? side.session : null;
  // Closing the main pane, its tabs close with it and the side pane's come over.
  if (p.index === 0) {
    rememberClosed(panes[0], panes[0].group.tabs, 0);
    [panes[0].group, side.group] = [side.group, emptyGroup()];
  }
  keepPlace(side);
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

/** Can a step in pane `p` land on this trail entry (a note that's there and not in the other pane, or a page in the main pane)? */
function stepsTo(p: Pane, entry: string): boolean {
  const page = pageOf(entry);
  if (page !== null) return p.index === 0;
  const path = notes.find((n) => n.id === entry)?.path;
  return !!path && path !== other(p).session?.path;
}

/** A trail entry as the back and forward menus name it: a note's title, or a page's name. */
function entryTitle(entry: string): string {
  const page = pageOf(entry);
  if (page === null) return notes.find((n) => n.id === entry)?.title ?? "Untitled";
  const name = page.slice(1).split(/[?/]/)[0] as keyof typeof PAGE_LABEL;
  // Notes narrowed: the smart folder, the folder or the tag it shows.
  const q = name === "notes" ? new URLSearchParams(page.split("?")[1] ?? "").get("q") : null;
  if (q) {
    const smart = smartFolders.find((f) => f.query === q);
    const { folder, tag } = parseQuery(q);
    if (smart) return smart.name;
    if (folder && q === formatQuery({ folder })) return folder.split("/").pop()!;
    if (tag && q === formatQuery({ tag })) return `#${tag}`;
  }
  return PAGE_LABEL[name] ?? page;
}

/** Back and forward, as the arrows show them for pane `p`: what's each way, and the shortcuts. */
function navState(p: Pane) {
  const label = (dir: Dir) => {
    const keys = [formatKeys(dir === "back" ? "Mod-[" : "Mod-]"), ...(prefs.vim ? [formatKeys(dir === "back" ? "Ctrl-o" : "Ctrl-i")] : [])];
    return `${dir === "back" ? "Back" : "Forward"} (${keys.join(", ")})`;
  };
  const ahead = (dir: Dir) => trailAhead(p.trail, dir, (entry) => stepsTo(p, entry)).map(entryTitle);
  return { back: ahead("back"), forward: ahead("forward"), labels: { back: label("back"), forward: label("forward") } };
}

/** The top bar's arrows (for the focused pane) and each split pane's own. */
const topArrows = navArrows((dir, steps) => stepPane(active, dir, steps));
const paneArrows: NavArrows[] = [];

// ------------------------------------------------------------------ tabs (tabs.ts)

/** Tabs closed lately, newest last, for ⌘⇧T: the pane, where in its strip, and the tab with its back and forward. */
const closedTabs: Array<{ pane: 0 | 1; index: number; tab: Tab }> = [];
function rememberClosed(p: Pane, tabs: Tab[], index: number) {
  for (const tab of tabs) closedTabs.push({ pane: p.index, index, tab });
  closedTabs.splice(0, Math.max(0, closedTabs.length - 25));
}

/** The next note or page opened goes in a new tab: before `index` (a drop on a strip), else after the one showing. */
let openNext: { index?: number } | null = null;

/**
 * Put what a pane is opening (a note's ID or a page's entry) in its tabs: here, or in a new tab.
 * A note is a tab in one pane at a time, so it leaves the other pane's; and the side pane, as the
 * window splits, starts with just this tab.
 */
function placeTab(p: Pane, entry: string, newTab = false, index?: number) {
  const next = openNext;
  openNext = null;
  p.group = openEntry(p.group, entry, newTab || next ? "new" : "here", index ?? next?.index);
  const there = other(p);
  const i = tabIndex(there.group, entry);
  if (i >= 0 && pageOf(entry) === null) there.group = closeTabs(there.group, [i]).group;
  if (p.index === 1 && !split) p.group = { tabs: [currentTab(p.group)!], at: 0 };
  saveLayout();
}

/** Show a page (what its sidebar row's `open` shows) in a new tab of the main pane, before `index` if given. */
async function openPageInTab(open: () => unknown, index?: number) {
  openNext = { index };
  try {
    await open();
  } finally {
    openNext = null;
  }
}

/** Open a note in a new tab of `p`, keeping the one it shows. */
const openInNewTab = (path: string, p: Pane = active) => void openNote(path, { pane: p, newTab: true });

/** A pane's tabs without the notes that are gone (but the one showing, with `keepShown`). */
const pruneGroup = (g: Group, keepShown = false) =>
  closeTabs(
    g,
    g.tabs.flatMap((t, i) => (t.note && pageOf(t.note) === null && !tabNote(t.note) && !(keepShown && i === g.at) ? [i] : [])),
  ).group;

/** A tab's note, while it's still there. */
const tabNote = (entry: string | null) => (entry ? notes.find((n) => n.id === entry && n.kind !== "asset") : undefined);

/** Each page's icon, as the sidebar has it. */
const PAGE_ICON: Record<string, string> = { today: "sun", notes: "feed", archive: "archive", trash: "trash", tasks: "task", calendar: "calendar", contacts: "user", history: "history", assets: "grid", tags: "sliders", checkup: "check", replace: "edit", shared: "share", capture: "spark", "query-help": "code" };
function pageIcon(url: string): string {
  const name = url.slice(1).split(/[?/]/)[0];
  const q = name === "notes" ? new URLSearchParams(url.split("?")[1] ?? "").get("q") : null;
  if (q) return smartFolders.some((f) => f.query === q) ? "folderSearch" : parseQuery(q).folder ? "folder" : parseQuery(q).tag ? "hash" : "search";
  return PAGE_ICON[name] ?? "file";
}

/**
 * Show the tab `p` is on: its note, or in the main pane its page. With none left, the side pane
 * closes (split, the main pane gives way to the side pane's), and alone the main pane shows Notes.
 */
async function showCurrent(p: Pane): Promise<void> {
  const t = currentTab(p.group);
  if (!t?.note) {
    if (split) return closePane(p);
    if (p.index === 0) await showNotes({ tab: "notes", query: {} });
    return;
  }
  const page = pageOf(t.note);
  if (page !== null) {
    if (p.index === 1) return;
    history.replaceState({ i: historyAt }, "", page);
    return route();
  }
  const n = tabNote(t.note);
  if (!n) {
    p.group = closeTabs(p.group, [p.group.at]).group; // gone: the next one
    return showCurrent(p);
  }
  await openNote(n.path, { pane: p, trail: false });
}

/** Is the tab at `i` the one `p` shows now? */
function showing(p: Pane, i: number) {
  const entry = p.group.at === i ? p.group.tabs[i]?.note : null;
  if (!entry) return false;
  return pageOf(entry) !== null ? p.index === 0 && onPage() !== null : p.session?.id === entry && (p.index === 1 || onPage() === null);
}

/** Show the tab at `i` of `p` (a click on it, ⌃Tab, ⌘1…). */
async function activateTab(p: Pane, i: number) {
  if (!p.group.tabs[i]) return;
  if (showing(p, i)) {
    if (p !== active) focusPane(p);
    if (p.session && p.session.kind !== "asset") p.view.focus();
    return;
  }
  p.group = showTab(p.group, i);
  saveLayout();
  await showCurrent(p);
}

/** Close tabs (`r` from tabs.ts), and show whichever is left on if the one showing went. */
async function closeIn(p: Pane, r: { group: Group; closed: Tab[] }, index: number) {
  const before = currentTab(p.group);
  rememberClosed(p, r.closed, index);
  p.group = r.group;
  saveLayout();
  if (before && r.closed.includes(before)) await showCurrent(p);
  else renderPaneBars();
}
const closeTabAt = (p: Pane, i: number) => closeIn(p, closeTabs(p.group, [i]), i);
/** ⌘W, :q: close the tab the focused pane shows. */
const closeActiveTab = () => active.group.at >= 0 && void closeTabAt(active, active.group.at);

/** ⌘⇧T: open the tab closed last again, where it was, with its back and forward. */
async function reopenTab() {
  const last = closedTabs.pop();
  if (!last?.tab.note) return;
  const page = pageOf(last.tab.note) !== null;
  if (!page && !tabNote(last.tab.note)) return reopenTab(); // gone since: the one before it
  const p = last.pane === 1 && split && !page ? panes[1] : panes[0];
  const there = other(p);
  if (!page && split && there.session?.id === last.tab.note) return focusPane(there);
  const have = tabIndex(p.group, last.tab.note);
  p.group = have >= 0 ? showTab(p.group, have) : insertTab(p.group, last.tab, last.index);
  const j = page ? -1 : tabIndex(there.group, last.tab.note);
  if (j >= 0) there.group = closeTabs(there.group, [j]).group;
  saveLayout();
  await showCurrent(p);
}

/** ⌃Tab and ⌃⇧Tab, gt and gT: the next or previous tab of `p`, wrapping around. */
const stepTabIn = (p: Pane, by: number) => void activateTab(p, stepIndex(p.group, by));

/** Move a tab of `p` a place left or right (⌘⇧PageUp, ⌘⇧PageDown), keeping the keyboard on it. */
function nudgeTabIn(p: Pane, i: number, by: -1 | 1) {
  if (!p.group.tabs[i]) return;
  p.group = nudgeTab(p.group, i, by);
  saveLayout();
  renderPaneBars();
}

function pinTabIn(p: Pane, i: number, on: boolean) {
  p.group = pinTab(p.group, i, on);
  saveLayout();
  renderPaneBars();
}

/**
 * Move a tab: within its strip (a reorder), or to the other pane, with its back and forward. A
 * pane left with no tabs closes, so the other is the window's only one; the main pane alone shows
 * Notes. Pages stay in the main pane.
 */
async function moveTabTo(src: Pane, i: number, dst: Pane, before?: number) {
  const t = src.group.tabs[i];
  if (!t?.note || (dst.index === 1 && pageOf(t.note) !== null)) return;
  if (src === dst) {
    src.group = moveTab(src.group, i, before ?? src.group.tabs.length);
    saveLayout();
    return renderPaneBars();
  }
  await flushSave();
  if (dst.index === 1 && !split) dst.group = emptyGroup();
  const shown = src.group.at === i;
  const r = takeTab(src.group, i, dst.group, before);
  src.group = r.from;
  dst.group = r.to;
  saveLayout();
  if (split && !currentTab(src.group)) {
    if (src.index === 0) [panes[0].group, panes[1].group] = [panes[1].group, emptyGroup()];
    keepPlace(panes[1]);
    setSplit(false);
    return showCurrent(panes[0]);
  }
  if (shown) await showCurrent(src);
  await showCurrent(dst);
}

/** A tab's right-click menu (and the context-menu key's, or Shift+F10). */
function tabMenu(p: Pane, i: number, at: { x: number; y: number }) {
  const t = p.group.tabs[i];
  if (!t?.note) return;
  const page = pageOf(t.note) !== null;
  const right = p.group.tabs.slice(i + 1).some((x) => !x.pinned);
  const others = p.group.tabs.some((x, j) => j !== i && !x.pinned);
  const n = page ? undefined : tabNote(t.note);
  const items: Array<MenuItem | "-" | null> = [
    { label: "Close", icon: "close", keys: "Mod-w", run: () => closeTabAt(p, i) },
    { label: "Close others", run: () => closeIn(p, closeOthers(p.group, i), i), disabled: !others },
    { label: "Close to the right", run: () => closeIn(p, closeToRight(p.group, i), i + 1), disabled: !right },
    "-",
    { label: t.pinned ? "Unpin" : "Pin", icon: "pin", run: () => pinTabIn(p, i, !t.pinned) },
    page || phone.matches ? null : { label: split ? (p.index === 0 ? "Move to the side pane" : "Move to the main pane") : "Open to the side", icon: "split", run: () => moveTabTo(p, i, other(p)) },
    n ? { label: "Copy link", icon: "link", run: () => void navigator.clipboard?.writeText(location.origin + notePath(n.title, n.id)).then(() => toast({ icon: "check", text: "Link copied" })) } : null,
    "-",
    closedTabs.length ? { label: "Reopen closed tab", icon: "history", keys: "Mod-Shift-t", run: reopenTab } : null,
    { label: "New tab…", icon: "plus", keys: "Mod-t", run: () => newTab(p) },
  ];
  openMenu(at, items, { label: "Tab" });
}

/** "Open in new tab", in a sidebar row's menu (a folder, a tag, a smart folder): `open` shows the page. */
const pageTabItem = (open: () => unknown): RowMenuItem => ({ label: "Open in new tab", icon: "plus", run: () => openPageInTab(open) });

/** The tab being dragged, while it is (dragover can't read what's dragged). */
let tabDrag: { pane: Pane; index: number; entry: string } | null = null;
const TAB_DRAG = "application/x-common-ink-tab";
window.addEventListener("dragend", () => (tabDrag = null));

/** What a tab strip does with a drop: its pane, the position (before which tab) at a point, and its drop mark. */
const strips = new WeakMap<HTMLElement, { pane: Pane; before(x: number): number; mark(at: number | null): void }>();
/** The tab strip at a point, if there's one. */
const stripAt = (x: number, y: number) => {
  const s = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tabs");
  return s && strips.has(s) ? { node: s, ...strips.get(s)! } : null;
};
const unmarkStrips = (but?: HTMLElement) => document.querySelectorAll<HTMLElement>(".tabs.is-drop").forEach((s) => s !== but && strips.get(s)?.mark(null));

/**
 * Something dropped on `p`'s tab strip, before position `at`: a tab moves there (from its own strip
 * or the other pane's); a note, a link or (the main pane's) a page opens in a new tab there.
 */
function dropOnStrip(p: Pane, at: number, dt: DataTransfer) {
  const drag = tabDrag;
  tabDrag = null;
  if (drag) return void moveTabTo(drag.pane, drag.index, p, at);
  const page = dt.types.includes(PAGE_DRAG) ? draggedPage() : null;
  if (page) return void (p.index === 0 && openPageInTab(page.open, at));
  const link = dt.getData(LINK_DRAG);
  if (link) {
    const { target, from } = JSON.parse(link) as { target: string; from: string };
    return void openTarget(target, from, p, true, at);
  }
  const n = notes.find((x) => x.path === dt.getData(NOTE_DRAG));
  if (!n || n.kind === "asset") return;
  const there = other(p);
  const j = tabIndex(there.group, n.id);
  if (split && j >= 0 && there.session?.id === n.id) return void moveTabTo(there, j, p, at); // showing over there: it moves here
  void openNote(n.path, { pane: p, newTab: true, index: at });
}

/** Let a tab strip take drops: tabs, notes, links and pages. */
function stripDrops(strip: HTMLElement, p: Pane) {
  const before = (x: number) => {
    const t = [...strip.querySelectorAll<HTMLElement>(".tab")].find((n) => {
      const r = n.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return t ? Number(t.dataset.index) : p.group.tabs.length;
  };
  const mark = (at: number | null) => {
    strip.classList.toggle("is-drop", at !== null);
    const tabs = [...strip.querySelectorAll<HTMLElement>(".tab")];
    for (const t of tabs) {
      t.classList.toggle("is-drop-before", Number(t.dataset.index) === at);
      t.classList.toggle("is-drop-after", at !== null && t === tabs.at(-1) && at >= p.group.tabs.length);
    }
  };
  strips.set(strip, { pane: p, before, mark });
  const accepts = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    if (tabDrag) return p.index === 0 || pageOf(tabDrag.entry) === null;
    if (types.includes(PAGE_DRAG)) return p.index === 0 && !!draggedPage();
    return types.includes(NOTE_DRAG) || types.includes(LINK_DRAG);
  };
  strip.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation(); // not the notes' drop zones too
    $("#side-drop").hidden = true;
    e.dataTransfer!.dropEffect = tabDrag ? "move" : "copy";
    unmarkStrips(strip);
    mark(before(e.clientX));
  });
  strip.addEventListener("dragleave", (e) => !strip.contains(e.relatedTarget as Node) && mark(null));
  strip.addEventListener("drop", (e) => {
    mark(null);
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    $("#side-drop").hidden = true;
    dropOnStrip(p, before(e.clientX), e.dataTransfer!);
  });
}

/**
 * A pane's tab strip: in the top bar, or split, in each pane's bar. Click a tab to show it,
 * middle-click or × to close it, right-click for more; drag one to reorder, onto the other pane (its
 * strip or its note) to move it, to an edge of the notes to split, or to a folder to move the note.
 * Arrow keys move along the strip, Enter shows, Delete closes, ⌘⇧PageUp and PageDown reorder.
 */
function tabStrip(p: Pane): HTMLElement {
  const g = p.group;
  const strip = el("div", { class: "tabs", role: "tablist", "aria-label": split ? (p.index === 0 ? "Tabs in the main pane" : "Tabs in the side pane") : "Tabs" });
  const live = g.tabs.flatMap((t, i) => (t.note && (pageOf(t.note) !== null || tabNote(t.note)) ? [i] : [])); // a note that's gone drops out on the next refresh
  const roving = live.includes(g.at) ? g.at : live[0];
  for (const i of live) {
    const t = g.tabs[i];
    const entry = t.note!;
    const page = pageOf(entry);
    const n = page === null ? tabNote(entry)! : undefined;
    const name = n ? displayName(n.path) : entryTitle(entry);
    const on = i === g.at;
    const node = el(
      "div",
      {
        class: `tab${on ? " is-on" : ""}${t.pinned ? " is-pinned" : ""}${page !== null ? " is-page" : ""}`,
        role: "tab",
        "aria-selected": String(on),
        tabindex: i === roving ? "0" : "-1",
        title: n ? n.path : name,
        draggable: "true",
        "data-index": String(i),
        "data-entry": entry,
      },
      icon(page !== null ? pageIcon(page) : n!.kind === "html" ? "html" : "file", 13),
      el("span", { class: "tab-name" }, name),
      t.pinned
        ? el("button", { type: "button", class: "tab-x tab-pin", tabindex: "-1", title: "Unpin", "aria-label": `Unpin ${name}`, onclick: (e: Event) => (e.stopPropagation(), pinTabIn(p, i, false)) }, icon("pin", 12))
        : el("button", { type: "button", class: "tab-x", tabindex: "-1", title: `Close (${formatKeys("Mod-w")})`, "aria-label": `Close ${name}`, onclick: (e: Event) => (e.stopPropagation(), void closeTabAt(p, i)) }, icon("close", 12)),
    );
    node.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault()); // not the page's autoscroll
    node.addEventListener("click", () => void activateTab(p, i));
    node.addEventListener("auxclick", (e) => e.button === 1 && (e.preventDefault(), void closeTabAt(p, i))); // a middle-click closes it, as in a browser
    node.addEventListener("contextmenu", (e) => (e.preventDefault(), tabMenu(p, i, { x: e.clientX, y: e.clientY })));
    node.addEventListener("keydown", (e) => {
      const all = [...strip.querySelectorAll<HTMLElement>(".tab")];
      const k = all.indexOf(node);
      const go = (j: number) => (e.preventDefault(), all[(j + all.length) % all.length]?.focus());
      if (e.key === "ArrowRight") go(k + 1);
      else if (e.key === "ArrowLeft") go(k - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(all.length - 1);
      else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), void activateTab(p, i));
      else if (e.key === "Delete" || e.key === "Backspace") (e.preventDefault(), void closeTabAt(p, i));
      else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) (e.preventDefault(), tabMenu(p, i, under(node)));
      else if (matchKeys(e, "Mod-Shift-PageUp") || matchKeys(e, "Mod-Shift-PageDown")) {
        e.preventDefault();
        e.stopPropagation();
        nudgeTabIn(p, i, e.key === "PageUp" ? -1 : 1);
      }
    });
    node.addEventListener("dragstart", (e) => {
      tabDrag = { pane: p, index: i, entry };
      e.dataTransfer!.setData(TAB_DRAG, entry);
      // A note's tab carries the note, so everything a note can be dropped on takes it: a folder
      // moves it, Favorites stars it, the edges of the notes split. A page's carries the page.
      if (n) e.dataTransfer!.setData(NOTE_DRAG, n.path);
      else startPageDrag(e, name, () => activateTab(p, i));
      e.dataTransfer!.effectAllowed = "copyMove";
      document.body.classList.add("is-tab-dragging");
    });
    node.addEventListener("dragend", () => {
      endPageDrag();
      document.body.classList.remove("is-tab-dragging", "is-dragging");
    });
    strip.append(node);
  }
  // The tab showing stays in sight in a strip that scrolls.
  requestAnimationFrame(() => strip.querySelector<HTMLElement>(".tab.is-on")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  strip.append(el("button", { type: "button", class: "icon-btn small tab-new", title: `New tab (${formatKeys("Mod-t")})`, "aria-label": "New tab", onclick: () => newTab(p) }, icon("plus", 13)));
  // A double-click on the strip's empty end opens a new tab, as in an editor.
  strip.addEventListener("dblclick", (e) => e.target === strip && newTab(p));
  stripDrops(strip, p);
  return strip;
}

/** Quick open, to open what you pick in a new tab of `p` (⌘T, the strip's +). */
function newTab(p: Pane = active) {
  if (p !== active) focusPane(p);
  paletteHow = "tab";
  did("search");
  palette.open();
}

function renderTabs() {
  // The top bar's strip is the main pane's (split, each pane's bar has its own). The keyboard
  // stays on the tab it was on, though the strip is drawn again.
  const at = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(".tab")?.dataset.entry;
  $("#top-tabs").replaceChildren(...(split ? [] : [tabStrip(panes[0])]));
  return at;
}
const refocusTab = (entry: string | undefined) => entry && document.querySelector<HTMLElement>(`.tab[data-entry="${CSS.escape(entry)}"]`)?.focus({ preventScroll: true });

/** The bars over the panes while split: back and forward, star, close. The top bar's arrows follow the focused pane. */
function renderPaneBars() {
  topArrows.update(navState(active));
  const tab = renderTabs();
  if (!split) return void refocusTab(tab);
  for (const p of panes) {
    const s = p.session;
    const btn = (ico: string, title: string, run: () => void, cls = "", disabled = false) =>
      el("button", { type: "button", class: `icon-btn small ${cls}`, title, "aria-label": title, disabled, onclick: (e: Event) => (e.stopPropagation(), run()) }, icon(ico, 14));
    const starred = s ? isStarred(s.id) : false;
    const arrows = (paneArrows[p.index] ??= navArrows((dir, steps) => stepPane(p, dir, steps), { small: true }));
    arrows.update(navState(p));
    const focused = arrows.el.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    p.bar.replaceChildren(
      arrows.el,
      tabStrip(p),
      el("span", { class: "spacer" }),
      ...(s && s.kind !== "asset" ? [btn(starred ? "starred" : "star", starred ? "Unstar" : "Star", () => void toggleStar(s.path), starred ? "is-on" : "")] : []),
      btn("close", `Close split view, keep the other note (${formatKeys("Mod-Alt-\\")})`, () => void closePane(p)),
    );
    focused?.focus({ preventScroll: true }); // moving the arrows back in drops their focus
    p.bar.classList.toggle("is-focused", p === active);
  }
  refocusTab(tab);
}

/**
 * Go back or forward in one pane (⌘[ ⌘], vim's Ctrl-O Ctrl-I, the browser's buttons), past notes
 * that are gone or open in the other pane. The main pane's trail has the pages you went to, too.
 * False if there was nowhere to go.
 */
async function stepPane(p: Pane, dir: "back" | "forward", steps = 1): Promise<boolean> {
  let from = p.trail;
  let left = steps; // the arrows' menus jump several steps at once
  for (let to = step(from, dir); to; to = step(from, dir)) {
    if (!stepsTo(p, to.note!)) {
      from = { ...forget(from, to.note!), note: from.note };
      continue;
    }
    if (--left > 0) {
      from = to;
      continue;
    }
    p.trail = to;
    saveLayout();
    const page = pageOf(to.note!);
    if (page !== null) {
      history.replaceState({ i: historyAt }, "", page);
      await route();
    } else await openNote(notes.find((n) => n.id === to!.note)!.path, { pane: p, trail: false });
    return true;
  }
  return false;
}

/** The app's place in the browser's history: each entry it pushes is numbered (see historyStep). */
let historyAt = typeof history.state?.i === "number" ? history.state.i : 0;
history.replaceState({ ...(history.state ?? {}), i: historyAt }, "");

/**
 * The browser's back and forward (its buttons, a mouse's side buttons, a swipe) step the focused
 * pane the same way the keys do. An entry the app didn't number shows what its address says.
 */
async function onPopState(e: PopStateEvent) {
  const move = historyStep(historyAt, e.state?.i);
  if (typeof e.state?.i === "number") historyAt = e.state.i;
  if (!move) return route();
  let moved = false;
  for (let n = 0; n < move.steps; n++) if (await stepPane(active, move.dir)) moved = true;
  if (!moved) await route();
}

/** Point the address bar at `url` (path + query) unless it's already there. */
function setUrl(url: string, how: "push" | "replace" = "push") {
  if (location.pathname + location.search === url) return;
  if (how === "push") history.pushState({ i: ++historyAt }, "", url);
  else history.replaceState({ i: historyAt }, "", url);
}

const loadReplace = page("/replace", async () =>
  (replacePage = new (await import("./replacePage.ts")).ReplacePage($("#replace-view"), {
    folders: () => allFolders(),
    open: (path, line, where) => void openNote(path, { line, pane: where === "side" ? sideOf(active) : active, newTab: where === "tab" }),
    refresh: () => refreshNotes(),
    readOnly: () => viewer,
    toast: (t) => toast(t),
  })),
);

let unmountTasks: (() => void) | null = null;
let unmountToday: (() => void) | null = null;

function showStage(which: "editor" | "html" | "notes" | "today" | "tasks" | "calendar" | "contacts" | "history" | "assets" | "tags" | "checkup" | "replace" | "query-help" | "shared" | "capture") {
  closeDrawer();
  $("#editor-host").hidden = which !== "editor";
  $("#html-preview").hidden = which !== "html";
  $("#assets-view").hidden = which !== "assets";
  $("#notes-view").hidden = which !== "notes";
  $("#today-view").hidden = which !== "today";
  $("#tasks-view").hidden = which !== "tasks";
  $("#calendar-view").hidden = which !== "calendar";
  $("#history-view").hidden = which !== "history";
  $("#tags-view").hidden = which !== "tags";
  $("#query-help-view").hidden = which !== "query-help";
  $("#checkup-view").hidden = which !== "checkup";
  $("#replace-view").hidden = which !== "replace";
  $("#contacts-view").hidden = which !== "contacts";
  $("#shared-view").hidden = which !== "shared";
  $("#capture-view").hidden = which !== "capture";
  if (which !== "tasks") {
    unmountTasks?.();
    unmountTasks = null;
  }
  if (which !== "today") {
    unmountToday?.();
    unmountToday = null;
  }
}

/**
 * A page showing in the main pane (Notes, Tasks…) is a place in its trail, so back from a note you
 * opened from it comes back to it, however you got there. `push`: you went to it, so the address
 * bar moves too; shown from the address bar (at start, a reload, back and forward), it's already there.
 */
function wentTo(url: string, push = true) {
  if (push) setUrl(url);
  placeTab(panes[0], pageEntry(url));
  renderPaneBars();
}

/** Put the open note away (saved, named, cursor remembered) before showing a page that isn't a note. Pages show in the main pane, which then has the focus. */
async function leaveNote() {
  const main = panes[0];
  main.opens++; // a note still loading into it doesn't come back over the page
  await flushSave(main);
  if (main.session) await retitle(main.session);
  keepPlace(main);
  main.session = null;
  active = main;
  renderPaneBars();
  hideBanner(main.banner);
  await setFocusMode(false);
  $("#backlink-count").textContent = "";
  $("#backlinks").replaceChildren(el("div", { class: "panel-empty" }, "—"));
}

/**
 * Notes is home: every note, newest first. Its tabs, Archive and Trash, are where notes go when
 * they're put away or deleted. No note is open while it's showing.
 */
async function showNotes(opts: { tab?: NotesTab; filter?: boolean; folder?: string; tag?: string; query?: NoteQuery; push?: boolean } = {}) {
  await leaveNote();
  showStage("notes");
  notesPage.show(opts);
  $("#notes-view .feed")?.prepend(awayStrip());
  const tab = notesPage.tab; // a viewer asking for Trash gets Notes
  const url = notesUrl();
  if (opts.push === false && location.pathname + location.search !== url) setUrl(url, "replace");
  wentTo(url, opts.push !== false);
  document.title = `${PAGE_LABEL[tab]} · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
}

/** Notes' address: /notes, with what it's narrowed to (a folder, a tag, a smart folder's query) as ?q=, or /archive or /trash. */
function notesUrl() {
  const q = notesPage.tab === "notes" ? formatQuery(notesPage.query) : "";
  return q ? `/notes?q=${encodeURIComponent(q)}` : `/${notesPage.tab}`;
}

/** Notes narrowed or widened in place (its filters, its search box): its tab and the address follow. */
function syncNotesTab() {
  if (onPage() !== "notes") return;
  const url = notesUrl();
  const page = pageOf(currentTab(panes[0].group)?.note ?? "");
  if (page === null || !page.startsWith("/notes") || page === url) return;
  panes[0].trail = { ...panes[0].trail, note: pageEntry(url) };
  setUrl(url, "replace");
  saveLayout();
  renderPaneBars();
}

/** Today: what's on today (events, and tasks overdue, due or starting today), today's journal note, and your week (its recap and writing days). */
async function showToday(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("today");
  unmountToday = renderTodayPage($("#today-view"), { open: openFromPage, openTag: (tag) => openTag(tag, "tasks"), openPerson: (assignee) => void showTasks({ assignee }) });
  $("#today-view .page")?.prepend(awayStrip());
  $("#today-view").focus({ preventScroll: true });
  wentTo("/today", opts.push !== false);
  document.title = "Today · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** Something a page lists, opened: today's events on the Calendar page (/calendar/<id>), and everything else as a note. */
const openFromPage = (path: string, line?: number, where?: Where) => (calendarTarget(path) !== null ? void openTarget(path) : fromPage(path, line, where));

async function showTasks(opts: { tag?: string; assignee?: string; push?: boolean } = {}) {
  await leaveNote();
  showStage("tasks");
  unmountTasks = renderTasksPage($("#tasks-view"), { open: openFromPage, tags: () => tags, me: workspaceId ? "Tasks with your @name" : "Tasks with @me" }, { tag: opts.tag, assignee: opts.assignee });
  $("#tasks-view").focus({ preventScroll: true });
  wentTo("/tasks", opts.push !== false);
  document.title = "Tasks · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** The Calendar, on today, or on one event with its details open (/calendar/<event id>). */
async function showCalendar(opts: { event?: string; push?: boolean } = {}) {
  await leaveNote();
  showStage("calendar");
  const page = await loadCalendar();
  wentTo(opts.event ? `/calendar/${opts.event}` : "/calendar", opts.push !== false);
  document.title = "Calendar · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
  await page.show({ event: opts.event });
}

/** The Calendar page with the Calendars dialog open at its link field. */
async function subscribeCalendar() {
  await showCalendar();
  calendarPage?.subscribe();
}

/**
 * Back from connecting Google Calendar (/calendar?google=connected|denied|failed): say how it went,
 * and show the Calendars dialog at its Google section, where the calendars are to add.
 */
async function backFromGoogle(outcome: string) {
  const url = new URL(location.href);
  url.searchParams.delete("google");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  const said = googleOutcome(outcome);
  if (!said) return;
  googleChanged();
  toast({ icon: "calendar", text: said, alert: outcome !== "connected" });
  await showCalendar({ push: false });
  calendarPage?.openSources({ google: true });
}

/** Read every calendar again now (each at most once a minute). */
async function refreshCalendars() {
  if (!(await calendars().catch(() => [])).length) {
    const text = "No calendars to refresh yet";
    return toast(viewer ? { icon: "calendar", text } : { icon: "calendar", text, actionLabel: "Subscribe", action: () => void subscribeCalendar() });
  }
  try {
    const list = await api.refreshCalendars();
    calendarChanged();
    await calendarPage?.refresh();
    const broken = list.filter((s) => s.status === "error");
    toast({ icon: "calendar", text: broken.length ? `Couldn't read ${broken.map((s) => s.name).join(", ")}` : "Calendars are up to date" });
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : "Couldn't refresh the calendars" });
  }
}

/** History, optionally for one note, with a change selected (e.g. from the activity list). */
async function showHistory(opts: { note?: string | null; select?: number; label?: string; since?: number; push?: boolean } = {}) {
  await leaveNote();
  showStage("history");
  await (await loadHistory()).show({ note: opts.note ?? null, select: opts.select, label: opts.label, since: opts.since });
  const id = opts.note ? notes.find((n) => n.path === opts.note)?.id : undefined;
  wentTo(id ? `/history?note=${id}` : "/history", opts.push !== false);
  document.title = `${opts.note ? `${displayName(opts.note)} · ` : ""}History · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
}

// ------------------------------------------------------------------ labels (labels.ts)

/** A label, in its note's History: compared with now, ready to restore. */
const showLabel = (m: Label) => void showHistory({ note: m.path, label: m.id });

/** Label the focused note's version as it is now: saved first, so the label is what's on screen. */
async function labelCurrent(name?: string) {
  const s = active.session;
  if (!s || s.kind === "asset" || viewer) return;
  await flushSave();
  if (!name) return void (await import("./labels.ts")).labelVersion(s.path, { toast, show: showLabel });
  const label = await api.label(s.path, name).catch((e: Error) => (toast({ text: e.message }), null));
  if (label) toast({ icon: "label", text: `Named this version “${label.name}”`, actionLabel: "Show", action: () => showLabel(label) });
}

/** Replace across notes: find and replace in every note, with a preview, as one Undo. */
async function showReplace(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("replace");
  (await loadReplace()).show();
  wentTo("/replace", opts.push !== false);
  document.title = "Replace across notes · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** From ⌘⇧P: the focused note's History, its latest label compared with now and ready to restore (or a word on how to make one). */
async function restoreVersion() {
  const s = active.session;
  if (!s || s.kind === "asset") return;
  await flushSave();
  const labels = await api.labels(s.path).catch(() => null);
  const latest = labels?.sort((a, b) => b.ts - a.ts)[0];
  if (latest) return showLabel(latest);
  await showHistory({ note: s.path });
  toast({ icon: "label", text: "No labeled versions yet", detail: "Pick a change in History to restore it, or Label this version to name one for later." });
}

/** Ask which tag (from ⌘⇧P, with no tag in view), under the search button. */
function pickTag(placeholder: string, onPick: (tag: string) => void) {
  tagPicker($("#search-btn"), { tags: tags.filter((t) => !unusedTag(t)), count: (t) => t.notes + t.tasks + t.assets, onPick, placeholder });
}

/** Tags, with `tag`'s row ready to rename (or merge). */
async function renameTagOnPage(tag: string) {
  await showTags();
  tagsPage?.renameTag(tag);
}

async function showTags(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("tags");
  (await loadTags()).show();
  refreshTagsSoon();
  wentTo("/tags", opts.push !== false);
  document.title = "Tags · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** Query syntax: every operator and field a note query takes (see queryGrammar.ts). */
async function showQueryHelp(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("query-help");
  (await loadQueryHelp()).show();
  wentTo("/query-help", opts.push !== false);
  document.title = "Query syntax · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** Check-up: what may need tending in the workspace, each with its fix (checkupPage.ts). */
async function showCheckup(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("checkup");
  await (await loadCheckup()).show();
  $("#checkup-view").focus({ preventScroll: true });
  wentTo("/checkup", opts.push !== false);
  document.title = "Check-up · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
}

/** Contacts: the people in the notes, or one person's page (`contact`: its note ID). */
async function showContacts(opts: { contact?: string | null; push?: boolean } = {}) {
  await leaveNote();
  showStage("contacts");
  const page = await loadContacts();
  await page.show(opts.contact ?? null);
  const name = opts.contact ? notes.find((n) => n.id === opts.contact)?.title : undefined;
  wentTo(name ? `/contacts?c=${opts.contact}` : "/contacts", opts.push !== false);
  document.title = `${name ? `${name} · ` : ""}Contacts · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
}

/** Show what carries a tag (and the tags under it): its notes, or its tasks. */
function openTag(tag: string, where: "notes" | "tasks" = "notes") {
  return where === "tasks" ? showTasks({ tag }) : showNotes({ tab: "notes", query: { tag } });
}

// ------------------------------------------------------------------ sharing (online)

/** What this workspace shares outside itself: notes by ID, and folders, for the "shared" marks. */
let shareIndex: { notes: Set<string>; folders: string[] } = { notes: new Set(), folders: [] };
const isShared = (id: string, path: string) => shareIndex.notes.has(id) || shareIndex.folders.some((f) => path.startsWith(`${f}/`));
async function refreshShares() {
  if (!workspaceId) return;
  const all = await api.shares().catch(() => null);
  if (!all) return;
  shareIndex = { notes: new Set(all.shares.flatMap((s) => (s.note ? [s.note] : []))), folders: all.shares.flatMap((s) => (s.folder ? [s.folder] : [])) };
  renderChrome();
  notesPage.refreshSoon();
}

/** The share dialog for a note or folder: who it's shared with outside the workspace, and by link. */
function openShareDialog(target: { path: string } | { folder: string }) {
  void showShareDialog(target, {
    canShare: !viewer,
    toast: (t) => toast(t),
    changed: () => void refreshShares(),
    workspaceSettings: () => void account.find((a) => /^(Workspace settings|Members)…$/.test(a.label))?.run(),
  });
}

/** Shared with me: notes other workspaces share with you, each opening on its own page. */
async function showShared(opts: { push?: boolean } = {}) {
  await leaveNote();
  showStage("shared");
  const { page, body } = sharedPage();
  $("#shared-view").replaceChildren(page);
  wentTo("/shared", opts.push !== false);
  document.title = "Shared with me · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
  const load = async () => {
    const groups = await api.sharedWithMe().catch(() => null);
    if (groups) $("#shared-count").textContent = String(groups.reduce((n, g) => n + g.notes.length, 0) || "");
    if (page.isConnected) renderSharedList(body, groups, () => void load());
  };
  await load();
}

/**
 * Quick capture: what another app shared (the phone's share sheet, through the service worker), or
 * /capture?title=…&text=…&url=…, to check over and save into a note. It isn't a place in the back
 * and forward trail: saving opens the note in its place.
 */
async function showCapture() {
  await leaveNote();
  showStage("capture");
  capturePage ??= new CapturePage($("#capture-view"), {
    readOnly: () => viewer,
    notes: () => notes,
    upload: (files) => uploadFiles(files),
    saved: (path, line) => {
      toast({ icon: "check", text: `Captured in ${displayName(path).replace(/\.md$/i, "")}` });
      void refreshNotes().then(() => openNote(path, { line, push: false }));
    },
    discarded: () => {
      setUrl("/notes", "replace");
      void showNotes({ push: false });
    },
  });
  const q = new URLSearchParams(location.search);
  document.title = "Capture · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
  await capturePage.show({ share: q.get("share"), fields: { title: q.get("title") ?? "", text: q.get("text") ?? "", url: q.get("url") ?? "" } });
}

async function showAssets(opts: { open?: string; push?: boolean } = {}) {
  await leaveNote();
  showStage("assets");
  (await loadAssets()).show({ open: opts.open });
  wentTo("/assets", opts.push !== false);
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

function pickFiles(accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", multiple: true, ...(accept ? { accept } : {}) });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

const PAGE_LABEL = { today: "Today", notes: "Notes", archive: "Archive", trash: "Trash", tasks: "Tasks", calendar: "Calendar", contacts: "Contacts", history: "History", assets: "Assets", tags: "Tags", checkup: "Check-up", replace: "Replace across notes", shared: "Shared with me", capture: "Capture", "query-help": "Query syntax" } as const;

/** The page showing (the Notes page by its tab), or null while a note is. */
const onPage = () =>
  notesPage.visible ? notesPage.tab
  : !$("#today-view").hidden ? "today"
  : !$("#tasks-view").hidden ? "tasks"
  : calendarPage?.visible ? "calendar"
  : contactsPage?.visible ? "contacts"
  : historyPage?.visible ? "history"
  : assetsPage?.visible ? "assets"
  : tagsPage?.visible ? "tags"
  : queryHelpPage?.visible ? "query-help"
  : checkupPage?.visible ? "checkup"
  : replacePage?.visible ? "replace"
  : !$("#shared-view").hidden ? "shared"
  : !$("#capture-view").hidden ? "capture"
  : null;

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
async function archiveCurrent(pane = active) {
  const s = pane.session;
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
  await openNote(to, { push: false, pane });
  toast({
    icon: restore ? "unarchive" : "archive",
    text: `${restore ? "Unarchived" : "Archived"} ${displayName(to)}`,
    actionLabel: "Undo",
    action: async () => {
      const back = (await (restore ? api.archive([to]) : api.unarchive([to]))).moved[0].to;
      await refreshNotes();
      if (pane.session?.path === to) {
        await openNote(back, { push: false, pane });
      }
    },
  });
}

/** Delete the open note (to Trash, with Undo) and go back to Notes. */
// ------------------------------------------------------------------ share, print and export (share.ts, export/)

/** The focused pane's note, for the Share menu: its link, and its content as it is now. */
function shareNote(): ShareNote | null {
  const s = active.session;
  if (!s || s.kind === "asset") return null;
  const view = active.view;
  return { path: s.path, title: s.title, kind: s.kind, url: `${location.origin}${notePath(s.title, s.id)}`, content: () => view.state.doc.toString() };
}

/** Save to Google Drive… (online): the dialog that picks a Google Doc, a PDF or the markdown file (export/drive.ts). */
async function saveNoteToDrive(note: ShareNote | null = shareNote(), as?: "doc" | "pdf" | "md") {
  if (!note || note.kind !== "md") return;
  await (await import("./export/drive.ts")).openSaveToDrive({ path: note.path, title: note.title, content: note.content() }, as);
}

/** Back from letting Common Ink save to Google Drive (?drive=connected|denied|failed): the dialog again, at the format picked, or why not. */
async function backFromDrive(outcome: string, as: string | null) {
  const url = new URL(location.href);
  url.searchParams.delete("drive");
  url.searchParams.delete("as");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  const said = (await import("./export/drive.ts")).driveOutcome(outcome, as);
  if (!said) return;
  if ("text" in said) return toast({ icon: "drive", text: said.text, alert: true });
  if (shareNote()?.kind === "md") await saveNoteToDrive(shareNote(), said.again);
  else toast({ icon: "drive", text: "Google Drive is connected: save a note from its Share menu" });
}

/** The Share menu, under the Share button (or under More, where a phone keeps the button). */
function openShare() {
  const note = shareNote();
  if (!note) return;
  const button = $("#share-btn");
  const anchor = button.offsetParent ? button : (document.querySelector<HTMLElement>("#more-btn") ?? button);
  toggleShareMenu(anchor, note, (text) => toast({ text }));
}

async function copyLink() {
  const note = shareNote();
  if (!note) return;
  await navigator.clipboard.writeText(note.url);
  toast({ icon: "link", text: "Link copied" });
}

/** Notes as a .zip: a folder, some notes, or everything. */
async function exportZip(what: { paths?: string[]; folder?: string; all?: boolean }) {
  toast({ icon: "download", text: "Making the .zip…" });
  try {
    const name = await (await import("./export/files.ts")).exportZip(what);
    toast({ icon: "check", text: `Exported ${name}` });
  } catch (e) {
    toast({ text: `Couldn't export: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Pick .md files or a .zip and bring them all in (see importNotes.ts): which app they're from is told from what's in them. */
async function importNotes() {
  const picked = await pickFiles(".md,.markdown,.html,.htm,.txt,.zip,.enex,application/zip,text/markdown");
  if (!picked.length) return;
  toast({ icon: "upload", text: "Importing…" });
  try {
    const r = await (await import("./importNotes.ts")).importNotes(picked, new Set(notes.map((n) => n.path.toLowerCase())));
    await refreshNotes();
    toast({ icon: "check", text: r });
  } catch (e) {
    await refreshNotes();
    toast({ text: `Couldn't import: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Print the note, or export it: the same as the Share menu's items. */
async function exportNote(how: "print" | "pdf" | "md" | "html" | "docx") {
  const note = shareNote();
  if (!note || note.kind !== "md") return;
  const printable = { path: note.path, title: note.title, content: note.content() };
  try {
    if (how === "print" || how === "pdf") await (await import("./export/print.ts")).print(printable, { pdf: how === "pdf" });
    else if (how === "md") toast({ icon: "check", text: `Exported ${await (await import("./export/files.ts")).exportMarkdown(printable)}` });
    else if (how === "docx") await (await import("./export/files.ts")).exportDocx(printable);
    else await (await import("./export/files.ts")).exportHtml(printable);
  } catch (e) {
    toast({ text: `Couldn't export: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function deleteCurrent() {
  const s = active.session;
  if (!s || viewer) return;
  await flushSave();
  const went = await deletePaths([s.path], deleteHooks);
  if (went.length) await showNotes();
}

/** Open a note from the focused pane (a starred note, a backlink): here, in a new tab, or to the side. */
const openAt = (path: string, where: Where, o: { line?: number } = {}) => openNote(path, { line: o.line, pane: where === "side" ? sideOf(active) : active, newTab: where === "tab" });

async function openTarget(target: string, from?: string, pane = active, newTab = false, index?: number) {
  const event = calendarTarget(target);
  if (event !== null) return showCalendar({ event: event || undefined });
  const [name, anchor] = target.split("#");
  const path = name ? await api.resolve(name, from) : from;
  const line = anchor?.match(/^L(\d+)$/)?.[1]; // Note#L12 → line 12 (used by widgets)
  if (path) openNote(path, { pane, newTab, index, ...(line ? { line: Number(line) } : { heading: anchor }) });
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

/**
 * A new note from a template: pick one (unless given), answer its questions, and open the note with
 * the cursor at its {{cursor}}. It goes in the template's folder, else `folder`.
 */
async function newFromTemplate(template?: TemplateInfo, folder = "") {
  let t = template;
  if (!t) {
    const list = await api.templates().catch(() => []);
    t = (await pickTemplate(list, "New note from template")) ?? undefined;
  }
  if (!t) return;
  const asked = await askFor(t, { title: true, people: await templatePeople(t) });
  if (!asked) return;
  const clipboard = t.clipboard ? await navigator.clipboard?.readText().catch(() => undefined) : undefined;
  try {
    const r = await api.fromTemplate(t.path, { at: localNow(), title: asked.title, answers: asked.answers, picks: asked.picks, clipboard, folder: t.folder ? undefined : folder || undefined });
    await refreshNotes();
    await openNote(r.path);
    const at = Math.min(r.cursor ?? active.view.state.doc.length, active.view.state.doc.length);
    active.view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    active.view.focus();
    const cm = getCM(active.view);
    if (cm && prefs.vim) Vim.handleKey(cm, "i", "user");
    if (r.unfilled.length) toast({ icon: "file", text: `Still to fill in: ${r.unfilled.map((u) => `{{${u}}}`).join(", ")}` });
  } catch (e) {
    toast({ text: e instanceof ApiError ? e.message : `Couldn't make a note from ${t.name}` });
  }
}

/**
 * New note button: in a folder with a default template (its applies_to), that template; else
 * "Untitled" (in `folder`, if given, with `body` under the title), cursor in its title.
 */
async function newNote(folder = "", body = "") {
  if (folder && !body) {
    const def = (await api.templates().catch(() => [])).find((t) => t.appliesTo.some((a) => folder === a || folder.startsWith(`${a}/`)));
    if (def) return newFromTemplate(def, folder);
  }
  const dir = folder ? `${folder}/` : "";
  const taken = new Set(notes.map((n) => n.path.toLowerCase()));
  let name = "Untitled";
  for (let i = 2; taken.has(`${dir}${name}.md`.toLowerCase()); i++) name = `Untitled ${i}`;
  try {
    const r = await api.create(`${dir}${name}.md`, `# \n${body}`);
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

/** The note being moved by this window, whose own move coming back from the server isn't news. */
let renaming: string | null = null;
/** A rename after a heading on its way; flushSave waits for it, so nothing acts on the old path meanwhile. */
let retitling: Promise<void> | null = null;
let retitleTimer = 0;

/**
 * Rename the note `s` shows to `to` in place, without reloading the editor. Links to it are
 * rewritten (api.move), and a toast says so when that changed other notes. Throws if it can't.
 */
async function renameSession(s: Session, to: string, title?: string) {
  renaming = s.path;
  let r;
  try {
    r = await api.move(s.path, to);
    s.pane.view.state.facet(editorContext).path = r.path; // the open editor now belongs to the new path
    s.path = r.path;
  } finally {
    renaming = null;
  }
  await refreshNotes();
  s.title = title ?? notes.find((n) => n.id === s.id)?.title ?? displayName(r.path);
  if (s === active.session) {
    setUrl(notePath(s.title, s.id), "replace");
    document.title = `${s.title} · Common Ink`;
    renderChrome();
  }
  const others = r.updated.filter((p) => p !== r.path).length;
  if (others) toast({ icon: "link", text: `Renamed to ${displayName(r.path)}`, detail: `Updated links in ${others} note${others > 1 ? "s" : ""}` });
}

/**
 * Once you've changed the heading that names a note (see noteName.ts), rename the file to match. It
 * runs when you pause off the heading line, leave the editor or open something else; not while an
 * IME is composing, and never for a viewer. A note with no heading keeps its name.
 */
function retitle(s: Session): Promise<void> {
  if (!s.retitle || viewer || renaming || s !== s.pane.session || s.pane.view.composing) return Promise.resolve();
  s.retitle = false;
  const name = nameFromHeading(s.path, s.pane.view.state.doc);
  const to = name && renamedPath(s.path, name, notes.map((n) => n.path));
  if (!to) return Promise.resolve();
  // A failed rename leaves the name as it was; changing the heading again tries again.
  return (retitling = renameSession(s, to, s.heading!)
    .catch(() => {})
    .finally(() => (retitling = null)));
}

/** A pause off the heading's line renames the note after it. Typing on that line waits: each rename rewrites links. */
function retitleSoon(s: Session, state: EditorState) {
  clearTimeout(retitleTimer);
  if (state.doc.lineAt(state.selection.main.head).number !== nameLine(state.doc).line) retitleTimer = window.setTimeout(() => void retitle(s), 1500);
}

/**
 * ⌘K "Rename note…": a note named by its heading gets the heading's words selected (a heading with
 * its name is added first if it has none), and is renamed after it as you'd changed it. Any other
 * note (HTML, a frontmatter title, a daily note…) asks for the name.
 */
async function renameNote() {
  const s = active.session;
  if (!s || viewer) return;
  const view = s.pane.view;
  const h = s.kind === "md" && !fixedName(s.path) ? nameLine(view.state.doc) : null;
  if (h && !h.titled) {
    s.retitle = true; // the name follows the heading from here, even if it's left as it is
    if (h.text === null) {
      const name = displayName(s.path);
      const lead = h.line > view.state.doc.lines ? "\n" : "";
      view.dispatch({ changes: { from: h.at, insert: `${lead}# ${name}\n` } });
      const from = h.at + lead.length + 2;
      view.dispatch({ selection: { anchor: from, head: from + name.length }, scrollIntoView: true });
    } else view.dispatch({ selection: { anchor: h.from, head: h.to }, scrollIntoView: true });
    return view.focus();
  }
  const file = s.path.split("/").pop()!;
  const ext = file.match(/\.[^.]+$/)?.[0] ?? "";
  const typed = await askName("Rename note", file.slice(0, file.length - ext.length));
  const name = typed && cleanName(typed);
  if (!name) return;
  await flushSave();
  try {
    await renameSession(s, `${s.path.slice(0, s.path.lastIndexOf("/") + 1)}${name}${ext}`);
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : `Couldn't rename ${displayName(s.path)}` });
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
  pane.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 80 }), userEvent: "select.jump" });
}

// ------------------------------------------------------------------ saving & merging agent edits

function onUpdate(s: Session, docChanged: boolean, fromRemote: boolean, state: EditorState) {
  if (s !== s.pane.session) return;
  if (docChanged && !fromRemote) {
    s.edited = true;
    scheduleSave(s);
  }
  if (docChanged && s.kind === "md") {
    const heading = nameLine(state.doc).text;
    if (heading !== s.heading) {
      s.heading = heading;
      s.retitle = !fromRemote;
    }
  }
  if (s.retitle) retitleSoon(s, state);
  if (docChanged && s.kind === "md") renderCodeWrapSoon(); // either pane: a code block may have come or gone
  if (s.pane !== active) return;
  renderStatusSoon(state);
  if (docChanged) renderOutlineSoon();
}

/** The save status in the status bar is the focused pane's. */
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
    const r = await api.save(s.path, content, s.baseVersion, content.trim() === "", clientId, s.id);
    if (r.path !== s.path) {
      // It was renamed while this save was on its way, and the save followed it.
      view.state.facet(editorContext).path = r.path;
      s.path = r.path;
      view.dispatch({ effects: refreshFolder.of(null) }); // it may be in another folder now
    }
    s.base = content;
    s.baseVersion = r.version;
    s.failed = false;
    if (s === s.pane.session) status(s, view.state.doc.toString() === content ? "saved" : "editing");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      applyRemote({ path: s.path, content: e.data.content, version: e.data.version, source: e.data.source ?? "external" });
    } else {
      // Offline or a server error: keep trying, so the text is saved once it can be. A refusal
      // (an empty note, one too big) waits for the next edit instead.
      if (!(e instanceof ApiError) || e.status >= 500) {
        s.failed = true;
        clearTimeout(s.timer);
        s.timer = window.setTimeout(() => save(s), 5000);
      }
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
  await retitling;
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
    banner: s.pane.banner,
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
        const said = { by: c, text: `${changeVerb(c)} ${displayName(m.path)}`, detail: c.summary ?? undefined, open: open ? undefined : () => void openNote(m.path) };
        toast(undo ? { ...said, actionLabel: "Undo", action: () => void undoChange(c, m.content) } : said);
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
      // The workspace's own events are notes in Events/: one changed anywhere (an agent, the editor) is a calendar change.
      if ([m.change.path, m.change.from_path].some((p) => p?.startsWith("Events/"))) eventNotesChanged();
      notesPage.refreshSoon();
      historyPage?.refreshSoon();
      replacePage?.refresh();
      renderActivity();
      renderPresence();
      renderTree();
      return;
    }
    case "removed": {
      const path = m.path;
      setTimeout(() => {
        if (notes.some((n) => n.path === path)) return;
        for (const p of panes) if (p.session?.path === path) showBanner(`${displayName(path)} was moved or deleted on disk.`, [], { in: p.banner });
      }, 400);
      refreshNotesSoon();
      return;
    }
    case "calendar":
      calendarChanged();
      void calendarPage?.refresh();
      void learnCalendars();
      return;
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
  // Tabs of notes that are gone close (not the one showing: what shows there is the pane's to change),
  // and the rest show their notes' names now.
  for (const p of panes) p.group = pruneGroup(p.group, true);
  renderPaneBars();
  assetsPage?.refresh();
  tagsPage?.refresh();
  for (const p of panes) if (p.session?.kind === "md") p.view.dispatch({ effects: notesChanged.of(null) });
}
const refreshNotesSoon = debounce(refreshNotes, 120);
const eventNotesChanged = debounce(() => {
  calendarChanged();
  void calendarPage?.refresh();
  void learnCalendars();
}, 300);
/** Whether there's a calendar, so Calendar shows in the sidebar. A failed read leaves it as it was. */
async function learnCalendars() {
  const list = await calendars().catch(() => null);
  if (!list || (list.length > 0) === hasCalendars) return;
  hasCalendars = list.length > 0;
  renderTree();
}
const refreshTagsSoon = debounce(async () => {
  tags = await api.tags().catch(() => tags);
  tagsPage?.refresh();
  renderTree();
}, 400);

// ------------------------------------------------------------------ favorites

const isStarred = (id: string) => favorites.some((f) => isNoteFavorite(f) && f.id === id);
const isTagStarred = (tag: string) => favorites.some((f) => isTagFavorite(f) && f.tag === normalizeTag(tag));
const isSmartStarred = (id: string) => favorites.some((f) => isSmartFavorite(f) && f.id === id);

/** Star a note, or unstar it if it's starred. */
async function toggleStar(path: string) {
  const on = favorites.some((f) => isNoteFavorite(f) && f.path === path);
  try {
    favorites = await (on ? api.unstar(path) : api.star(path));
  } catch {
    return toast({ text: `Couldn't ${on ? "unstar" : "star"} ${displayName(path)}` });
  }
  renderTree();
  renderChrome();
  notesPage.refreshSoon();
}

// ------------------------------------------------------------------ views (smart folders)
// A view is a note in Views/ holding one query line (see core/views.ts): saving one here writes its
// note, renaming one renames it, and deleting one sends it to Trash. The sidebar lists them as
// Views; the code and API still call them smart folders.

/** What the settings forms' tag and folder fields suggest. */
const fieldSources = { tags: () => tags, folders: () => allFolders() };

/**
 * Offer to keep a note query as a view (from the Notes filters or a ::query widget).
 * `search`: Notes' Advanced search, the same editor applying its query to Notes as it changes.
 */
function saveSmartFolder(query: string, name: string, anchor: HTMLElement, favorite = false, search = false) {
  // New ones are yours only until you share them (a local vault has no one else, so it keeps them as it always did).
  smartFolderEditor(anchor, { name: name || suggestName(query), query, shared: local }, {
    canShare: !viewer,
    alone: local,
    sources: fieldSources,
    search: search ? { apply: (q) => notesPage.setQuery(parseQuery(q)) } : undefined,
    save: async (f) => {
      const saved = await api.saveSmartFolder(f);
      smartFolders = await api.smartFolders();
      if (favorite) await starSmartFolder(saved.id, true);
      renderTree();
      notesPage.refreshSoon();
      const who = local ? "" : saved.shared ? " Everyone in the workspace sees it in their sidebar." : " Only you see it in your sidebar.";
      toast({ icon: "folderSearch", text: `Saved ${saved.name}`, detail: `A note in ${saved.path.replace(/\/[^/]*$/, "/")}.${who}` });
    },
  });
}

/** Advanced search from ⌘K or ⌘⌥F: Notes (its Notes tab, from Trash or another page), then the editor on its filters. */
async function advancedSearch() {
  if (document.querySelector(".sf-modal")) return;
  if (onPage() !== "notes" || notesPage.tab === "trash") await showNotes({ tab: notesPage.tab === "archive" && onPage() === "notes" ? "archive" : "notes" });
  notesPage.openAdvanced();
}

/** A new view from ⌘K: the Views section shows (it waits for a first one otherwise), and the form opens under its +. */
function newSmartFolderFromPalette() {
  revealed.add("smart");
  renderTree();
  newSmartFolder($("#new-smart-folder"));
}

/** A new view from scratch (the Views header, or its empty row). Saving opens it. */
function newSmartFolder(anchor: HTMLElement) {
  smartFolderEditor(anchor, { name: "", query: "", shared: local }, {
    canShare: !viewer,
    alone: local,
    sources: fieldSources,
    save: async (f) => {
      const saved = await api.saveSmartFolder(f);
      smartFolders = await api.smartFolders();
      await showNotes({ tab: "notes", query: parseQuery(saved.query) });
    },
  });
}

/** Star a smart folder (`on`) or unstar it; nothing if it's already that way. */
async function starSmartFolder(id: string, on: boolean) {
  if (isSmartStarred(id) === on) return;
  favorites = await (on ? api.starSmartFolder(id) : api.unstarSmartFolder(id));
}

/** Star a smart folder, or unstar it. */
async function toggleSmartStar(f: SmartFolder) {
  try {
    await starSmartFolder(f.id, !isSmartStarred(f.id));
  } catch (e) {
    return toast({ text: e instanceof Error ? e.message : `Couldn't star ${f.name}` });
  }
  renderTree();
  notesPage.refreshSoon();
}

/** A smart folder's star, on its row in Smart folders or in Starred. */
function smartStarButton(f: SmartFolder): HTMLElement {
  const starred = isSmartStarred(f.id);
  const label = starred ? "Unstar view" : "Star view";
  return el(
    "button",
    { type: "button", class: `row-act star-btn${starred ? " is-starred" : ""}`, title: label, "aria-label": `${label}: ${f.name}`, "aria-pressed": String(starred), onclick: (e: Event) => (e.stopPropagation(), void toggleSmartStar(f)) },
    icon(starred ? "starred" : "star", 14),
  );
}

/**
 * The star beside the Notes filters, for whatever they show. A smart folder's exact query stars
 * that folder; a tag alone stars the tag; anything else is saved as a smart folder first (the
 * editor opens, and saving it stars it), since a favorite needs a name.
 */
function queryStarButton(q: NoteQuery): HTMLElement | "" {
  const text = formatQuery(q);
  if (!text) return "";
  const saved = smartFolders.find((f) => f.query === text);
  if (saved) {
    const b = smartStarButton(saved);
    b.className = b.className.replace("row-act", "fc-action tag-star");
    return b;
  }
  if (q.tag && tagList(q.tag).length === 1 && text === formatQuery({ tag: q.tag })) return tagStarButton(q.tag, "chip");
  const b: HTMLButtonElement = el(
    "button",
    {
      type: "button",
      class: "fc-action tag-star star-btn",
      title: "Star this search (saves it as a view)",
      "aria-label": "Star this search",
      "aria-pressed": "false",
      onclick: (e: Event) => (e.stopPropagation(), saveSmartFolder(text, "", b, true)),
    },
    icon("star", 15),
  );
  return b;
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
  const label = starred ? "Unstar tag" : "Star tag";
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
  role: "link",
  onclick: (e: MouseEvent) => go(e),
  onkeydown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && go(),
});

/** Saved note queries, each with a live count. Click one to see its notes; the sliders edit it. */
function renderSmartFolders(active: string | null) {
  const rows = smartFolders.map((f) => {
    const edit = el("button", { type: "button", class: "row-act", title: "Edit or delete" }, icon("sliders", 14));
    const editable = !(f.shared && viewer);
    const remove = async () => {
      const everyone = f.shared && !local ? " for everyone in the workspace" : "";
      if (!(await confirmAction({ title: `Delete the view ${f.name}${everyone}?`, body: `Its note (${f.path}) goes to Trash. The notes it finds don't change.`, action: "Delete", danger: true }))) return;
      smartFolders = await api.deleteSmartFolder(f.id);
      renderTree();
      toast({ icon: "folderSearch", text: `Deleted ${f.name}` });
    };
    const openEditor = (anchor: HTMLElement) =>
      smartFolderEditor(anchor, f, {
        canShare: !viewer,
        alone: local,
        sources: fieldSources,
        save: async (next) => {
          await api.saveSmartFolder(next);
          smartFolders = await api.smartFolders();
          renderTree();
        },
        remove,
      });
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(edit);
    });
    const show = () => void showNotes({ tab: "notes", query: parseQuery(f.query) });
    const row = el(
      "div",
      {
        class: `tree-row is-file${f.query === active ? " is-active" : ""}`,
        "aria-current": f.query === active && "page",
        style: { "--depth": "0" },
        "data-smart": f.id,
        title: `${f.query || "Every note"}${f.shared ? "" : " (just you)"} · ${f.path}`,
        ...opens(show),
      },
      el("span", { class: "chev is-leaf" }), // the chevron column Folders and Tags rows have, so icons and names line up
      icon("folderSearch", 14),
      el("span", { class: "tree-name" }, f.name),
      f.shared ? null : el("span", { class: "sf-mine", title: "Just you" }, icon("user", 11)),
      el("span", { class: "n" }, String(f.count)),
      el("span", { class: "row-actions" }, smartStarButton(f), editable ? edit : null),
    );
    dragsPage(row, f.name, () => showNotes({ tab: "notes", query: parseQuery(f.query) }));
    rowMenu(row, f.name, () => [
      { label: "Show notes", icon: "folderSearch", run: show },
      pageTabItem(show),
      { label: isSmartStarred(f.id) ? "Remove from Favorites" : "Add to Favorites", icon: isSmartStarred(f.id) ? "starred" : "star", run: () => void toggleSmartStar(f) },
      editable ? { label: "Edit…", icon: "sliders", run: () => openEditor(edit.isConnected ? edit : row) } : null,
      editable ? { label: "Delete…", icon: "trash", danger: true, run: remove } : null,
    ]);
    return row;
  });
  // Empty: one quiet line pointing at the header's +, the one way to add one from here.
  $("#smart-folders").replaceChildren(...(rows.length ? rows : [sectionHint("Click ", plusMark(), " to save a search here.")]));
}

const FAVORITE = "application/x-common-ink-favorite";

/** A starred tag in Favorites: it opens Notes narrowed to the tag, like the tag's row under Tags. */
function tagFavoriteRow(f: TagFavorite, active: boolean): HTMLElement {
  const row = el(
    "div",
    {
      class: `tree-row is-tag${active ? " is-active" : ""}`,
      "aria-current": active && "page",
      style: { "--depth": "0" },
      title: `Notes tagged #${f.display}`,
      "data-tag": f.tag,
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
  dragsPage(row, `#${f.display}`, () => showNotes({ tab: "notes", query: { tag: f.display } }));
  rowMenu(row, `#${f.display}`, () => tagMenu(f.display, true));
  return row;
}

/** A tag's menu, on its row under Tags or in Favorites. `used`: some note carries it (else it can be deleted). */
function tagMenu(tag: string, used: boolean, t = tags.find((x) => x.display === tag)): (RowMenuItem | null)[] {
  const starred = isTagStarred(tag);
  const notesToo = !t || !!t.notes || !!t.assets || !t.tasks; // a tag only tasks carry can't be a favorite (it would show no notes)
  return [
    { label: "Show notes", icon: "file", run: () => openTag(tag) },
    pageTabItem(() => openTag(tag)),
    { label: "Show tasks", icon: "task", run: () => openTag(tag, "tasks") },
    used && (notesToo || starred) ? { label: starred ? "Remove from Favorites" : "Add to Favorites", icon: starred ? "starred" : "star", run: () => toggleTagStar(tag) } : null,
    t && !viewer ? { label: "Rename…", icon: "edit", run: () => renameTag(t) } : null,
    !used && t && !viewer ? { label: "Delete…", icon: "trash", danger: true, run: () => deleteTag(t) } : null,
  ];
}

/** A starred smart folder in Favorites: it opens Notes with its query, like its row under Views. */
function smartFavoriteRow(f: SmartFavorite, active: boolean): HTMLElement {
  const show = () => void showNotes({ tab: "notes", query: parseQuery(f.query) });
  const row = el(
    "div",
    {
      class: `tree-row is-file${active ? " is-active" : ""}`,
      "aria-current": active && "page",
      style: { "--depth": "0" },
      title: f.query || "Every note",
      draggable: "true",
      ...opens(show),
      ondragstart: (e: DragEvent) => {
        e.dataTransfer!.setData(FAVORITE, favoriteKey(f));
        document.body.classList.add("is-dragging");
        e.dataTransfer!.effectAllowed = "move";
      },
    },
    el("span", { class: "chev is-leaf" }),
    icon("folderSearch", 14),
    el("span", { class: "tree-name" }, f.name),
    el("span", { class: "n" }, String(f.count)),
    el("span", { class: "row-actions" }, smartStarButton(f)),
  );
  rowMenu(row, f.name, () => [
    { label: "Show notes", icon: "folderSearch", run: show },
    pageTabItem(show),
    { label: "Remove from Favorites", icon: "starred", run: () => void toggleSmartStar(f) },
  ]);
  return row;
}

/** Starred notes, tags and smart folders, in your order: drag one to reorder, or drag a card in from Notes to star it. */
function renderFavorites() {
  // The tag Notes shows on its own (like a folder alone), which its favorite marks as open.
  const q = onPage() === "notes" ? notesPage.query : null;
  const shownTag = q?.tag && formatQuery(q) === formatQuery({ tag: q.tag }) ? (normalizeTag(q.tag) ?? "") : "";
  const rows = favorites.map((f) => {
    if (isSmartFavorite(f)) {
      const row = smartFavoriteRow(f, !!q && formatQuery(q) === f.query);
      favoriteDrop(row, "is-drop-before", favoriteKey(f));
      return row;
    }
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
        "data-path": f.path,
        draggable: "true",
        ...opens((e) => void openAt(f.path, e ? clickWhere(e) : "here")),
        // A middle-click opens it in a new tab, as in a browser.
        onmousedown: (e: MouseEvent) => e.button === 1 && e.preventDefault(),
        onauxclick: (e: MouseEvent) => e.button === 1 && (e.preventDefault(), openInNewTab(f.path)),
        ondragstart: (e: DragEvent) => {
          e.dataTransfer!.setData(FAVORITE, f.path);
          e.dataTransfer!.setData(NOTE_DRAG, f.path); // so it can go to a folder too
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
        el("button", { type: "button", class: "row-act fav-star", title: "Unstar", onclick: (e: Event) => (e.stopPropagation(), void toggleStar(f.path)) }, icon("starred", 14)),
      ),
    );
    rowMenu(row, displayName(f.path), () => [
      { label: "Open", icon: "edit", run: () => openNote(f.path) },
      { label: "Open in new tab", icon: "plus", run: () => openInNewTab(f.path) },
      { label: "Open to the side", icon: "split", run: () => openNote(f.path, { pane: sideOf(active) }) },
      viewer ? null : { label: "Rename…", icon: "edit", run: () => renamePath(f.path) },
      { label: "Remove from Favorites", icon: "starred", run: () => toggleStar(f.path) },
    ]);
    favoriteDrop(row, "is-drop-before", f.path);
    return row;
  });
  $("#favorites").replaceChildren(...(rows.length ? rows : [sectionHint("Star a note, a tag or a search to keep it here. A note's star is in its top bar: ", icon("star", 12))]));
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
    if (!favorites.some((f) => favoriteKey(f) === key)) favorites = await (key.startsWith("#") ? api.starTag(key) : key.startsWith("~") ? api.starSmartFolder(key.slice(1)) : api.star(key));
    const order = favorites.map(favoriteKey).filter((k) => k !== key);
    const at = before ? order.indexOf(before) : -1;
    order.splice(at < 0 ? order.length : at, 0, key);
    favorites = await api.orderFavorites(order);
  } catch {
    return toast({ text: `Couldn't star ${key.startsWith("#") ? key : key.startsWith("~") ? "that view" : displayName(key)}` });
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
/** Where a moved note came from, for Activity: its old name if it was renamed, else its old folder. */
const movedFrom = (from: string, to: string) =>
  displayName(from) !== displayName(to) ? displayName(from) : parentOf(from) || "the top level";

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
  const showing = page === "notes" ? formatQuery(notesPage.query) : null;
  renderSmartFolders(showing);
  notesPage.named((showing && smartFolders.find((f) => f.query === showing)?.name) || null);
  const assetCount = notes.filter((n) => n.kind === "asset" && !isArchived(n.path)).length;
  $("#assets-count").textContent = assetCount ? String(assetCount) : "";
  // Contacts, Calendar, Assets and Smart folders wait until they're in use, or until you're on one.
  const here = new Set<OptionalItem>(revealed);
  if (page === "contacts" || page === "calendar" || page === "assets") here.add(page);
  const shown = shownItems(
    {
      contacts: notes.some((n) => n.kind === "md" && n.path.startsWith(`${PEOPLE}/`) && !isArchived(n.path)), // what api.contacts() lists
      calendar: hasCalendars,
      assets: assetCount > 0,
      smart: smartFolders.length > 0,
    },
    prefs.sidebarPinned,
    here,
    !gamified(),
  );
  for (const item of ["contacts", "calendar", "assets"] as const) $(`#${item}-btn`).hidden = !shown[item];
  $('.tree-head[data-section="smart"]').hidden = !shown.smart;
  $("#smart-folders").hidden = !shown.smart || !!prefs.folded.smart;
  setCurrent($("#notes-btn"), showing === "" || page === "archive" || page === "trash"); // Archive and Trash are tabs of Notes
  const shownTag = showing === null ? "" : (parseQuery(showing).tag ?? "");
  renderTagTree(shownTag && showing === formatQuery({ tag: shownTag }) ? shownTag.toLowerCase() : ""); // a tag alone, like a folder alone
  setCurrent($("#today-btn"), page === "today");
  setCurrent($("#tasks-btn"), page === "tasks");
  setCurrent($("#calendar-btn"), page === "calendar");
  setCurrent($("#contacts-btn"), page === "contacts");
  setCurrent($("#history-btn"), page === "history" && !historyPage?.noteFilter);
  setCurrent($("#assets-btn"), page === "assets");
  setCurrent($("#tags-page-btn"), page === "tags", "is-on");
  setCurrent($("#shared-btn"), page === "shared");

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
            title: `${n ? `Show the notes in ${path}.` : `${path} is empty. Drag notes here.`} Right-click for more.`,
            ...opens(() => void showNotes({ tab: "notes", query: { folder: path } })),
          },
          subs
            ? el(
                "button",
                {
                  type: "button",
                  class: "chev",
                  title: open ? "Hide subfolders" : "Show subfolders",
                  "aria-label": `${open ? "Hide" : "Show"} the folders in ${path}`,
                  "aria-expanded": String(open),
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
            // Export, Share, Rename and Delete are in the folder's menu: right-click, Shift+F10, or ⋯ on touch.
          ),
        );
        rowMenu(row, path, () => folderMenu(path));
        dropTarget(row, () => path);
        dragsPage(row, path.split("/").pop()!, () => showNotes({ tab: "notes", query: { folder: path } }));
        return [row, ...(open ? walk(path, depth + 1) : [])];
      });
  const rows = walk("", 0);
  $("#tree").replaceChildren(...(rows.length ? rows : [sectionHint("Click ", plusMark(), " to make a folder.")]));
}

/** A folder's menu in the sidebar: what you do to it now and then, kept off the row itself. */
function folderMenu(path: string): (RowMenuItem | null)[] {
  return [
    pageTabItem(() => showNotes({ tab: "notes", query: { folder: path } })),
    { label: "New note here", icon: "plus", run: () => newNote(path) },
    { label: "Export as .zip", icon: "download", run: () => exportZip({ folder: path }) },
    workspaceId ? { label: "Share…", icon: "share", run: () => openShareDialog({ folder: path }) } : null,
    viewer ? null : { label: "Rename…", icon: "edit", run: () => renameFolder(path) },
    viewer ? null : { label: "Delete…", icon: "trash", danger: true, run: () => removeFolder(path) },
  ];
}

/** Delete a folder: an empty one just goes; one with notes asks what happens to them. */
async function removeFolder(path: string) {
  if (!(await deleteFolder(path, deleteHooks))) return;
  void refreshShares(); // its shares went with it
  const empty = emptyFolders();
  for (const f of [...empty]) if (f === path || f.startsWith(`${path}/`)) empty.delete(f);
  setEmptyFolders(empty);
  if (notesPage.query.folder === path || notesPage.query.folder?.startsWith(`${path}/`)) await showNotes({ tab: "notes", query: {} });
  renderTree();
}

// ------------------------------------------------------------------ renaming
// Everything with a name in a list renames the same way: F2 or a double-click on its row, its ✎
// where a row has buttons, or ⌘K "Rename…" for what's showing. Each asks for the new name in the
// same dialog, except a note named by its heading, whose heading is selected to type over.

/** Rename a folder: everything in it moves (its archived notes too), links rewritten. Undo puts it back. */
async function renameFolder(path: string) {
  if (viewer) return;
  const typed = await askName("Rename folder", path.split("/").pop()!);
  const name = typed && cleanName(typed);
  const to = name && (parentOf(path) ? `${parentOf(path)}/${name}` : name);
  if (!to || to === path) return;
  if (await moveFolder(path, to)) {
    toast({ icon: "folder", text: `Renamed ${path} to ${to}`, actionLabel: "Undo", action: () => void moveFolder(to, path) });
  }
}

/** Move a folder from `from` to `to` (an empty one only here, in this browser), and follow it in the sidebar and Notes. Whether it moved. */
async function moveFolder(from: string, to: string): Promise<boolean> {
  const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  const moved = (p: string) => (inside(p, from) ? to + p.slice(from.length) : p);
  if (notes.some((n) => inside(n.path, from) || inside(n.path, `Archive/${from}`))) {
    await flushSave(); // an open note in it is saved under the name it has now
    try {
      await api.renameFolder(from, to);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : `Couldn't rename ${from}` });
      return false;
    }
  } else if (to.toLowerCase() !== from.toLowerCase() && allFolders().some((f) => f.toLowerCase() === to.toLowerCase())) {
    toast({ text: `There's already a folder named ${to}` });
    return false;
  }
  setEmptyFolders(new Set([...emptyFolders()].map(moved)));
  const open = [...prefs.expanded];
  prefs.expanded.clear();
  for (const f of open) prefs.expanded.add(moved(f));
  store.set("expanded", [...prefs.expanded]);
  if (parentOf(to)) setExpanded(parentOf(to), true);
  await refreshNotes();
  const shown = notesPage.visible ? notesPage.query.folder : undefined;
  if (shown && inside(shown, from)) await showNotes({ tab: notesPage.tab, query: { ...notesPage.query, folder: moved(shown) }, push: false });
  return true;
}

/** Rename an asset in the folder it's in, keeping its type. Its links follow; Undo puts the old name back. Resolves to its new path. */
async function renameAsset(path: string): Promise<string | null> {
  if (viewer) return null;
  const file = path.split("/").pop()!;
  const ext = file.match(/\.[^.]+$/)?.[0] ?? "";
  const typed = await askName("Rename file", file.slice(0, file.length - ext.length));
  const name = typed && cleanName(typed);
  if (!name) return null;
  let r;
  try {
    r = await api.move(path, `${path.slice(0, path.length - file.length)}${name}${ext}`);
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : `Couldn't rename ${file}` });
    return null;
  }
  await refreshNotes();
  const others = r.updated.filter((p) => p !== r.path).length;
  const to = r.path;
  toast({
    icon: "edit",
    text: `Renamed to ${to.split("/").pop()}`,
    detail: others ? `Updated links in ${others} note${others > 1 ? "s" : ""}` : undefined,
    actionLabel: "Undo",
    action: () => void api.move(to, path).then(refreshNotes, (e) => toast({ text: e instanceof Error ? e.message : `Couldn't rename it back` })),
  });
  return to;
}

/** Rename a note or asset from a list it's in (F2 or a double-click): a note opens, then renames as ⌘K's Rename note does. */
async function renamePath(path: string) {
  if (viewer) return;
  if (notes.find((n) => n.path === path)?.kind === "asset") return void (await renameAsset(path));
  if (active.session?.path !== path) await openNote(path);
  if (active.session?.path === path) await renameNote();
}

/** Rename (or merge) a tag from the sidebar or ⌘K: the same rename, with Undo, the Tags page does. */
async function renameTag(t: TagCount) {
  if (viewer) return;
  const typed = await askName("Rename tag", t.display);
  if (!typed) return;
  const to = cleanTag(typed);
  if (!to) return toast({ text: "A tag is letters, numbers, - and _, nested with /" });
  if (to !== t.display) await (await loadTags()).rename(t, to);
}

/** A smart folder's name is in its editor: renaming one opens that, from its row's sliders. */
function editSmartFolder(id: string) {
  if (prefs.folded.smart) $('[aria-controls="smart-folders"]').click();
  $(`#smart-folders .tree-row[data-smart="${CSS.escape(id)}"] .row-act`)?.click();
}

/** Rename what a sidebar row names (F2 or a double-click on it). */
function renameRow(row: HTMLElement) {
  const { folder, tag, smart, path } = row.dataset;
  const t = tag ? tags.find((x) => x.tag === tag) : undefined;
  if (folder) void renameFolder(folder);
  else if (t) void renameTag(t);
  else if (smart) editSmartFolder(smart);
  else if (path) void renamePath(path);
}

/** What ⌘K's Rename… (and F2 outside a list) renames: the file Assets previews, what Notes shows on its own (a folder, tag or smart folder), or the open note. */
function renameTarget(): { what: Renamable; run(): void } | null {
  if (viewer) return null;
  const page = onPage();
  const previewed = page === "assets" ? assetsPage?.previewed : null;
  if (previewed) return { what: "file", run: () => void assetsPage?.rename(previewed) };
  if (page === "notes") {
    const q = notesPage.query;
    const showing = formatQuery(q);
    if (q.folder && showing === formatQuery({ folder: q.folder })) return { what: "folder", run: () => void renameFolder(q.folder!) };
    const t = q.tag && showing === formatQuery({ tag: q.tag }) ? tags.find((x) => x.tag === normalizeTag(q.tag!)) : undefined;
    if (t) return { what: "tag", run: () => void renameTag(t) };
    const f = showing ? smartFolders.find((x) => x.query === showing) : undefined;
    if (f) return { what: "view", run: () => editSmartFolder(f.id) };
  }
  return !page && active.session ? { what: "note", run: () => void renameNote() } : null;
}

/**
 * Tags in the sidebar, as a tree with how many notes carry each (tags under it included). Nested
 * tags start closed; clicking a tag shows Notes narrowed to it, the way a folder does.
 */
function renderTagTree(active: string) {
  const shown = sidebarTags(tags);
  const onlyTasks = (t: TagCount) => !t.notes && !t.assets && t.tasks > 0;
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
            // A tag only tasks carry opens its tasks: no note is tagged with it.
            title: unusedTag(t) ? `No note has #${t.display} yet` : onlyTasks(t) ? `Tasks tagged #${t.display}` : `Notes tagged #${t.display}`,
            ...opens(() => openTag(t.display, onlyTasks(t) ? "tasks" : "notes")),
          },
          subs
            ? el(
                "button",
                {
                  type: "button",
                  class: "chev",
                  title: open ? "Hide nested tags" : "Show nested tags",
                  "aria-label": `${open ? "Hide" : "Show"} the tags under #${t.tag}`,
                  "aria-expanded": String(open),
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
          isTagStarred(t.display) ? el("span", { class: "fav-mark", title: "Starred" }, icon("starred", 11)) : null,
          unusedTag(t) ? null : el("span", { class: "n" }, String(onlyTasks(t) ? t.tasks : t.notes)),
          el(
            "span",
            { class: "row-actions" },
            viewer ? null : el("button", { type: "button", class: "row-act", title: `Rename #${t.display}… (F2)`, onclick: (e: Event) => (e.stopPropagation(), void renameTag(t)) }, icon("edit", 14)),
            // A tag no note carries can't be a favorite (it would show no notes); one nothing carries yet can go again.
            onlyTasks(t) ? null
            : !unusedTag(t) ? tagStarButton(t.display, "row")
            : viewer ? null
            : el("button", { type: "button", class: "row-act", title: `Delete #${t.display}`, onclick: (e: Event) => (e.stopPropagation(), void deleteTag(t)) }, icon("trash", 14)),
          ),
        );
        dragsPage(row, `#${t.display}`, () => (onlyTasks(t) ? showTasks({ tag: t.display }) : showNotes({ tab: "notes", query: { tag: t.display } })));
        rowMenu(row, `#${t.display}`, () => tagMenu(t.display, !unusedTag(t), t));
        return [row, ...(open ? walk(t.tag, depth + 1) : [])];
      });
  const rows = walk("", 0);
  const hint = viewer ? sectionHint("Tags written in notes show here.") : sectionHint("Click ", plusMark(), " to add a tag, or write #tag in a note.");
  $("#tag-tree").replaceChildren(...(rows.length ? rows : [hint]));
}

/** A name field at the top of Tags. The tag it names is there to pick before any note carries it. */
function startNewTag() {
  if (prefs.folded.tags) $('[aria-controls="tag-tree"]').click(); // unfold Tags, or the name field is hidden
  nameField($("#tag-tree"), {
    icon: "hash",
    placeholder: "Tag, like work/clients",
    label: "New tag",
    done: (typed) => (typed?.trim() ? void addTag(typed) : renderTree()),
  });
}

async function addTag(typed: string) {
  const display = cleanTag(typed);
  if (!display) {
    renderTree();
    return toast({ text: "A tag is letters, numbers, - and _, nested with /" });
  }
  const key = display.toLowerCase();
  const had = tags.find((t) => t.tag === key);
  if (!had) {
    try {
      tags = await api.addTag(display);
    } catch (e) {
      renderTree();
      return toast({ text: e instanceof Error ? e.message : `Couldn't add #${display}` });
    }
  }
  // Open its parents, so the tag shows where it went.
  for (let at = key.lastIndexOf("/"); at > 0; at = key.lastIndexOf("/", at - 1)) prefs.tagsOpen.add(key.slice(0, at));
  store.set("tagsOpen", [...prefs.tagsOpen]);
  renderTree();
  tagsPage?.refresh();
  toast(had ? { icon: "hash", text: `#${had.display} is already a tag` } : { icon: "hash", text: `Added #${display}`, detail: "Type it in a note to use it." });
}

/** Take away a tag nothing carries yet, and the ones under it, with Undo. */
async function deleteTag(t: TagCount) {
  const leaves = tags.filter((x) => tagMatches(x.tag, t.tag) && !tags.some((c) => c.tag.startsWith(`${x.tag}/`)));
  try {
    tags = await api.deleteTag(t.tag);
  } catch (e) {
    return toast({ text: e instanceof Error ? e.message : `Couldn't delete #${t.display}` });
  }
  renderTree();
  tagsPage?.refresh();
  toast({
    icon: "hash",
    text: `Deleted #${t.display}`,
    actionLabel: "Undo",
    action: async () => {
      for (const l of leaves) tags = await api.addTag(l.display).catch(() => tags);
      renderTree();
      tagsPage?.refresh();
    },
  });
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
      body.hidden = folded || head.hidden; // a section the sidebar leaves out until it's in use (Smart folders) stays out
    };
    toggle.addEventListener("click", () => {
      prefs.folded[section] = !prefs.folded[section];
      store.set("folded", prefs.folded);
      apply();
    });
    apply();
  });
  // A double-click on a row renames what it names, as F2 does (not on its buttons, which do their own thing).
  $("#sidebar").addEventListener("dblclick", (e) => {
    const at = e.target as HTMLElement;
    const row = at.closest<HTMLElement>(".tree-row");
    if (!row || viewer || at.closest("button, input")) return;
    e.preventDefault();
    renameRow(row);
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
function dropTarget(node: HTMLElement, folder: () => string) {
  node.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(NOTE_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    markDrop(folder());
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
    void moveToFolder(path, folder());
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

/** Archive a note by its path (the guide's last card offers it). The open note stays open (marked archived), like ⌘⇧E. */
async function archivePath(path: string) {
  const open = panes.find((p) => p.session?.path === path);
  if (open) return archiveCurrent(open);
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
  nameField($("#tree"), {
    icon: "folder",
    placeholder: "Folder name",
    label: "New folder",
    done: (typed) => {
      const name = (typed ?? "").trim().replace(/[\\:*?"<>|#^[\]]/g, "").replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");
      if (name && !allFolders().some((f) => f.toLowerCase() === name.toLowerCase())) {
        const empty = emptyFolders();
        empty.add(name);
        setEmptyFolders(empty);
        if (parentOf(name)) setExpanded(parentOf(name), true); // show where the new folder went
        toast({ icon: "folder", text: `Made ${name}`, detail: "Drag notes onto it, or use Move on a note." });
      }
      renderTree();
    },
  });
}

// ------------------------------------------------------------------ chrome: top bar, status, panel

function renderChrome() {
  const s = active.session;
  $("#archive-btn").hidden = !s;
  $("#delete-btn").hidden = !s || viewer;
  $("#move-btn").hidden = !s;
  $("#star-btn").hidden = !s || s.kind === "asset";
  $("#share-btn").hidden = !s || s.kind === "asset";
  setShareState(!!s && !!workspaceId && isShared(s.id, s.path));
  $("#note-history-btn").hidden = !s || s.kind === "asset";
  $("#focus-btn").hidden = !s || s.kind === "asset";
  $("#split-btn").hidden = !split && (!s || s.kind === "asset");
  setLabel($("#split-btn"), `${split ? "Close split view" : "Open split view"} (${formatKeys("Mod-Alt-\\")})`);
  $("#split-btn").classList.toggle("is-on", split);
  $("#save-status").hidden = !s;
  renderCodeWrap();
  renderPaneBars();
  if (!s) {
    $("#html-toggle").hidden = true;
    for (const id of ["#vim-mode", "#cursor-pos", "#word-count"]) $(id).textContent = "";
    $("#vim-mode").dataset.mode = "";
    renderMore();
    return;
  }
  const starred = isStarred(s.id);
  $("#star-btn").classList.toggle("is-on", starred);
  setLabel($("#star-btn"), starred ? "Unstar" : "Star");
  $("#star-btn").replaceChildren(icon(starred ? "starred" : "star", 16));
  const archived = isArchived(s.path);
  setLabel($("#archive-btn"), `${archived ? "Unarchive note" : "Archive note"} (${formatKeys("Mod-Shift-e")})`);
  $("#archive-btn").replaceChildren(icon(archived ? "unarchive" : "archive", 16));
  const folder = parentOf(s.path);
  setLabel($("#move-btn"), `${folder ? `In ${folder.split("/").join(" / ")}` : "At the top level"} · Move to another folder`);
  $("#html-toggle").hidden = s.kind !== "html";
  $("#html-toggle").querySelectorAll("button").forEach((b) => setPressed(b, b.dataset.mode === prefs.htmlMode));
  setSaveStatus("saved");
  renderMore();
}

function openMovePicker(anchor: HTMLElement) {
  const s = active.session;
  if (!s) return;
  folderPicker(anchor, { folders: allFolders(), current: parentOf(s.path), onPick: (folder) => void moveToFolder(s.path, folder) });
}

/**
 * The status bar says nothing while notes are saved and the server is reachable. It speaks up, in
 * words, only when something is off: offline, a save that failed, or a save that's taking a while.
 */
let slowSave = 0;
function setSaveStatus(state: "saved" | "editing" | "saving" | "error") {
  const node = $("#save-status");
  // Screen readers hear only a failed save, not "Edited… Saving… Saved" at every pause in typing.
  // Offline, they already heard that once, so a save failing for that reason stays quiet.
  if (state === "error" && node.dataset.state !== "error" && !offline()) $("#toast-alert").textContent = "Not saved";
  node.dataset.state = state;
  node.dataset.slow = "";
  clearTimeout(slowSave);
  // A quick save comes and goes without a word; one that takes over a second says so.
  if (state === "saving") slowSave = window.setTimeout(() => ((node.dataset.slow = "true"), renderHealth()), 1000);
  renderHealth();
}

const offline = () => $("#conn").dataset.up === "false";

function renderHealth() {
  const node = $("#save-status");
  const state = node.dataset.state;
  const retrying = !!active.session?.failed;
  const [text, hint] = offline()
    ? ["", ""] // the connection line already says changes will save when it's back
    : state === "error"
      ? retrying
        ? ["Not saved · retrying", "Your latest changes aren't saved yet. Keep this tab open: they're retried every few seconds"]
        : ["Not saved", "Your latest changes aren't saved yet. They're tried again on your next edit"]
      : state === "saving" && node.dataset.slow
        ? ["Saving…", "Saving your latest changes…"]
        : ["", ""];
  node.textContent = text;
  node.title = hint;
  node.classList.toggle("is-bad", state === "error");
}

function setOnline(up: boolean) {
  const conn = $("#conn");
  const was = conn.dataset.up;
  conn.dataset.up = String(up);
  conn.textContent = up ? "" : "Offline · changes will save when back";
  conn.title = up ? "" : "Can't reach the server, reconnecting… Your edits are kept and saved once the connection is back";
  // Said once each way, and nothing for the first connection.
  if (!up && was !== "false") $("#toast-alert").textContent = "Offline. Changes will save when the connection is back";
  if (up && was === "false") $("#toast-status").textContent = "Back online";
  renderHealth();
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
/** The open note's headings, for the outline and quick open's `#`. */
function noteHeadings(): Array<{ level: number; text: string; line: number }> {
  const out: Array<{ level: number; text: string; line: number }> = [];
  if (active.session?.kind !== "md") return out;
  for (const [i, t] of proseLines(active.view.state.doc.toString())) {
    const m = t.match(/^(#{1,6})[ \t]+(.+)$/);
    const words = m && headingText(m[2]);
    if (words) out.push({ level: m[1].length, text: (headingName(words) || words).replace(/[*_`~]|\[\[|\]\]/g, ""), line: i });
  }
  return out;
}
function renderOutline() {
  const box = $("#outline");
  outlineHeadings = noteHeadings();
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
// Links from archived notes wait behind a toggle, so old copies don't sit beside the live ones
// (an archived note shows all its links: there they're the context).
let archivedBacklinksShown = false;
async function refreshBacklinks() {
  const s = active.session;
  if (!s) return;
  const all = await api.backlinks(s.path, "all").catch(() => []);
  if (s !== active.session) return;
  const fromArchive = isArchived(s.path) ? [] : all.filter((b) => isArchived(b.path));
  const links = all.filter((b) => !fromArchive.includes(b));
  const row = (b: Backlink) =>
    el(
      "div",
      { class: `backlink${isArchived(b.path) ? " is-archived" : ""}`, onclick: (e: MouseEvent) => openAt(b.path, clickWhere(e), { line: b.line }), onauxclick: (e: MouseEvent) => e.button === 1 && openAt(b.path, "tab", { line: b.line }) },
      el("div", { class: "bl-title" }, icon(b.kind === "embed" ? "open" : "link", 12), b.title),
      el("div", { class: "bl-text", html: highlightLink(b.text) }),
    );
  const toggle = fromArchive.length
    ? el(
        "button",
        { type: "button", class: "bl-archived-toggle", onclick: () => ((archivedBacklinksShown = !archivedBacklinksShown), void refreshBacklinks()) },
        archivedBacklinksShown ? "Hide links from archived notes" : `${fromArchive.length} more from archived ${fromArchive.length === 1 ? "note" : "notes"}`,
      )
    : null;
  $("#backlink-count").textContent = links.length ? String(links.length) : "";
  $("#backlinks").replaceChildren(
    ...(links.length ? links.map(row) : [el("div", { class: "panel-empty" }, fromArchive.length ? "No backlinks from active notes" : "No backlinks yet")]),
    ...(toggle ? [toggle] : []),
    ...(archivedBacklinksShown ? fromArchive.map(row) : []),
  );
  refreshMentionsSoon();
}
const refreshBacklinksSoon = debounce(refreshBacklinks, 300);

// Unlinked mentions: other notes that write this note's name without linking it, under Backlinks,
// folded. Only looked for while the side panel shows, a moment after the note settles.
let mentionsOpen = false;
const panelShows = () => !document.body.classList.contains("is-focus") && (narrow.matches ? document.body.classList.contains("panel-overlay") : prefs.panel);
async function refreshMentions() {
  const box = $("#unlinked");
  const s = active.session;
  if (!s || s.kind !== "md") return void ((box.hidden = true), box.replaceChildren());
  if (!panelShows()) return; // looked for again when the panel opens
  const found = await api.mentions(s.path).catch(() => []);
  if (s !== active.session) return;
  box.hidden = !found.length;
  if (!found.length) return void box.replaceChildren();
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const row = (m: UnlinkedMention) => {
    const at = m.context.indexOf(m.text);
    const text = at < 0 ? esc(m.context) : `${esc(m.context.slice(0, at))}<b>${esc(m.text)}</b>${esc(m.context.slice(at + m.text.length))}`;
    return el(
      "div",
      { class: "backlink is-mention", onclick: (e: MouseEvent) => openAt(m.path, clickWhere(e), { line: m.line }) },
      el(
        "div",
        { class: "bl-title" },
        icon("file", 12),
        el("span", { class: "bl-name" }, m.title),
        viewer
          ? null
          : el(
              "button",
              { type: "button", class: "bl-link", title: `Make “${m.text}” a link to ${s.title}`, onclick: (e: MouseEvent) => (e.stopPropagation(), void linkMention(s.path, m)) },
              "Link",
            ),
      ),
      el("div", { class: "bl-text", html: text }),
    );
  };
  const details = el(
    "details",
    { class: "bl-unlinked", ontoggle: (e: Event) => (mentionsOpen = (e.currentTarget as HTMLDetailsElement).open) },
    el("summary", {}, "Unlinked mentions ", el("span", { class: "count" }, String(found.length))),
    ...found.map(row),
  );
  details.open = mentionsOpen;
  box.replaceChildren(details);
}
const refreshMentionsSoon = debounce(refreshMentions, 600);

/** The Link button: that one mention becomes [[this note]], one change in that note, with Undo. */
async function linkMention(target: string, m: UnlinkedMention) {
  let r: Awaited<ReturnType<typeof api.linkMention>>;
  try {
    r = await api.linkMention(target, m);
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : "Couldn't link it" });
    return void refreshMentions();
  }
  void refreshBacklinks();
  if (r.change === null) return;
  const change = r.change;
  toast({
    icon: "link",
    text: `Linked “${m.text}” in ${m.title}`,
    actionLabel: "Undo",
    action: async () => {
      await api.restore(change, r.version).catch((e) => toast({ text: e instanceof Error ? e.message : "Couldn't undo it" }));
      void refreshBacklinks();
    },
  });
}
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
                c.op === "move" && c.from_path ? el("span", {}, `from ${movedFrom(c.from_path, c.path)}`) : null,
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
// Not :delete, which is Vim's own (:d deletes lines).
Vim.defineEx("trash", "trash", () => void deleteCurrent());
Vim.defineEx("unarchive", "unarch", () => active.session && isArchived(active.session.path) && void archiveCurrent());
Vim.defineEx("notes", "note", () => void showNotes());
Vim.defineEx("calendar", "cal", () => void showCalendar());
Vim.defineEx("today", "tod", () => void showToday());
Vim.defineEx("tasks", "tasks", () => void showTasks());
Vim.defineEx("tags", "tags", () => void showTags());
Vim.defineEx("history", "hist", () => void showHistory());
Vim.defineEx("assets", "assets", () => void showAssets());
Vim.defineEx("contacts", "con", () => void showContacts());
// :move Projects/Acme files the note there (any case; / is the top level); :move alone opens the folder picker.
Vim.defineEx("move", "mo", (_cm: unknown, params: { args?: string[] }) => {
  const s = active.session;
  if (!s) return;
  const arg = params.args?.join(" ").trim().replace(/^\/+|\/+$/g, "");
  if (arg === undefined) return void setTimeout(() => openMovePicker($("#move-btn")));
  const folder = arg === "" ? "" : allFolders().find((f) => f.toLowerCase() === arg.toLowerCase());
  if (folder === undefined) return void toast({ text: `No folder named ${arg}` });
  void moveToFolder(s.path, folder);
});
// After vim puts the focus back in the editor, so the name prompt keeps it.
Vim.defineEx("rename", "ren", () => setTimeout(() => void renameNote()));
Vim.defineEx("star", "star", () => active.session && void toggleStar(active.session.path));
Vim.defineEx("share", "sha", () => openShare());
// :version names the note's version as it is now (:version v1); with no name, it asks for one. :label still works.
const nameVersion = (_cm: unknown, params: { args?: string[] }) => void labelCurrent(params.args?.join(" ").trim() || undefined);
Vim.defineEx("version", "version", nameVersion);
Vim.defineEx("label", "label", nameVersion);
Vim.defineEx("focus", "foc", () => void setFocusMode(!focusMode));
// :vsplit opens the side pane beside, :split below (as in vim, where :split stacks windows).
for (const [name, short, at] of [["vsplit", "vs", "right"], ["split", "sp", "bottom"]] as const)
  Vim.defineEx(name, short, (_cm: unknown, params: { args?: string[] }) => {
    dockAt(at);
    const arg = params.args?.join(" ");
    if (arg) void openTarget(arg, active.session?.path, sideOf(active));
    else if (!split) void openSplit();
  });
// :tabnew and :tabedit (:tabe) open a note in a new tab (alone, quick open picks one).
for (const [name, short] of [["tabnew", "tabnew"], ["tabedit", "tabe"]])
  Vim.defineEx(name, short, (_cm: unknown, params: { args?: string[] }) => {
    const arg = params.args?.join(" ");
    if (arg) void openTarget(arg, active.session?.path, active, true);
    else newTab();
  });
// :tabclose and :q close this tab (in vim, :q closes the window, and here a tab is the window's
// note); :tabonly the others.
Vim.defineEx("tabclose", "tabc", closeActiveTab);
Vim.defineEx("quit", "q", closeActiveTab);
Vim.defineEx("tabonly", "tabo", () => void closeIn(active, closeOthers(active.group, active.group.at), active.group.at));
Vim.defineEx("tabnext", "tabn", () => stepTabIn(active, 1));
Vim.defineEx("tabprevious", "tabp", () => stepTabIn(active, -1));
Vim.map("gt", ":tabnext<CR>", "normal");
Vim.map("gT", ":tabprevious<CR>", "normal");
Vim.defineEx("only", "on", () => split && void closePane(other(active)));
Vim.defineEx("close", "clo", () => void closePane(active));
// `ic`, the inner code block: the code between a fenced block's fences, for yic, dic, cic and vic.
Vim.defineMotion("commonInkInnerCode", (_cm: unknown, head: { line: number; ch: number }) => {
  const { state } = active.view;
  const r = codeRange(state, state.doc.line(head.line + 1).from + head.ch);
  if (!r || r.to <= r.from) return head;
  const pos = (at: number) => {
    const line = state.doc.lineAt(at);
    return { line: line.number - 1, ch: at - line.from };
  };
  return [pos(r.from), pos(r.to)];
});
Vim.mapCommand("ic", "motion", "commonInkInnerCode", {}, { context: "operatorPending" });
Vim.mapCommand("ic", "motion", "commonInkInnerCode", {}, { context: "visual" });
Vim.defineAction("commonInkFollowLink", () => followLinkAtCursor());
Vim.mapCommand("gd", "action", "commonInkFollowLink", {}, { context: "normal" });
Vim.mapCommand("gf", "action", "commonInkFollowLink", {}, { context: "normal" });
Vim.defineAction("commonInkOpenSide", () => openLinkToSide(active.view));
Vim.mapCommand("gs", "action", "commonInkOpenSide", {}, { context: "normal" });
Vim.mapCommand("gD", "action", "commonInkOpenSide", {}, { context: "normal" });
// Ctrl-O and Ctrl-I: back and forward through the notes this pane has shown, like vim's jumps across files.
Vim.defineAction("commonInkBack", () => void stepPane(active, "back"));
Vim.defineAction("commonInkForward", () => void stepPane(active, "forward"));
Vim.mapCommand("<C-o>", "action", "commonInkBack", {}, { context: "normal" });
Vim.mapCommand("<C-i>", "action", "commonInkForward", {}, { context: "normal" });
// Collapsible sections: za toggles the one under the cursor, zo/zc open and close it, zR/zM all of them.
for (const [keys, run] of [["za", foldAt("toggle")], ["zo", foldAt("open")], ["zc", foldAt("close")], ["zR", foldAll(true)], ["zM", foldAll(false)]] as const) {
  Vim.defineAction(`commonInkFold${keys}`, () => run(active.view));
  Vim.mapCommand(keys, "action", `commonInkFold${keys}`, {}, { context: "normal" });
}
setVimDisplayLines(prefs.vimDisplayLines);
// :set number / :set nu / :set nonu / :set nu! / :set nu? — the same setting as ⌘K's, one for every pane.
// Vim calls this once globally and once for the editor; the global call does the work, and asked
// for the editor's own value it answers undefined, which falls back to the global one.
Vim.defineOption("number", undefined, "boolean", ["nu"], (value?: boolean, cm?: unknown) => {
  if (value === undefined) return cm ? undefined : prefs.lineNumbers;
  if (!cm) setLineNumbers(value);
});

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
    // Back and forward through the notes (and pages) this pane has shown: ⌘[ and ⌘] by the character
    // typed, and off a Mac also Alt+← and Alt+→, the platform's back and forward.
    // On a calendar event, Alt+← and Alt+→ move it a day instead (calendar/keys.ts).
    const onEvent = !!(e.target as Element | null)?.closest?.("[data-event], .cal-details");
    const altArrow = !IS_MAC && !onEvent && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? e.key : null;
    const back = is("Mod-[") || altArrow === "ArrowLeft";
    const quickOpen = is("Mod-p") || is("Mod-k");
    const tabDigit = e.code.match(/^(?:Digit|Numpad)([1-9])$/)?.[1];
    if (back || is("Mod-]") || altArrow === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      void stepPane(active, back ? "back" : "forward");
    } else if (quickOpen || is("Mod-Shift-p")) {
      e.preventDefault();
      paletteHow = "here";
      if (quickOpen && !palette.isOpen) did("search");
      palette.toggle(quickOpen ? "" : ">");
    } else if (is("Mod-,")) {
      e.preventDefault();
      openSettings();
    } else if (is("Mod-\\")) {
      e.preventDefault();
      togglePanel();
    } else if (is("Mod-s")) {
      e.preventDefault();
      flushSave();
    } else if (is("Mod-Shift-e")) {
      e.preventDefault();
      void archiveCurrent();
    } else if (is(SHARE_KEYS) && shareNote()) {
      e.preventDefault();
      openShare();
    } else if (is("Mod-Shift-Enter")) {
      e.preventDefault();
      void setFocusMode(!focusMode);
    } else if (is("Mod-Shift-f")) {
      e.preventDefault();
      void showNotes({ filter: true });
    } else if (is(ADVANCED_KEYS)) {
      e.preventDefault();
      void advancedSearch();
    } else if (is("Mod-Alt-\\")) {
      e.preventDefault();
      void (split ? closePane(active) : openSplit());
    } else if (is("Mod-t") || is("Mod-Alt-t")) {
      // Tabs, as in a browser or an editor. In a browser tab the browser keeps ⌘T, ⌘W, ⌘⇧T and
      // ⌃Tab for its own tabs; ⌘⌥T, ⌘⌥W, ⌘⌥⇧T and ⌃PageDown/⌃PageUp do the same here.
      e.preventDefault();
      newTab();
    } else if (is("Mod-w") || is("Mod-Alt-w")) {
      e.preventDefault();
      closeActiveTab();
    } else if (is("Mod-Shift-t") || is("Mod-Alt-Shift-t")) {
      e.preventDefault();
      void reopenTab();
    } else if (is("Ctrl-Tab") || is("Ctrl-PageDown") || is("Ctrl-Shift-Tab") || is("Ctrl-PageUp")) {
      e.preventDefault();
      e.stopPropagation(); // not the editor's indent
      stepTabIn(active, is("Ctrl-Tab") || is("Ctrl-PageDown") ? 1 : -1);
    } else if (is("Mod-Shift-PageUp") || is("Mod-Shift-PageDown")) {
      e.preventDefault();
      nudgeTabIn(active, active.group.at, e.key === "PageUp" ? -1 : 1);
    } else if (tabDigit && (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey) {
      // ⌘1 to ⌘8: that tab; ⌘9: the last.
      e.preventDefault();
      void activateTab(active, jumpIndex(active.group, Number(tabDigit)));
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
    } else if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=dialog]")) {
      // F2 renames: the sidebar row in focus, or (outside the lists that rename their own) what's showing.
      const at = e.target as HTMLElement;
      const row = at.closest?.<HTMLElement>(".tree-row");
      const target = row ? null : at.closest?.("#notes-view, #assets-view, #asset-preview, #tags-view") ? null : renameTarget();
      if (row || target) {
        e.preventDefault();
        if (row) renameRow(row);
        else target!.run();
      }
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
/** A phone: one pane, with its tabs in a strip that scrolls (no split, so no drop zones). */
const phone = matchMedia("(max-width: 760px)");
function togglePanel(force?: boolean) {
  if (narrow.matches && force === undefined) {
    document.body.classList.toggle("panel-overlay"); // narrow windows: the panel floats over the editor
    return refreshMentionsSoon();
  }
  prefs.panel = force ?? !prefs.panel;
  store.set("panel", prefs.panel);
  refreshMentionsSoon(); // looked for only while the panel shows
  document.body.classList.toggle("panel-closed", !prefs.panel);
}

function setVim(on: boolean) {
  prefs.vim = on;
  store.set("vim", on);
  taskInputPrefs.vim = on;
  for (const p of panes) p.view.dispatch({ effects: vimSlot.reconfigure(on ? vim() : []) });
  attachVim();
  renderPaneBars(); // the arrows' labels say Ctrl-O / Ctrl-I with vim on
}
function toggleVim() {
  setVim(!prefs.vim);
  active.view.focus();
}

function toggleVimDisplayLines() {
  prefs.vimDisplayLines = !prefs.vimDisplayLines;
  store.set("vimDisplayLines", prefs.vimDisplayLines);
  setVimDisplayLines(prefs.vimDisplayLines);
}

function setLineNumbers(on: boolean) {
  if (on === prefs.lineNumbers) return;
  prefs.lineNumbers = on;
  store.set("lineNumbers", on);
  for (const p of panes) p.view.dispatch({ effects: lineNumbersSlot.reconfigure(lineNumbersFor(on)) });
}
const toggleLineNumbers = () => setLineNumbers(!prefs.lineNumbers);

const systemDark = matchMedia("(prefers-color-scheme: dark)");
const theme = (): Theme => (document.documentElement.dataset.theme as "light" | "dark" | undefined) ?? "system";
const isDark = () => (theme() === "system" ? systemDark.matches : theme() === "dark");
const toggleTheme = () => setTheme(isDark() ? "light" : "dark");

/** Light, dark, or the system's (index.html applies a stored choice before the page draws). */
function setTheme(next: Theme) {
  try {
    if (next === "system") localStorage.removeItem("commonink.theme");
    else localStorage.setItem("commonink.theme", next);
  } catch {}
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  renderTheme();
}

function renderTheme() {
  $("#theme-toggle").replaceChildren(icon(isDark() ? "sun" : "moon", 15));
  setLabel($("#theme-toggle"), isDark() ? "Switch to the light theme" : "Switch to the dark theme");
  for (const p of panes) {
    if (p.session?.kind === "html") renderHtmlPreview(p);
    if (p.session?.kind === "md") bumpEmbeds(p.view);
  }
}

/** Whether long lines in code blocks wrap, for blocks that don't say (```ts nowrap / wrap do). */
function setCodeWrap(on: boolean) {
  setCodeWrapByDefault(on);
  renderCodeWrap();
  for (const p of panes) bumpEmbeds(p.view);
}

/**
 * The Wrap code chip: only while an open note has a code block for it to change, so a note of
 * plain prose doesn't show a switch that does nothing there. Settings has it always. mobile.css
 * hides it on phones.
 */
function renderCodeWrap() {
  const on = codeWrapByDefault();
  const chip = $("#codewrap-toggle");
  chip.hidden = !panes.some((p) => p.session?.kind === "md" && hasFencedCode(p.view.state.doc.toString()));
  setPressed(chip, on);
  chip.textContent = `Wrap code: ${on ? "on" : "off"}`;
  chip.title = on ? "Long lines in code blocks wrap. Click to scroll them instead." : "Long lines in code blocks scroll. Click to wrap them.";
}

/** As you type: a moment after the last keystroke, so typing or deleting a fence shows or hides the chip. */
let codeWrapTimer = 0;
function renderCodeWrapSoon() {
  clearTimeout(codeWrapTimer);
  codeWrapTimer = window.setTimeout(renderCodeWrap, 300);
}

/** Online, who's signed in (for Settings' Danger zone); locally, null. */
let signedIn: Me["user"] | null = null;

/** Local vaults: where the vault and the `commonink` command are, for connecting an agent. Online, null. */
let localVault: { vault?: string; projectRoot?: string } | null = null;

/** Settings, with `query` in its search box ("ink" goes to the Ink setting). */
function openSettings(query?: string) {
  void import("./settings.ts").then((m) =>
    m.openSettings(
      () =>
        m.appSettings({
          theme: theme(),
          setTheme,
          ink: inkState(),
          setInk,
          lineNumbers: prefs.lineNumbers,
          setLineNumbers,
          codeWrap: codeWrapByDefault(),
          setCodeWrap,
          htmlMode: prefs.htmlMode,
          setHtmlMode,
          vim: prefs.vim,
          setVim,
          vimDisplayLines: prefs.vimDisplayLines,
          setVimDisplayLines: (on) => on !== prefs.vimDisplayLines && toggleVimDisplayLines(),
          shortcutTips: !tipsState().off,
          setShortcutTips: (on) => store.set("shortcutTips", { ...tipsState(), off: !on }),
          localVault,
          sidebarPinned: prefs.sidebarPinned,
          setSidebarPinned,
          gamified: { on: gamified(), canChange: owner },
          setGamified: (on) =>
            void setGamified(on).then(
              () => (m.refreshSettings(), toast({ icon: "check", text: on ? "Unlock as you go is on" : "Everything is unlocked", detail: "For everyone in this workspace, from their next visit." })),
              (e) => toast({ text: e instanceof Error ? e.message : "That didn't work" }),
            ),
          shortcuts: () => toggleShortcuts(commands(), { vim: prefs.vim }),
          connectAgent,
          billing: billingState,
          subscribe: (interval) => void toStripe(() => api.checkout(interval)),
          manageBilling: () => void toStripe(api.billingPortal),
          deleteAccount: signedIn
            ? () => void import("./deleteAccount.ts").then((d) => d.showDeleteAccount(signedIn!, (t) => toast(t), () => exportZip({ all: true })))
            : null,
        }),
      { query },
    ),
  );
  // Online, the Plan section shows once the plan has loaded.
  if (!local) {
    void api.billing().then(
      (b) => {
        billingState = b;
        void import("./settings.ts").then((m) => m.refreshSettings());
      },
      () => {},
    );
  }
}

/** Online, on load: back from Stripe, or a plan that needs you (a failed payment, or ended). */
async function billingNotice() {
  const back = new URLSearchParams(location.search).get("billing");
  if (back) history.replaceState(history.state, "", location.pathname + location.hash);
  const b = await api.billing().catch(() => null);
  if (!b?.on) return;
  billingState = b;
  const { planText } = await import("./settings.ts");
  if (back === "done") toast({ icon: "check", text: "Thanks for subscribing", detail: planText(b) });
  else if (b.plan.status === "past_due" || b.plan.status === "lapsed") toast({ text: b.plan.status === "lapsed" ? "Your plan has ended" : "Your last payment didn't go through", detail: `${planText(b)} Settings, under Plan.` });
}

/** Online: your plan (cloud/src/billing.ts), as last loaded. */
let billingState: Billing | null = null;

/** Off to Stripe's Checkout or Customer Portal, which bring you back here after. */
async function toStripe(page: () => Promise<{ url: string }>) {
  try {
    location.assign((await page()).url);
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : "Couldn't reach billing" });
  }
}

/** Keep an optional sidebar item showing even before it's in use (Settings, Sidebar), or let it wait again. */
function setSidebarPinned(item: OptionalItem, on: boolean) {
  prefs.sidebarPinned = { ...prefs.sidebarPinned, [item]: on };
  store.set("sidebarPinned", prefs.sidebarPinned);
  renderTree();
}

const connectAgent = () => void import("./agentsPage.ts").then((m) => m.showAgents());

/** Shortcut tips (shortcutTips.ts): the third click on a button with a shortcut says, once, which keys do it. */
const tipsState = (): TipsState => ({ ...NO_TIPS, ...store.get<Partial<TipsState>>("shortcutTips", {}) });
function setupShortcutTips() {
  watchTips({
    // Not gamified: tips are off, whatever this browser says (and it keeps what it said for if they're back).
    load: () => (gamified() ? tipsState() : { ...tipsState(), off: true }),
    save: (s) => store.set("shortcutTips", s),
    // The palette's box is always there, hidden with it; a dialog that's showing isn't inside anything hidden.
    busy: () => [...document.querySelectorAll('[aria-modal="true"], .qa-float')].some((n) => !n.closest("[hidden]")),
    show: (tip) => toast({ icon: "keyboard", text: tipText(tip), actionLabel: "Show all shortcuts", action: () => toggleShortcuts(commands(), { vim: prefs.vim }) }),
  });
}

// ------------------------------------------------------------------ split view

/** The divider, the drop zones, the split button, and focus following clicks into a pane. */
function setupPanes() {
  const stage = $("#stage");
  const divider = $("#pane-divider");
  /** The side pane's share of the stage with the divider at (x, y), for where it's docked. */
  const shareAt = (x: number, y: number) => {
    const r = stage.getBoundingClientRect();
    return { right: (r.right - x) / r.width, left: (x - r.left) / r.width, top: (y - r.top) / r.height, bottom: (r.bottom - y) / r.height }[layout.at];
  };
  const resize = (x: number, y: number) => {
    layout.side = clampSide(shareAt(x, y));
    stage.style.setProperty("--side", `${layout.side * 100}%`);
    for (const p of panes) p.view.requestMeasure();
  };
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
    const move = (ev: PointerEvent) => resize(ev.clientX, ev.clientY);
    const up = () => {
      divider.removeEventListener("pointermove", move);
      document.body.classList.remove("is-resizing");
      saveLayout();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up, { once: true });
  });
  divider.addEventListener("keydown", (e) => {
    // The arrow toward the main pane grows the side pane.
    const grow = { right: "ArrowLeft", left: "ArrowRight", top: "ArrowDown", bottom: "ArrowUp" }[layout.at];
    const shrink = { right: "ArrowRight", left: "ArrowLeft", top: "ArrowUp", bottom: "ArrowDown" }[layout.at];
    const by = e.key === grow ? 0.05 : e.key === shrink ? -0.05 : 0;
    if (!by) return;
    e.preventDefault();
    layout.side = clampSide(layout.side + by);
    stage.style.setProperty("--side", `${layout.side * 100}%`);
    for (const p of panes) p.view.requestMeasure();
    saveLayout();
  });

  // Drag onto the notes to show something there. A note (a sidebar row, a Notes card, a task) or a
  // link (in a note, a board's link card) opens in a split: on the left or right half beside, near
  // the top or bottom edge above or below (see dropDock); once split, in the pane it's dropped on. A
  // page from the sidebar (Notes, Today, a folder, a tag, a smart folder) shows in the main pane,
  // where pages show: dropped on an edge beside a note, it takes that edge and the note moves to the
  // side pane across from it; dropped on the side pane, the panes swap places so it shows where it
  // was dropped. The zone outlines where it'll go. Inside a board, its columns take the drag first.
  const zone = $("#side-drop");
  type Box = { x: number; y: number; w: number; h: number };
  type Drop = { pane: Pane; at?: Dock; swap?: boolean; label: string; box: Box };
  const opposite = { right: "left", left: "right", top: "bottom", bottom: "top" } as const;
  const where = { right: "on the right", left: "on the left", top: "above", bottom: "below" } as const;
  const dropAt = (x: number, y: number, page?: string): Drop | null => {
    if (phone.matches) return null;
    const r = stage.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const here = page ? `Show ${page} here` : "Open here";
    if (split) {
      const s = $("#side-pane").getBoundingClientRect();
      const side = { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height };
      if (x >= s.left && x <= s.right && y >= s.top && y <= s.bottom) return page ? { pane: panes[0], swap: true, label: here, box: side } : { pane: panes[1], label: here, box: side };
      const main = {
        right: { x: 0, y: 0, w: side.x, h: r.height },
        left: { x: side.x + side.w, y: 0, w: r.width - side.x - side.w, h: r.height },
        top: { x: 0, y: side.y + side.h, w: r.width, h: r.height - side.y - side.h },
        bottom: { x: 0, y: 0, w: r.width, h: side.y },
      }[layout.at];
      return { pane: panes[0], label: here, box: main };
    }
    // A page over a page takes its place: two pages don't show at once.
    if (page && (onPage() || !panes[0].session)) return { pane: panes[0], label: `Show ${page}`, box: { x: 0, y: 0, w: r.width, h: r.height } };
    const at = dropDock((x - r.left) / r.width, (y - r.top) / r.height);
    // What's dropped gets the side pane's share of the window, or the main pane's for a page.
    const s = page ? 1 - layout.side : layout.side;
    const box = {
      right: { x: r.width * (1 - s), y: 0, w: r.width * s, h: r.height },
      left: { x: 0, y: 0, w: r.width * s, h: r.height },
      top: { x: 0, y: 0, w: r.width, h: r.height * s },
      bottom: { x: 0, y: r.height * (1 - s), w: r.width, h: r.height * s },
    }[at];
    if (page) return { pane: panes[0], at: opposite[at], label: `Show ${page} ${where[at]}`, box };
    return { pane: panes[1], at, label: `Open ${where[at]}`, box };
  };
  const show = (d: Drop | null) => {
    zone.hidden = !d;
    if (!d) return;
    const pad = 8;
    Object.assign(zone.style, { left: `${d.box.x + pad}px`, top: `${d.box.y + pad}px`, width: `${Math.max(0, d.box.w - 2 * pad)}px`, height: `${Math.max(0, d.box.h - 2 * pad)}px` });
    zone.lastChild!.textContent = d.label;
  };
  /** Open the drop's note where it says, splitting on its edge first. */
  const land = (d: Drop, open: (pane: Pane) => void) => {
    if (d.at) dockAt(d.at);
    open(d.pane);
  };
  /** Show a dropped page in the main pane, moving the panes or the note there out of its way first. */
  const landPage = async (d: Drop, open: () => unknown) => {
    const note = panes[0].session?.path;
    if (d.swap) {
      layout.at = opposite[layout.at];
      setSplit(true);
      saveLayout();
    }
    await open();
    if (d.at && note) {
      dockAt(d.at);
      await openNote(note, { pane: panes[1] });
    }
  };
  /** The page being dragged, if it's a page (and from this window). */
  const pageIn = (e: DragEvent) => (e.dataTransfer?.types.includes(PAGE_DRAG) ? draggedPage() : null);
  const dragging = (e: DragEvent) => !!pageIn(e) || !!e.dataTransfer?.types.some((t) => t === NOTE_DRAG || t === LINK_DRAG);
  /** A tab dropped where it is already (its own pane, not an edge) goes nowhere. */
  const tabStays = (d: Drop | null) => !!d && !!tabDrag && pageOf(tabDrag.entry) === null && !d.at && d.pane === tabDrag.pane;
  stage.addEventListener("dragover", (e) => {
    let d = dragging(e) ? dropAt(e.clientX, e.clientY, pageIn(e)?.label) : null;
    if (tabStays(d)) d = null;
    else if (d && tabDrag && pageOf(tabDrag.entry) === null) d = { ...d, label: d.at ? `Move ${{ right: "to the right", left: "to the left", top: "above", bottom: "below" }[d.at]}` : "Move here" };
    show(d);
    unmarkStrips();
    if (d) e.preventDefault();
  });
  stage.addEventListener("dragleave", (e) => !stage.contains(e.relatedTarget as Node) && (zone.hidden = true));
  stage.addEventListener("drop", (e) => {
    const page = pageIn(e);
    const d = !zone.hidden && dragging(e) ? dropAt(e.clientX, e.clientY, page?.label) : null;
    zone.hidden = true;
    if (!d) return;
    if (page) {
      e.preventDefault();
      return void landPage(d, page.open);
    }
    // A note's tab moves, with its back and forward: to the other pane, or to an edge to split.
    const drag = tabDrag;
    if (drag && pageOf(drag.entry) === null) {
      e.preventDefault();
      const stays = tabStays(d);
      tabDrag = null;
      if (!stays) land(d, (pane) => void moveTabTo(drag.pane, drag.index, pane));
      return;
    }
    const link = e.dataTransfer!.getData(LINK_DRAG);
    const path = e.dataTransfer!.getData(NOTE_DRAG);
    if (link) {
      e.preventDefault();
      const { target, from } = JSON.parse(link) as { target: string; from: string };
      return land(d, (pane) => void openTarget(target, from, pane));
    }
    if (!path || notes.find((n) => n.path === path)?.kind === "asset") return;
    e.preventDefault();
    land(d, (pane) => void openNote(path, { pane }));
  });
  document.addEventListener("dragend", () => (zone.hidden = true));
  // A [[link]] dragged in the editor (a pointer drag, see dragLink in editor/setup.ts).
  window.addEventListener(LINK_DRAG, (ev) => {
    const l = (ev as CustomEvent<LinkDrag>).detail;
    // Over a tab strip: a new tab there.
    const strip = stripAt(l.x, l.y);
    unmarkStrips(strip?.node);
    if (strip) {
      show(null);
      strip.mark(l.phase === "drop" ? null : strip.before(l.x));
      if (l.phase === "drop") void openTarget(l.target, l.from, strip.pane, true, strip.before(l.x));
      return;
    }
    const d = dropAt(l.x, l.y);
    show(l.phase === "drop" ? null : d);
    if (l.phase === "drop" && d) land(d, (pane) => void openTarget(l.target, l.from, pane));
  });

  $("#split-btn").addEventListener("click", () => void (split ? closePane(panes[1]) : openSplit()));
  // Clicking or tabbing into a pane gives it the focus.
  // (Not from a pane bar's buttons: redrawing the bar on mousedown would swallow their click.)
  const follow = (p: Pane) => (e: Event) => p !== active && split && !(e.target as Element).closest?.(".pane-bar button") && focusPane(p);
  for (const [p, nodes] of [[panes[0], ["#editor-host", "#html-preview", "#main-bar", "#notes-view", "#today-view", "#tasks-view", "#calendar-view", "#contacts-view", "#history-view", "#assets-view", "#tags-view", "#replace-view", "#query-help-view"]], [panes[1], ["#side-pane"]]] as const) {
    for (const sel of nodes) {
      $(sel).addEventListener("focusin", follow(p));
      $(sel).addEventListener("mousedown", follow(p));
    }
  }
  // Leaving an editor renames its note after a heading you changed there (see retitle).
  for (const p of panes) p.view.contentDOM.addEventListener("blur", () => p.session && void retitle(p.session));
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
/** A local vault: just you, so there's no one to share a smart folder with. */
let local = true;
/** You can view this workspace but not edit it: you keep smart folders of your own but can't change shared ones. */
let viewer = false;
/** May delete for good (Trash's Delete forever and Empty trash): workspace owners online, and always locally. */
let owner = true;

/**
 * Show whatever the address bar points at: /notes/<title>-<id>, /today, /tasks, /calendar (or one event,
 * /calendar/<id>), /history, /assets, or the notes list (/notes, /). Links from before paths (#/Projects/Plan.md, #tasks) still work and get rewritten.
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
  if (at === "/today") return showToday({ push: false });
  if (at === "/assets") return showAssets({ push: false });
  if (at === "/contacts") {
    const id = new URLSearchParams(location.search).get("c");
    return showContacts({ contact: id && NOTE_ID.test(id) ? id : null, push: false });
  }
  const event = calendarTarget(at);
  if (event !== null) return showCalendar({ event: event || undefined, push: false });
  if (at === "/shared") return showShared({ push: false });
  if (at === "/capture") return showCapture();
  // Notes, narrowed to what ?q= says (a folder, a tag, a smart folder's query), or everything.
  if (at === "/notes" && new URLSearchParams(location.search).get("scope") !== "archived") return showNotes({ tab: "notes", query: parseQuery(new URLSearchParams(location.search).get("q") ?? ""), push: false });
  // Archive and Trash are tabs of Notes. `?scope=archived` is how an address could once ask Notes for its archived notes.
  const tab = at === "/archive" || (at === "/notes" && new URLSearchParams(location.search).get("scope") === "archived") ? "archive" : at === "/trash" ? "trash" : null;
  if (tab) {
    if (at !== `/${tab}`) setUrl(`/${tab}`, "replace");
    return showNotes({ tab, push: false });
  }
  if (at === "/tags") return showTags({ push: false });
  if (at === "/query-help") return showQueryHelp({ push: false });
  if (at === "/checkup") return showCheckup({ push: false });
  if (at === "/replace") return showReplace({ push: false });
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
  return showNotes({ tab: "notes", push: false });
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
  // A shared note (a link, or one shared with you) is its own page, without the workspace around it.
  const shared = sharedRoute();
  if (shared) return mountSharedView(shared);
  registerWorker(); // installable, and the share target (web/public/sw.js)
  // Read before the workspace is picked: picking one tidies the address, this included.
  const fromGoogle = new URLSearchParams(location.search).get("google");
  const fromDrive = new URLSearchParams(location.search).get("drive");
  const driveAs = new URLSearchParams(location.search).get("as");
  // Online, the note API is per workspace and needs a signed-in person; locally it's just /api.
  const who = await whoAmI();
  // Where developer sign-in is on (local `cloud:dev`, and Previews) there's nothing to choose: go straight in.
  if (who && !who.me && who.devLogin) return location.assign(`/auth/dev?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (who && !who.me) return showSignIn();
  if (who?.me) {
    const ws = pickWorkspace(who.me);
    workspaceId = ws.id;
    local = false;
    viewer = ws.role === "viewer";
    setCalendarContext({ canEdit: !viewer, workspace: ws.id });
    void googleStatus().catch(() => null); // the palette's Connect Google Calendar
    owner = ws.role === "owner";
    useWorkspace(`/api/w/${ws.id}`, `/api/w/${ws.id}/live`);
    setSelfName(who.me.user.name);
    api.reportTimeZone().catch(() => {}); // unreported, agents use the owner's zone, or UTC
    $("#settings-btn").remove(); // the account menu has Settings
    account = renderAccount(who.me, ws, (t) => toast(t), () => openSettings());
    signedIn = who.me.user;
    $("#shared-btn").hidden = false;
    setShareWithPeople({ label: "Share with people…", icon: "share-people", run: (note) => openShareDialog({ path: note.path }) });
    setSaveToDrive({ label: "Save to Google Drive…", icon: "drive", run: (note) => void saveNoteToDrive(note) });
    void refreshShares();
    void api.sharedWithMe().then((g) => ($("#shared-count").textContent = String(g.reduce((n, x) => n + x.notes.length, 0) || "")), () => {});
    void billingNotice();
  }

  hydrateIcons();
  setupMobileNav();
  void learnLayout();
  window.addEventListener("focus", () => void learnLayout()); // the layout may have changed while away
  togglePanel(prefs.panel);
  $("#search-btn").addEventListener("click", () => openPalette());
  // A new note goes at the top level, unless Notes is showing a folder: then it goes there.
  $("#new-note").addEventListener("click", () => void newNote(onPage() === "notes" ? (notesPage.query.folder ?? "") : ""));
  $("#new-from-template").addEventListener("click", () => void newFromTemplate(undefined, onPage() === "notes" ? (notesPage.query.folder ?? "") : ""));
  $("#panel-btn").addEventListener("click", () => togglePanel());
  setLabel($("#panel-btn"), `Toggle info panel (${formatKeys("Mod-\\")})`);
  setupPanes();
  $("#stage").addEventListener("mousedown", () => document.body.classList.remove("panel-overlay"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  // The skip link lands on what the main area shows: the page that's open, or the note's text.
  $("#skip-link").addEventListener("click", (e) => {
    const page = document.querySelector<HTMLElement>('#stage > [id$="-view"]:not([hidden])');
    if (!page && !active.session) return; // nothing open: the link's own #stage will do
    e.preventDefault();
    if (page) page.focus();
    else active.view.focus();
  });
  renderCodeWrap();
  $("#codewrap-toggle").addEventListener("click", () => setCodeWrap(!codeWrapByDefault()));
  // Settings sits under you at the foot of the sidebar: online in the account menu, locally (no account) as its own row.
  if (local) {
    const settings = $("#settings-btn");
    settings.hidden = false;
    settings.querySelector("kbd")!.textContent = formatKeys("Mod-,");
    settings.addEventListener("click", () => openSettings());
  }
  setupShortcutTips();
  attachVim(); // the toggle's label, before any note opens
  $("#html-toggle").addEventListener("click", (e) => {
    const mode = (e.target as HTMLElement).closest("button")?.dataset.mode as "preview" | "source" | undefined;
    if (mode) setHtmlMode(mode);
  });
  renderTheme();
  systemDark.addEventListener("change", () => theme() === "system" && renderTheme());
  window.addEventListener("popstate", (e) => void onPopState(e));
  // Each page in the sidebar can be dragged onto the notes, to show it there (see setupPanes).
  for (const [id, label, open] of [
    ["#today-btn", "Today", () => showToday()],
    ["#notes-btn", "Notes", () => showNotes({ tab: "notes", query: {} })],
    ["#tasks-btn", "Tasks", () => showTasks()],
    ["#calendar-btn", "Calendar", () => showCalendar()],
    ["#contacts-btn", "Contacts", () => showContacts()],
    ["#history-btn", "History", () => showHistory()],
    ["#assets-btn", "Assets", () => showAssets()],
    ["#shared-btn", "Shared with me", () => showShared()],
  ] as const)
    dragsPage($(id), label, open);
  // ⌘-click or a middle-click on a page in the sidebar (Notes, Today, a folder, a tag…) opens it in
  // a new tab, and a right-click offers to.
  onPageClick((label, open, e) => {
    if (e.type === "contextmenu" && (e.target as Element).closest(".tree-row")) return false; // a row's own menu has Open in new tab
    if (e.type === "contextmenu") {
      openMenu({ x: e.clientX, y: e.clientY }, [
        { label: "Open", icon: "file", run: open },
        { label: "Open in new tab", icon: "plus", keys: "Mod-click", run: () => openPageInTab(open) },
      ], { label });
      return true;
    }
    if (clickWhere(e) === "here") return false;
    void openPageInTab(open);
    return true;
  });
  $("#notes-btn").addEventListener("click", () => void showNotes({ tab: "notes", query: {} }));
  $("#today-btn").addEventListener("click", () => void showToday());
  $("#tasks-btn").addEventListener("click", () => void showTasks());
  $("#calendar-btn").addEventListener("click", () => void showCalendar());
  window.addEventListener(OPEN_CALENDAR, (e) => void showCalendar({ event: (e as CustomEvent<string>).detail || undefined }));
  $("#contacts-btn").addEventListener("click", () => void showContacts());
  $("#history-btn").addEventListener("click", () => void showHistory());
  $("#assets-btn").addEventListener("click", () => void showAssets());
  $("#tags-page-btn").addEventListener("click", () => void showTags());
  // The "?" beside a query box (see queryHelp.ts).
  window.addEventListener(QUERY_HELP, () => void showQueryHelp());
  $("#new-smart-folder").addEventListener("click", () => newSmartFolder($("#new-smart-folder")));
  setupSections();
  $("#note-history-btn").addEventListener("click", () => active.session && void showHistory({ note: active.session.path }));
  $("#top-tabs").before(topArrows.el);
  $("#archive-btn").addEventListener("click", () => void archiveCurrent());
  $("#delete-btn").addEventListener("click", () => void deleteCurrent());
  $("#shared-btn").addEventListener("click", () => void showShared());
  $("#star-btn").addEventListener("click", () => active.session && void toggleStar(active.session.path));
  $("#move-btn").addEventListener("click", () => openMovePicker($("#move-btn")));
  $("#share-btn").addEventListener("click", openShare);
  $("#focus-btn").addEventListener("click", () => void setFocusMode(!focusMode));
  setLabel($("#focus-btn"), `Focus mode (${formatKeys("Mod-Shift-Enter")})`); // ⌘⇧↵ in the markup is a Mac's
  $("#new-folder").addEventListener("click", () => startNewFolder());
  $("#new-tag").addEventListener("click", () => startNewTag());
  $("#new-tag").hidden = viewer;
  dropTarget($("#tree"), () => "");
  favoriteDrop($("#favorites"), "is-drop");
  document.addEventListener("dragend", endDrag); // a drag that lands nowhere still clears its highlights
  vaultEvents.addEventListener("change", () => refreshTaskCountSoon());
  window.addEventListener("beforeunload", (e) => {
    void flushSave();
    // A save that couldn't reach the server won't now either: ask before the text is lost.
    if (panes.some((p) => p.session?.failed && p.view.state.doc.toString() !== p.session.base)) e.preventDefault();
  });
  watchTimers((t) =>
    toast({
      icon: "timer",
      text: `${t.label || "Timer"} is done`,
      detail: t.note ? displayName(t.note) : undefined,
      open: t.note && t.note !== active.session?.path ? () => void openNote(t.note!) : undefined,
      alert: true,
    }),
  );
  setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-ts]").forEach((n) => (n.textContent = timeAgo(Number(n.dataset.ts))));
    renderPresence();
  }, 30_000);

  const [info, list, starred, recent, tagList, smart] = await Promise.all([api.info(), api.notes(), api.favorites(), api.changes(), api.tags(), api.smartFolders(), loadGamified()]);
  onGamified(() => renderTree()); // an owner flipped it here: the sidebar shows everything, or waits again
  onGamified(() => !$("#today-view").hidden && void showToday({ push: false })); // the Today page gains or drops its week card
  $("#vault-name").textContent = info.name;
  if (info.mode === "local") localVault = info;
  notes = list;
  favorites = starred;
  tags = tagList;
  smartFolders = smart;
  changes = recent;
  void learnCalendars();
  renderActivity();
  renderPresence();
  connect(onMessage, (up) => {
    setOnline(up);
    if (up) {
      refreshNotesSoon();
      void flushSave(); // what couldn't be saved while the connection was down
    }
  });
  if (!viewer) void startGuide({ archive: (path) => void archivePath(path), flush: () => flushSave() });
  if (!viewer) watchTodayCleared();
  if (!viewer) startAway({ seeChanges: (after) => void showHistory({ since: after }), workspace: () => workspaceId });
  watchTodayRing($("#today-btn")); // fills as today's tasks are ticked
  startInks({ choose: () => openSettings("ink") });

  void refreshTaskCount();
  // Tabs and the split as you left them (a layout kept before tabs had their own back and forward
  // becomes a tab per pane, with the tabs each pane had: see parseLayout). The address bar's note
  // or page shows, in a new tab if it isn't one of them; the app's bare address, the tab you were on.
  layout = parseLayout(JSON.stringify(store.get(layoutKey(), null)), store.get(`tabs:${workspaceId || "local"}`, null));
  for (const p of panes) p.group = pruneGroup(layout.groups[p.index]);
  const beside = layout.split ? tabNote(currentTab(panes[1].group)?.note ?? null) : undefined;
  if (beside) await openNote(beside.path, { pane: panes[1], focus: false, trail: false });
  const home = (location.pathname === "/" || location.pathname === "") && !location.hash && !!currentTab(panes[0].group);
  if (beside && parseNotePath(location.pathname)?.id === beside.id) {
    // The address bar names the side pane's note: the main pane gets back what it had.
    const spot = spotOf(location.hash);
    if (currentTab(panes[0].group)) await showCurrent(panes[0]);
    else await showNotes({ push: false });
    focusPane(panes[1]);
    if (spot.line || spot.heading) await openNote(beside.path, { pane: panes[1], ...spot });
  } else if (home) await showCurrent(panes[0]);
  else {
    openNext = {};
    await route();
    openNext = null;
  }
  if (fromGoogle) await backFromGoogle(fromGoogle);
  if (fromDrive && !local) await backFromDrive(fromDrive, driveAs);
}

boot();

(window as any).commonink = { panes }; // handy in devtools
