// One task in a list (Tasks, ::tasks, Today): its checkbox, its words, its chips in the fixed
// order, and its ⚙ and ↗ buttons. Click the words to edit them in place, a chip to edit that token,
// ⌘/Ctrl-click to open the note at the line in a new tab (⌘⌥ to the side). Every change goes to the note the task lives in.
import { marked } from "marked";
import { NOTE_HTML, sanitizeNote } from "./render.ts";
import { api, type Task, type TaskPatch } from "./api.ts";
import { el, icon, NOTE_DRAG } from "./dom.ts";
import { clickWhere, modClick, type Where } from "./panes.ts";
import { tagsInLine } from "../../src/core/tags.ts";
import { capHtmlDepth, tameMarkdown } from "../../src/core/depth.ts";
import { endTags, metaChips, today } from "./taskChips.ts";
import { taskInput } from "./taskInput.ts";
import { retypeTask } from "../../src/core/quickAdd.ts";
import { openChipEditor, openTaskMenu, taskPeople } from "./taskChipEditors.ts";
import { toast } from "./toast.ts";

export interface RowEnv {
  /** `where`: here, in a new tab (⌘-click) or in the other pane (⌘⌥-click). */
  open(path: string, line?: number, where?: Where): void;
  openTag(tag: string): void;
  openPerson(name: string): void;
  /** The list reloads after a change (the task's line, or where it lives, moved). */
  reload(): void;
}

const prevent = (e: Event) => e.preventDefault();

/** A task's row. `where` is the muted label on the right (its heading, or its note when grouped otherwise). */
export function taskRow(t: Task, env: RowEnv, where: string | null): HTMLElement {
  const box = el("span", { class: `cm-checkbox${t.done ? " is-checked" : ""}`, role: "checkbox", tabindex: "0", "aria-checked": String(t.done), "aria-label": t.summary, title: t.done ? "Mark open" : "Mark done" });
  const words = el("span", { class: "qt-words", html: inline(t.summary) });
  const text = el("span", { class: "qt-text", title: `${t.title}, line ${t.line}` }, words, ...metaChips(t.meta, t.done, endTags(t.summary, t.meta.tags))); // tags mid-sentence stay there
  const save = async (patch: TaskPatch) => {
    Object.assign(t, await api.updateTask(t, patch)); // its new text, for the next change
    env.reload();
  };
  const move = async (to: string) => {
    await api.moveTask(t, to);
    env.reload();
  };
  const ctx = { task: t, save, people: taskPeople, showPerson: env.openPerson, move };
  text.addEventListener("mousedown", (e) => {
    // A click on the words edits them, so let that one place the caret; chips and tags keep focus where it is.
    const target = e.target as HTMLElement;
    if (target.closest(".qt-edit")) return; // placing the caret or selecting in the open edit
    if (!target.closest(".qt-words") || modClick(e)) prevent(e);
  });
  text.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (modClick(e)) return env.open(t.path, t.line, clickWhere(e)); // ⌘-click (Ctrl-click off a Mac): the note, at this line, in a new tab; ⌘⌥-click to the side
    const chip = target.closest<HTMLElement>(".tk[data-field]");
    const tag = chip?.dataset.field === "tags" ? chip.dataset.value!.toLowerCase() : target.closest<HTMLElement>(".tag")?.dataset.tag;
    if (tag) env.openTag(tag);
    else if (chip) openChipEditor(chip, ctx);
    else if (target.closest(".qt-words")) editWords(t, words, save);
  });
  const menu = el("button", { type: "button", class: "qt-act", title: "Priority, due, repeat, person, tags…", "aria-label": "Task fields", onmousedown: prevent }, icon("sliders", 13));
  menu.addEventListener("click", () => openTaskMenu(menu, ctx));
  const go = el("button", { type: "button", class: "qt-act qt-go", title: "Go to note", "aria-label": `Go to ${t.title}, line ${t.line}`, onmousedown: prevent, onclick: (e: MouseEvent) => env.open(t.path, t.line, clickWhere(e)) }, icon("open", 13));
  const side = el("button", { type: "button", class: "qt-act", title: "Open in split view", "aria-label": `Open ${t.title} in split view`, onmousedown: prevent, onclick: () => env.open(t.path, t.line, "side") }, icon("split", 13));
  // A row dragged onto the notes opens its note in split view.
  const row = el("div", { class: `qt-row${t.done ? " is-done" : ""}`, draggable: "true" }, box, text, where ? el("span", { class: "qt-where" }, where) : null, menu, go, side);
  row.addEventListener("dragstart", (e) => {
    if ((e.target as HTMLElement).closest(".qt-edit")) return e.preventDefault();
    e.dataTransfer!.setData(NOTE_DRAG, t.path);
    e.dataTransfer!.effectAllowed = "copy";
  });
  box.addEventListener("mousedown", (e) => {
    e.preventDefault();
    void toggle(t, row, box, env);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    void toggle(t, row, box, env);
  });
  return row;
}

/** How long a task just ticked stays in its list, struck through, before a list that hides it lets it go. */
export const LINGER = 1500;
const lingerFor = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : LINGER);
/** Each list's latest redraw, held while a row in it lingers. */
const held = new Map<HTMLElement, () => void>();
/** Tasks being ticked or unticked right now: another click waits for the first. */
const busy = new WeakSet<Task>();

/**
 * Draw a list of task rows again. If a row's checkbox or button had the keyboard focus, the same
 * control on the row now in its place gets it (a task ticked off an Open list is gone, so that's the next one).
 * While a row just ticked lingers, the redraw waits for it.
 */
