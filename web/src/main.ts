import "./styles.css";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { api, clientId, connect, fileUrl, isArchived, useWorkspace, whoAmI, ApiError, type Change, type NoteMeta, type Scope, type ServerMsg } from "./api.ts";
import { $, avatar, displayName, el, hueFor, hydrateIcons, icon, isSelf, setSelfName, timeAgo } from "./dom.ts";
import { createState, linkTargetAt, remote, vimSlot } from "./editor/setup.ts";
import { bumpEmbeds, editorContext } from "./editor/blocks.ts";
import { clearFlash, flashChanges } from "./editor/agentFlash.ts";
import { editsBetween, merge3 } from "./merge.ts";
import { sandboxFrame } from "./render.ts";
import { Palette } from "./palette.ts";
import { Feed } from "./feed.ts";
import { pickWorkspace, renderAccount, showSignIn } from "./account.ts";
import { vaultEvents } from "./events.ts";
import { groupChanges } from "../../src/core/format.ts";
import { watchTimers } from "./widgets/timer.ts";

// ------------------------------------------------------------------ state

interface Session {
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

const prefs = {
  vim: store.get("vim", true),
  panel: store.get("panel", true),
  htmlMode: store.get<"preview" | "source">("htmlMode", "preview"),
  collapsed: new Set<string>(store.get<string[]>("collapsed", [])),
};

let notes: NoteMeta[] = [];
let changes: Change[] = [];
let session: Session | null = null;

const view = new EditorView({ parent: $("#editor-host") });
const feed = new Feed({
  open: (path, line) => void openNote(path, { line }),
  toast: (t) => toast(t),
  changed: () => {
    api.clearResolveCache();
    void refreshNotes();
  },
});
const palette = new Palette(
  () => notes,
  (path, line) => openNote(path, { line }),
  (name) => createNote(name),
);

// ------------------------------------------------------------------ opening notes

const cursors = new Map<string, number>();

async function openNote(path: string, opts: { line?: number; heading?: string; push?: boolean } = {}) {
  await flushSave();
  if (session) await nameUntitled(session);
  if (session && session.kind !== "asset") cursors.set(session.path, view.state.selection.main.head);
  const meta = notes.find((n) => n.path === path);
  if (meta?.kind === "asset") return showAsset(meta, opts.push);

  let note;
  try {
    note = await api.note(path);
  } catch {
    return toast({ text: `Couldn't open ${path}` });
  }
  hideBanner();
  const next: Session = {
    path: note.path,
    kind: note.kind,
    title: note.title,
    base: note.content,
    baseVersion: note.version,
    saving: false,
    again: false,
    timer: 0,
    edited: false,
  };
  // Build the editor before switching sessions: if this throws, the old note stays open and
  // nothing can be saved into the wrong file.
  try {
    view.setState(
      createState({
        doc: note.content,
        kind: note.kind === "html" ? "html" : "md",
        vim: prefs.vim,
        context: { path: note.path, openTarget, createNote, notes: () => notes },
        onUpdate: (docChanged, fromRemote, state) => onUpdate(next, docChanged, fromRemote, state),
      }),
    );
  } catch (e) {
    console.error(e);
    return showBanner(`Couldn't open ${note.path} in the editor. Reload the page to try again.`);
  }
  session = next;
  resetVimJumps();
  if (isArchived(note.path)) {
    showBanner("This note is archived. It's hidden from search and the sidebar.", ["Unarchive", () => void archiveCurrent()]);
    $("#banner").classList.add("is-info");
  }
  attachVim();
  $("#editor-host").classList.toggle("is-code", note.kind === "html");
  showStage(note.kind === "html" && prefs.htmlMode === "preview" ? "html" : "editor");
  if (note.kind === "html") renderHtmlPreview();

  const line = opts.line ?? (opts.heading ? headingLine(opts.heading) : undefined);
  if (line) goToLine(line);
  else {
    // Start below the frontmatter so it renders as properties rather than raw YAML.
    const fm = note.kind === "md" ? note.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/) : null;
    const pos = Math.min(cursors.get(note.path) ?? (fm ? fm[0].length : 0), view.state.doc.length);
    view.dispatch({ selection: { anchor: pos } });
    view.scrollDOM.scrollTop = 0;
  }
  if (note.kind === "md" || prefs.htmlMode === "source") view.focus();

