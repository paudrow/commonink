// One task in a list (Tasks, ::tasks, Today): its checkbox, its words, its chips in the fixed
// order, and its ⚙ and ↗ buttons. Click the words to edit them in place, a chip to edit that token,
// ⌘/Ctrl-click to open the note at the line. Every change goes to the note the task lives in.
import { marked } from "marked";
import DOMPurify from "dompurify";
import { NOTE_HTML } from "./render.ts";
import { api, type Task, type TaskPatch } from "./api.ts";
import { el, icon, NOTE_DRAG } from "./dom.ts";
import { sideClick } from "./panes.ts";
import { tagsInLine } from "../../src/core/tags.ts";
import { endTags, metaChips } from "./taskChips.ts";
import { openChipEditor, openTaskMenu, taskPeople } from "./taskChipEditors.ts";

export interface RowEnv {
  /** `side`: in the other pane (Cmd/Ctrl-click). */
  open(path: string, line?: number, side?: boolean): void;
  openTag(tag: string): void;
  openPerson(name: string): void;
  /** The list reloads after a change (the task's line, or where it lives, moved). */
  reload(): void;
}

const prevent = (e: Event) => e.preventDefault();

/** A task's row. `where` is the muted label on the right (its heading, or its note when grouped otherwise). */
export function taskRow(t: Task, env: RowEnv, where: string | null): HTMLElement {
  const box = el("span", { class: `cm-checkbox${t.done ? " is-checked" : ""}`, role: "checkbox", "aria-checked": String(t.done), title: t.done ? "Mark open" : "Mark done" });
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
    if (target.closest(".qt-input")) return; // placing the caret or selecting in the open edit
    if (!target.closest(".qt-words") || sideClick(e)) prevent(e);
  });
  text.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (sideClick(e)) return env.open(t.path, t.line, true); // ⌘-click (Ctrl-click off a Mac): the note, at this line, to the side
    const chip = target.closest<HTMLElement>(".tk[data-field]");
    const tag = chip?.dataset.field === "tags" ? chip.dataset.value!.toLowerCase() : target.closest<HTMLElement>(".tag")?.dataset.tag;
    if (tag) env.openTag(tag);
    else if (chip) openChipEditor(chip, ctx);
    else if (target.closest(".qt-words")) editWords(t, words, save);
  });
  const menu = el("button", { type: "button", class: "qt-act", title: "Priority, due, repeat, person, tags…", "aria-label": "Task fields", onmousedown: prevent }, icon("sliders", 13));
  menu.addEventListener("click", () => openTaskMenu(menu, ctx));
  const go = el("button", { type: "button", class: "qt-act", title: "Go to note", "aria-label": `Go to ${t.title}, line ${t.line}`, onmousedown: prevent, onclick: (e: MouseEvent) => env.open(t.path, t.line, sideClick(e)) }, icon("open", 13));
  const side = el("button", { type: "button", class: "qt-act", title: "Open to the side", "aria-label": `Open ${t.title} to the side`, onmousedown: prevent, onclick: () => env.open(t.path, t.line, true) }, icon("split", 13));
  // A row dragged to the right edge of the window opens its note there.
  const row = el("div", { class: `qt-row${t.done ? " is-done" : ""}`, draggable: "true" }, box, text, where ? el("span", { class: "qt-where" }, where) : null, menu, go, side);
  row.addEventListener("dragstart", (e) => {
    if ((e.target as HTMLElement).closest("input")) return e.preventDefault();
    e.dataTransfer!.setData(NOTE_DRAG, t.path);
    e.dataTransfer!.effectAllowed = "copy";
  });
  box.addEventListener("mousedown", (e) => {
    e.preventDefault();
    void toggle(t, row, box, env);
  });
  return row;
}

/** Tick or untick: shown at once, then the list reloads with what the note says now. */
async function toggle(t: Task, row: HTMLElement, box: HTMLElement, env: RowEnv) {
  const next = !t.done;
  row.classList.toggle("is-done", next);
  box.classList.toggle("is-checked", next);
  try {
    const r = await api.setTask(t, next);
    Object.assign(t, { done: next, line: r.line, text: r.text }); // ticking adds done:, so the text changed too
  } finally {
    env.reload(); // on a failure too: the note changed underneath us, so show what's there now
  }
}

/**
 * Edit a task's words in place: an input over them, its chips left as they are. Enter or leaving
 * the input saves (only the words change; the core leaves the tokens be), Escape puts them back.
 */
function editWords(t: Task, words: HTMLElement, save: (patch: TaskPatch) => Promise<void>) {
  const input = el("input", { class: "qt-input", value: t.summary, "aria-label": "Task text", spellcheck: "true" });
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    input.replaceWith(words);
    if (keep && next && next !== t.summary) {
      words.innerHTML = inline(next); // show it now; the reload confirms it
      void save({ summary: next }).catch((e) => {
        words.innerHTML = inline(t.summary);
        alert(e instanceof Error ? e.message : "Couldn't change the task");
      });
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") (e.preventDefault(), finish(true));
    else if (e.key === "Escape") (e.preventDefault(), finish(false));
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  words.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
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
  const html = (marked.parseInline(withLinks, { async: false }) as string)
    .replace(/\u0001([^\u0002]*)\u0002/g, '<span class="qt-link">$1</span>') // already escaped by marked
    .replace(/\u0003(\d+)\u0004/g, (_m, i) => `<span class="tag" data-tag="${hits[+i].tag}" title="Tasks tagged #${hits[+i].display}">#${hits[+i].display}</span>`); // tags are letters, digits, _ - /
  return DOMPurify.sanitize(html, { ...NOTE_HTML, FORBID_TAGS: [...NOTE_HTML.FORBID_TAGS, "img", "input", "button", "textarea", "select"] });
}