export function redrawRows(list: HTMLElement, draw: () => void) {
  if (list.querySelector(".qt-row.is-lingering")) return void held.set(list, () => redrawRows(list, draw));
  const rows = () => [...list.querySelectorAll<HTMLElement>(".qt-row")];
  const controls = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".cm-checkbox, .qt-act")];
  const row = rows().findIndex((r) => r.contains(document.activeElement));
  const control = row < 0 ? -1 : controls(rows()[row]).indexOf(document.activeElement as HTMLElement);
  draw();
  if (control < 0) return;
  const now = rows();
  const there = now[Math.min(row, now.length - 1)];
  if (there) controls(there)[control]?.focus({ preventScroll: true });
}

/**
 * Tick or untick: shown at once, then the list reloads with what the note says now. The row stays a
 * moment first, so a list that hides done tasks doesn't whisk away the one you just ticked.
 */
async function toggle(t: Task, row: HTMLElement, box: HTMLElement, env: RowEnv) {
  if (busy.has(t)) return;
  busy.add(t);
  const next = !t.done;
  show(row, box, next);
  linger(row, lingerFor());
  await setDone(t, next, { undone: () => show(row, box, false) });
  busy.delete(t);
  env.reload();
}

/**
 * Tick a task in its note, or reopen it: what every list of tasks (and the Calendar) does. Ticking
 * says so, with an Undo that reopens it; a repeating task gets its next date in the note, by its own
 * rule. `changed` runs once the note has changed (after the Undo too); `undone` as the Undo starts.
 * A note that changed underneath fails quietly: reloading shows what's there now.
 */
export async function setDone(t: Task, done: boolean, on: { changed?: () => void; undone?: () => void } = {}): Promise<boolean> {
  try {
    const r = await api.setTask(t, done);
    Object.assign(t, { done, line: r.line, text: r.text }); // ticking adds done:, so the text changed too
  } catch {
    if (!done) toast({ text: `Couldn't reopen “${clip(t.summary)}”. Open its note to change it.` });
    on.changed?.();
    return false;
  }
  if (done) {
    toast({
      icon: "check",
      text: `Done: ${clip(t.summary)}`,
      actionLabel: "Undo",
      action: () => {
        if (!t.done) return;
        on.undone?.();
        void setDone(t, false, { changed: on.changed });
      },
    });
  }
  on.changed?.();
  return true;
}

function show(row: HTMLElement, box: HTMLElement, done: boolean) {
  row.classList.toggle("is-done", done);
  box.classList.toggle("is-checked", done);
  box.setAttribute("aria-checked", String(done));
  box.title = done ? "Mark open" : "Mark done";
}

function linger(row: HTMLElement, ms: number) {
  if (!ms) return;
  row.classList.add("is-lingering");
  setTimeout(() => {
    row.classList.remove("is-lingering");
    for (const [list, redraw] of held) {
      if (list.querySelector(".qt-row.is-lingering")) continue;
      held.delete(list);
      redraw();
    }
  }, ms);
}

const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/**
 * Edit a task's words in place, in the task input (taskInput.ts), its chips left as they are.
 * Phrases typed there ("tomorrow", "every week") and tokens typed after the words become the
 * task's tokens, as in quick-add. Enter or leaving the field saves; Escape puts the words back.
 */
function editWords(t: Task, words: HTMLElement, save: (patch: TaskPatch) => Promise<void>) {
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    const text = input.value().trim();
    const ignore = input.ignore();
    edit.replaceWith(words);
    input.destroy();
    if (!keep || !text) return;
    const patch = retypeTask(`- [ ] ${t.text}`, text, today(), ignore);
    if (Object.keys(patch).length === 1 && patch.summary === t.summary) return; // nothing changed
    words.innerHTML = inline(patch.summary ?? t.summary); // show it now; the reload confirms it
    void save(patch).catch((e) => {
      words.innerHTML = inline(t.summary);
      toast({ error: true, text: e instanceof Error ? e.message : "Couldn't change the task" });
    });
  };
  const input = taskInput({ value: t.summary, compact: true, submit: () => finish(true), cancel: () => finish(false), blur: () => finish(true) });
  // Clicks in the field and its preview are the field's, not the row's (a preview chip isn't the task's chip).
  const edit = el("span", { class: "qt-edit", onclick: (e: Event) => e.stopPropagation() }, input.dom, input.preview);
  words.replaceWith(edit);
  input.focus();
}

/**
 * Task text as inline markdown; [[links]] shown by name, #tags as chips. Links and tags go in as
 * placeholders (control characters, taken out of the text first) and become spans before the
 * sanitizer runs, so nothing is added to the HTML after it's been cleaned. No images, forms or
 * inputs: a task is a line of text.
 */
export function inline(md: string): string {
  const clean = md.replace(/[\u0001-\u0004]/g, "");
  const hits = tagsInLine(clean);
  let text = clean;
  for (let i = hits.length - 1; i >= 0; i--) text = `${text.slice(0, hits[i].from - 1)}\u0003${i}\u0004${text.slice(hits[i].to)}`;
  const withLinks = text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, alias?: string) => `\u0001${alias ?? t}\u0002`);
  const html = capHtmlDepth(marked.parseInline(tameMarkdown(withLinks), { async: false }) as string)
    .replace(/\u0001([^\u0002]*)\u0002/g, '<span class="qt-link">$1</span>') // already escaped by marked
    .replace(/\u0003(\d+)\u0004/g, (_m, i) => `<span class="tag" data-tag="${hits[+i].tag}" title="Tasks tagged #${hits[+i].display}">#${hits[+i].display}</span>`); // tags are letters, digits, _ - /
  return sanitizeNote(html, { ...NOTE_HTML, FORBID_TAGS: [...NOTE_HTML.FORBID_TAGS, "img", "input", "button", "textarea", "select"] });
}