  if (opts.push !== false && decodeURIComponent(location.hash.slice(2)) !== note.path) {
    history.pushState(null, "", `#/${encodeURIComponent(note.path)}`);
  }
  store.set(lastKey(), note.path);
  document.title = `${note.title} · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
  renderStatus(view.state);
  refreshBacklinks();
}

function showAsset(meta: NoteMeta, push?: boolean) {
  session = { path: meta.path, kind: "asset", title: displayName(meta.path), base: "", baseVersion: meta.version, saving: false, again: false, timer: 0, edited: false };
  const src = fileUrl(meta.path);
  const media = /\.(mp4|webm)$/i.test(meta.path)
    ? el("video", { src, controls: true })
    : /\.pdf$/i.test(meta.path)
      ? el("a", { href: src, target: "_blank", class: "link-btn" }, "Open PDF")
      : el("img", { src, alt: meta.path });
  $("#asset-view").replaceChildren(el("figure", { class: "asset" }, media, el("figcaption", {}, meta.path)));
  showStage("asset");
  if (push !== false) history.pushState(null, "", `#/${encodeURIComponent(meta.path)}`);
  document.title = `${displayName(meta.path)} · Common Ink`;
  renderChrome();
  renderTree();
  renderOutline();
  refreshBacklinks();
}

function showStage(which: "editor" | "html" | "asset" | "feed") {
  $("#editor-host").hidden = which !== "editor";
  $("#html-preview").hidden = which !== "html";
  $("#asset-view").hidden = which !== "asset";
  $("#feed-view").hidden = which !== "feed";
}

/** The feed replaces the editor; no note is open while it's showing. */
async function showFeed(opts: { scope?: Scope; filter?: boolean; push?: boolean } = {}) {
  await flushSave();
  if (session) await nameUntitled(session);
  if (session && session.kind !== "asset") cursors.set(session.path, view.state.selection.main.head);
  session = null;
  hideBanner();
  showStage("feed");
  feed.show(opts);
  if (opts.push !== false && location.hash !== "#feed") history.pushState(null, "", "#feed");
  document.title = "Feed · Common Ink";
  renderChrome();
  renderTree();
  renderOutline();
  $("#backlink-count").textContent = "";
  $("#backlinks").replaceChildren(el("div", { class: "panel-empty" }, "—"));
}

/** Archive the open note (or unarchive it, if it's archived). Stays on the note, with Undo. */
async function archiveCurrent() {
  const s = session;
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
  history.replaceState(null, "", `#/${encodeURIComponent(to)}`);
  toast({
    icon: restore ? "unarchive" : "archive",
    text: `${restore ? "Unarchived" : "Archived"} ${displayName(to)}`,
    actionLabel: "Undo",
    action: async () => {
      const back = (await (restore ? api.archive([to]) : api.unarchive([to]))).moved[0].to;
      await refreshNotes();
      if (session?.path === to) {
        await openNote(back, { push: false });
        history.replaceState(null, "", `#/${encodeURIComponent(back)}`);
      }
    },
  });
}

async function openTarget(target: string, from?: string) {
  const [name, anchor] = target.split("#");
  const path = name ? await api.resolve(name, from) : session?.path;
  const line = anchor?.match(/^L(\d+)$/)?.[1]; // Note#L12 → line 12 (used by widgets)
  if (path) openNote(path, line ? { line: Number(line) } : { heading: anchor });
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
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const cm = getCM(view);
    if (cm && prefs.vim) Vim.handleKey(cm, "A", "user");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) openNote(e.data.path ?? path);
    else toast({ text: `Couldn't create ${path}` });
  }
}

/** New note button: create "Untitled" right away and put the cursor in its title. */
async function newNote() {
  const taken = new Set(notes.map((n) => n.path.toLowerCase()));
  let name = "Untitled";
  for (let i = 2; taken.has(`${name.toLowerCase()}.md`); i++) name = `Untitled ${i}`;
  try {
    const r = await api.create(`${name}.md`, "# \n");
    await refreshNotes();
    await openNote(r.path);
    view.dispatch({ selection: { anchor: view.state.doc.line(1).to } });
    view.focus();
    const cm = getCM(view);
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
  const title = view.state.doc.line(1).text.match(/^#\s+(.+?)\s*#*$/)?.[1]?.trim();
  const clean = title?.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean || UNTITLED.test(clean)) return;
  const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/") + 1) : "";
  let target = `${dir}${clean}.md`;
  for (let i = 2; notes.some((n) => n.path.toLowerCase() === target.toLowerCase()); i++) target = `${dir}${clean} ${i}.md`;
  renaming = s.path;
  try {
    const r = await api.move(s.path, target);
    view.state.facet(editorContext).path = r.path; // the open editor now belongs to the new path
    s.path = r.path;
    s.title = title!;
    if (s === session) {
      history.replaceState(null, "", `#/${encodeURIComponent(r.path)}`);
      store.set(lastKey(), r.path);
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

function headingLine(heading: string): number | undefined {
  const want = heading.trim().toLowerCase();
  const doc = view.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const m = doc.line(i).text.match(/^#{1,6}\s+(.*?)\s*#*$/);
    if (m && m[1].toLowerCase() === want) return i;
  }
}

function goToLine(line: number) {
  const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
  view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 80 }) });
}

// ------------------------------------------------------------------ saving & merging agent edits

function onUpdate(s: Session, docChanged: boolean, fromRemote: boolean, state: EditorState) {
  if (s !== session) return;
  if (docChanged && !fromRemote) {
    s.edited = true;
    scheduleSave();
  }
  renderStatusSoon(state);
  if (docChanged) renderOutlineSoon();
}

function scheduleSave(delay = 600) {
  const s = session;
  if (!s || s.kind === "asset") return;
  clearTimeout(s.timer);
  setSaveStatus("editing");
  s.timer = window.setTimeout(() => save(s), delay);
}

async function save(s: Session) {
  if (s !== session || !s.edited) return;
  if (view.state.facet(editorContext)?.path !== s.path) {
    console.error(`Refusing to save ${s.path}: the editor is showing a different note`);
    return setSaveStatus("error");
  }
  if (s.saving) return void (s.again = true);
  const content = view.state.doc.toString();
  if (content === s.base) return setSaveStatus("saved");
  s.saving = true;
  setSaveStatus("saving");
  try {
    const r = await api.save(s.path, content, s.baseVersion, content.trim() === "");
    s.base = content;
    s.baseVersion = r.version;
    if (s === session && view.state.doc.lineAt(view.state.selection.main.head).number > 1) void nameUntitled(s);
    if (s === session) setSaveStatus(view.state.doc.toString() === content ? "saved" : "editing");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      applyRemote({ path: s.path, content: e.data.content, version: e.data.version, source: e.data.source ?? "external" });
    } else {
      setSaveStatus("error");
    }
  } finally {
    s.saving = false;
    if (s.again) {
      s.again = false;
      save(s);
    }
  }
}

async function flushSave() {
  const s = session;
  if (!s || s.kind === "asset" || !s.edited) return;
  clearTimeout(s.timer);
  if (view.state.doc.toString() !== s.base) await save(s);
}

let flashTimer = 0;
/** A new version arrived from disk. Apply it as a diff (keeps cursor, undo, vim state); 3-way merge if we have unsaved typing. */
function applyRemote(m: { path: string; content: string | null; version: string; source: string }) {
  const s = session;
  if (!s || s.path !== m.path || m.content === null || s.kind === "asset") return;
  if (m.version === s.baseVersion) return;
  const doc = view.state.doc.toString();
  if (doc === m.content) {
    s.base = m.content;
    s.baseVersion = m.version;
    return setSaveStatus("saved");
  }
  let target = m.content;
  if (doc !== s.base) {
    const merged = merge3(s.base, doc, m.content);
    if (!merged.ok) return showConflict(m);
    target = merged.text;
  }
  const { changes: edits, touched } = editsBetween(doc, target);
  view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashChanges.of({ ranges: touched, source: m.source }) });
  s.base = m.content;
  s.baseVersion = m.version;
  if (target !== m.content) scheduleSave(250);
  else setSaveStatus("saved");
  if (s.kind === "html" && prefs.htmlMode === "preview") renderHtmlPreview();
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => view.dispatch({ effects: clearFlash.of(null) }), 6000);
}

function showConflict(m: { path: string; content: string | null; version: string; source: string }) {
  const s = session!;
  const who = m.source === "you" ? "Another window" : m.source === "external" ? "Another program" : m.source;
  clearTimeout(s.timer);
  setSaveStatus("error");
  showBanner(
    `${who} changed this note while you were typing, and the edits overlap.`,
    [
      "Keep mine",
      () => {
        s.base = m.content!;
        s.baseVersion = m.version;
        hideBanner();
        scheduleSave(0);
      },
    ],
    [
      "Use theirs",
      () => {
        const { changes: edits, touched } = editsBetween(view.state.doc.toString(), m.content!);
        view.dispatch({ changes: edits, annotations: remote.of(true), effects: flashChanges.of({ ranges: touched, source: m.source }) });
        s.base = m.content!;
        s.baseVersion = m.version;
        hideBanner();
        setSaveStatus("saved");
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
      if (m.origin === clientId) return;
      if (m.path === session?.path) applyRemote(m);
      else if (session?.kind === "md" && embedsPath(m.path)) bumpEmbeds(view);
      if (!isSelf(m.source) && m.change) {
        toast({
          source: m.source,
          text: `${verb(m.change)} ${displayName(m.path)}`,
          detail: m.change.summary ?? undefined,
          action: m.path === session?.path ? undefined : () => openNote(m.path),
        });
      }
      refreshNotesSoon();
      if (session && m.path !== session.path) refreshBacklinksSoon();
      return;
    }
    case "change": {
      if (!changes.some((c) => c.id === m.change.id)) changes = [m.change, ...changes].slice(0, 60);
      if (["move", "archive", "unarchive"].includes(m.change.op) && m.change.from_path === session?.path && m.change.from_path !== renaming) {
        openNote(m.change.path, { push: false });
      }
      feed.refreshSoon();
      renderActivity();
      renderPresence();
      renderTree();
      return;
    }
    case "removed": {
      const path = m.path;
      setTimeout(() => {
        if (session?.path === path && !notes.some((n) => n.path === path)) showBanner("This note was moved or deleted on disk.");
      }, 400);
      refreshNotesSoon();
      return;
    }
    case "tree":
      feed.refreshSoon();
      api.clearResolveCache();
      refreshNotesSoon();
      refreshBacklinksSoon();
      if (session?.kind === "md") bumpEmbeds(view);
      return;
  }
}

function embedsPath(path: string): boolean {
  const name = displayName(path).toLowerCase();
  const text = view.state.doc.toString().toLowerCase();
  return text.includes(`![[${name}`) || text.includes(`![[${path.toLowerCase()}`) || text.includes(`![[${path.toLowerCase().replace(/\.md$/, "")}`);
}

async function refreshNotes() {
  notes = await api.notes();
  renderTree();
}
const refreshNotesSoon = debounce(refreshNotes, 120);

// ------------------------------------------------------------------ sidebar tree

interface Dir {
  dirs: Map<string, Dir>;
  files: NoteMeta[];
}

function recentAgentEdits(): Map<string, string> {
  const since = Date.now() - 15 * 60_000;
  const out = new Map<string, string>();
  for (const c of changes) if (c.ts > since && !isSelf(c.source) && !out.has(c.path)) out.set(c.path, c.source);
  return out;
}

function renderTree() {
  const root: Dir = { dirs: new Map(), files: [] };
  const archivedCount = notes.filter((n) => isArchived(n.path) && n.kind !== "asset").length;
  $("#archive-count").textContent = archivedCount ? String(archivedCount) : "";
  $("#feed-btn").classList.toggle("is-active", feed.visible);
  for (const n of notes) {
    if (isArchived(n.path)) continue;
    const parts = n.path.split("/");
    let d = root;
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { dirs: new Map(), files: [] });
      d = d.dirs.get(p)!;
    }
    d.files.push(n);
  }
  const agents = recentAgentEdits();
  const walk = (d: Dir, prefix: string, depth: number): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const [name, sub] of [...d.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const path = prefix + name;
      const collapsed = prefs.collapsed.has(path);
      out.push(
        el(
          "div",
          {
            class: `tree-row is-dir${collapsed ? " is-collapsed" : ""}`,
            style: { "--depth": String(depth) },
            onclick: () => {
              if (collapsed) prefs.collapsed.delete(path);
              else prefs.collapsed.add(path);
              store.set("collapsed", [...prefs.collapsed]);
              renderTree();
            },
          },
          el("span", { class: "chev" }, icon("chevron", 13)),
          el("span", { class: "tree-name" }, name),
        ),
      );
      if (!collapsed) out.push(...walk(sub, `${path}/`, depth + 1));
    }
    for (const f of d.files.sort((a, b) => a.path.localeCompare(b.path))) {
      const agent = agents.get(f.path);
      out.push(
        el(
          "div",
          {
            class: `tree-row is-file${f.path === session?.path ? " is-active" : ""}`,
            style: { "--depth": String(depth) },
            title: f.path,
            onclick: () => openNote(f.path),
          },
          icon(f.kind === "html" ? "html" : f.kind === "asset" ? "image" : "file", 14),
          el("span", { class: "tree-name" }, displayName(f.path)),
          agent ? el("span", { class: "agent-dot", title: `Edited by ${agent}`, style: { "--hue": String(hueFor(agent)) } }) : null,
        ),
      );
    }
    return out;
  };
  $("#tree").replaceChildren(...walk(root, "", 0));
}

// ------------------------------------------------------------------ chrome: crumbs, status, panel

function renderChrome() {
  const s = session;
  const crumbs = $("#crumbs");
  $("#archive-btn").hidden = !s;
  $("#save-status").hidden = !s;
  if (!s) {
    $("#html-toggle").hidden = true;
    return crumbs.replaceChildren(...(feed.visible ? [el("span", { class: "crumb-file" }, "Feed")] : []));
  }
  const archived = isArchived(s.path);
  $("#archive-btn").title = archived ? "Unarchive note (⌘⇧E)" : "Archive note (⌘⇧E)";
  $("#archive-btn").replaceChildren(icon(archived ? "unarchive" : "archive", 16));
  const parts = s.path.split("/");
  const file = parts.pop()!;
  const name = el("span", { class: "crumb-file", title: "Click to rename" }, file.replace(/\.(md|markdown)$/i, ""));
  name.addEventListener("click", () => startRename(name));
  crumbs.replaceChildren(...parts.flatMap((p) => [el("span", { class: "crumb" }, p), el("span", { class: "crumb-sep" }, "/")]), name);
  $("#html-toggle").hidden = s.kind !== "html";
  $("#html-toggle").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === prefs.htmlMode));
  setSaveStatus("saved");
}

function startRename(label: HTMLElement) {
  const s = session;
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
        history.replaceState(null, "", `#/${encodeURIComponent(r.path)}`);
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
  const words = session?.kind === "md" ? (state.doc.toString().match(/[\p{L}\p{N}’']+/gu)?.length ?? 0) : 0;
  $("#word-count").textContent = session?.kind === "md" ? `${words.toLocaleString()} words` : "";
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

function attachVim() {
  const cm = getCM(view);
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
  set("normal");
  cm.on("vim-mode-change", (e: { mode: string; subMode?: string }) => set(e.mode, e.subMode));
}

// outline
let outlineHeadings: Array<{ level: number; text: string; line: number }> = [];
function renderOutline() {
  const box = $("#outline");
  outlineHeadings = [];
  if (session?.kind === "md") {
    let fence = false;
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const t = doc.line(i).text;
      if (/^\s*(```|~~~)/.test(t)) fence = !fence;
      const m = !fence && t.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (m) outlineHeadings.push({ level: m[1].length, text: m[2].replace(/[*_`~]|\[\[|\]\]/g, ""), line: i });
    }
  }
  const min = Math.min(...outlineHeadings.map((h) => h.level));
  box.replaceChildren(
    ...(outlineHeadings.length
      ? outlineHeadings.map((h) =>
          el(
            "div",
            { class: "outline-item", style: { "--depth": String(h.level - min) }, "data-line": String(h.line), onclick: () => (goToLine(h.line), view.focus()) },
            h.text,
          ),
        )
      : [el("div", { class: "panel-empty" }, session?.kind === "md" ? "No headings" : "—")]),
  );
  highlightOutline(view.state.doc.lineAt(view.state.selection.main.head).number);
}
const renderOutlineSoon = debounce(renderOutline, 250);
function highlightOutline(line: number) {
  let current = -1;
  for (const h of outlineHeadings) if (h.line <= line) current = h.line;
  $("#outline").querySelectorAll<HTMLElement>(".outline-item").forEach((n) => n.classList.toggle("is-current", Number(n.dataset.line) === current));
}

// backlinks
async function refreshBacklinks() {
  const s = session;
  if (!s) return;
  const links = await api.backlinks(s.path).catch(() => []);
  if (s !== session) return;
  $("#backlink-count").textContent = links.length ? String(links.length) : "";
  $("#backlinks").replaceChildren(
    ...(links.length
      ? links.map((b) =>
          el(
            "div",
            { class: "backlink", onclick: () => openNote(b.path, { line: b.line }) },
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
            { class: "act" },
            avatar(c.source, 22),
            el(
              "div",
              { class: "act-body" },
              el(
                "div",
                { class: "act-line" },
                el("b", {}, c.source),
                ` ${verb(c)} `,
                el("a", { onclick: () => openNote(c.path) }, displayName(c.path)),
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

function renderHtmlPreview() {
  if (session?.kind !== "html") return;
  const frame = sandboxFrame(view.state.doc.toString(), { title: session.title });
  frame.className = "html-frame";
  $("#html-preview").replaceChildren(frame);
}

function setHtmlMode(mode: "preview" | "source") {
  prefs.htmlMode = mode;
  store.set("htmlMode", mode);
  if (session?.kind !== "html") return;
  if (mode === "preview") renderHtmlPreview();
  showStage(mode === "preview" ? "html" : "editor");
  if (mode === "source") view.focus();
  renderChrome();
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
  if (arg) openTarget(arg, session?.path);
  else palette.open();
});
Vim.defineEx("archive", "arch", () => void archiveCurrent());
Vim.defineEx("feed", "fe", () => void showFeed());
Vim.defineAction("quireFollowLink", () => followLinkAtCursor());
Vim.mapCommand("gd", "action", "quireFollowLink", {}, { context: "normal" });
Vim.mapCommand("gf", "action", "quireFollowLink", {}, { context: "normal" });

function followLinkAtCursor() {
  const link = linkTargetAt(view.state, view.state.selection.main.head);
  if (!link) return;
  if (link.target) openTarget(link.target, session?.path);
  else if (link.href && /^https?:/i.test(link.href)) window.open(link.href, "_blank", "noopener");
  else if (link.href) openTarget(decodeURIComponent(link.href), session?.path);
}

window.addEventListener(
  "keydown",
  (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "p")) {
      e.preventDefault();
      palette.isOpen ? palette.close() : palette.open();
    } else if (mod && e.key === "\\") {
      e.preventDefault();
      togglePanel();
    } else if (mod && e.key === "s") {
      e.preventDefault();
      flushSave();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void archiveCurrent();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      void showFeed({ filter: true });
    } else if (mod && e.key === "e" && session?.kind === "html") {
      e.preventDefault();
      setHtmlMode(prefs.htmlMode === "preview" ? "source" : "preview");
    }
  },
  true,
);

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
  if (session?.kind === "html") renderHtmlPreview();
  if (session?.kind === "md") bumpEmbeds(view);
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
const lastKey = () => (workspaceId ? `last:${workspaceId}` : "last");

async function boot() {
  // Online, the note API is per workspace and needs a signed-in person; locally it's just /api.
  const who = await whoAmI();
  if (who && !who.me) return showSignIn(who.devLogin);
  if (who?.me) {
    const ws = pickWorkspace(who.me);
    workspaceId = ws.id;
    useWorkspace(`/api/w/${ws.id}`, `/api/w/${ws.id}/live`);
    setSelfName(who.me.user.name);
    renderAccount(who.me, ws, (t) => toast(t));
  }

  hydrateIcons();
  togglePanel(prefs.panel);
  $("#search-btn").addEventListener("click", () => palette.open());
  $("#new-note").addEventListener("click", () => void newNote());
  $("#panel-btn").addEventListener("click", () => togglePanel());
  $("#stage").addEventListener("mousedown", () => document.body.classList.remove("panel-overlay"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#vim-toggle").addEventListener("click", () => {
    prefs.vim = !prefs.vim;
    store.set("vim", prefs.vim);
    view.dispatch({ effects: vimSlot.reconfigure(prefs.vim ? vim() : []) });
    attachVim();
    view.focus();
  });
  $("#html-toggle").addEventListener("click", (e) => {
    const mode = (e.target as HTMLElement).closest("button")?.dataset.mode as "preview" | "source" | undefined;
    if (mode) setHtmlMode(mode);
  });
  const isDark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#theme-toggle").replaceChildren(icon(isDark ? "sun" : "moon", 15));
  window.addEventListener("popstate", () => {
    if (location.hash === "#feed") return void showFeed({ push: false });
    const p = decodeURIComponent(location.hash.slice(2));
    if (p && p !== session?.path) openNote(p, { push: false });
  });
  $("#feed-btn").addEventListener("click", () => void showFeed());
  $("#archive-nav").addEventListener("click", () => void showFeed({ scope: "archived" }));
  $("#archive-btn").addEventListener("click", () => void archiveCurrent());
  window.addEventListener("beforeunload", () => void flushSave());
  watchTimers((t) =>
    toast({
      icon: "timer",
      text: `${t.label || "Timer"} is done`,
      detail: t.note ? displayName(t.note) : undefined,
      action: t.note && t.note !== session?.path ? () => openNote(t.note!) : undefined,
      sticky: true,
    }),
  );
  setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-ts]").forEach((n) => (n.textContent = timeAgo(Number(n.dataset.ts))));
    renderPresence();
  }, 30_000);

  const [info, list, recent] = await Promise.all([api.info(), api.notes(), api.changes()]);
  $("#vault-name").textContent = info.name;
  notes = list;
  changes = recent;
  renderActivity();
  renderPresence();
  connect(onMessage, (up) => {
    $("#conn").dataset.up = String(up);
    $("#conn").title = up ? "Live: watching the vault for agent edits" : "Reconnecting…";
    if (up) refreshNotesSoon();
  });

  if (location.hash === "#feed") return void showFeed({ push: false });
  const fromHash = decodeURIComponent(location.hash.slice(2));
  const start = [fromHash, store.get(lastKey(), ""), "Welcome.md"].find((p) => p && notes.some((n) => n.path === p)) ?? notes[0]?.path;
  if (start) await openNote(start, { push: false });
  if (start && !fromHash) history.replaceState(null, "", `#/${encodeURIComponent(start)}`);
}

boot();

(window as any).quire = { view }; // handy in devtools
