// What a task line offers while the cursor is on it: a ⚙ button at the end of the line that opens
// the task's field menu (the same one task lists have, and ⌘. opens it from the keyboard), and a
// faint hint of the fields it doesn't have yet (`due · repeat · @ · # · !`), each word opening that
// field's editor. Every change goes through taskLineEdit, so undo takes it back.
//
// Phrases quick-add would read ("tomorrow", "every week") get a dotted underline on the cursor's
// task line, and the tools show the chips they'd become. Tab right after one, or a click on the
// chips or a phrase, turns them into tokens. Phrases you just typed at the end of the task's words
// turn by themselves when the cursor leaves the line, and a toast says what they became. Each is
// one change that one undo takes back.
import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { EditorView, keymap, WidgetType } from "@codemirror/view";
import { localDate, parseTask, type TaskMeta } from "../../../src/core/tasks.ts";
import { recLabel } from "../../../src/core/recurrence.ts";
import { el, icon } from "../dom.ts";
import { formatKeys } from "../keys.ts";
import { openFieldEditor, openTaskMenu, taskPeople, type ChipContext, type MenuField } from "../taskChipEditors.ts";
import { dayLabel, tokenChip, type ChipField } from "../taskChips.ts";
import { toast } from "../toast.ts";
import { editorContext } from "./blocks.ts";
import { convertPhrases, HINTS, lineVisit, phrasesAt, phrasesLeft, phraseTab, taskLineEdit, taskPhrases, taskTools, taskToolsAt, type HintField } from "./taskEdit.ts";

/** A task on line `n` as the chip editors take it, saving through a transaction on that line. */
export function lineTaskContext(view: EditorView, n: number): ChipContext | null {
  const line = view.state.doc.line(n);
  const task = parseTask(line.text);
  if (!task) return null;
  const ctx = view.state.facet(editorContext);
  return {
    task: { path: ctx.path, title: "", line: n, text: task.text, summary: task.summary, done: task.done, heading: null, meta: task.meta },
    save: async (patch) => {
      const spec = taskLineEdit(view.state, n, line.text, patch);
      if (spec) view.dispatch(spec);
    },
    people: taskPeople,
    showPerson: (name) => ctx.openPerson(name),
    onClose: () => setTimeout(() => view.focus()), // after the key or click that closed it is done
  };
}

/** Open one field's editor for the task at `pos`, under the cursor (from a completion, like "Pick a date…"). */
export function openFieldAt(view: EditorView, field: MenuField, pos: number, opts?: { more?: boolean }) {
  const ctx = lineTaskContext(view, view.state.doc.lineAt(pos).number);
  const at = view.coordsAtPos(pos);
  if (!ctx || !at) return;
  // The editors open under an element; a one-pixel one where the cursor is stands in for a chip.
  const anchor = el("span", { style: { position: "fixed", left: `${at.left}px`, top: `${at.top}px`, width: "1px", height: `${at.bottom - at.top}px` } });
  document.body.append(anchor);
  openFieldEditor(field, anchor, "", ctx, opts);
  anchor.remove();
}

class ToolsWidget extends WidgetType {
  constructor(
    readonly missing: HintField[],
    readonly pending: string[],
  ) {
    super();
  }
  eq(o: ToolsWidget) {
    return o.missing.join() === this.missing.join() && o.pending.join() === this.pending.join();
  }
  toDOM(view: EditorView) {
    const button = el("button", { type: "button", class: "cm-task-gear", title: `Priority, due, repeat, person, tags… (${formatKeys("Mod-.")})`, "aria-label": "Task fields" }, icon("sliders", 13));
    // Each word opens its field's editor, anchored to the word: `due` the date, `repeat` the repeat…
    const words = HINTS.filter(([, f]) => this.missing.includes(f)).map(([word, field]) =>
      el("button", { type: "button", class: "cm-hint-word", "data-field": field, title: `Add ${WORD_TITLES[field]}` }, word),
    );
    const hint = words.length ? el("span", { class: "cm-task-hint" }, ...words.flatMap((w, i) => (i ? [" · ", w] : [w]))) : null;
    // What the underlined phrases would become, as the chips they'd be: a click (or Tab) makes them tokens.
    const pending = this.pending.length
      ? el(
          "button",
          { type: "button", class: "cm-task-pending", title: "Make these the task's tokens (Tab). Typed at the end of the task, they are when you leave the line." },
          ...this.pending.map((t) => tokenChip(t.slice(0, t.indexOf(":")) as ChipField, t.slice(t.indexOf(":") + 1))),
          el("kbd", {}, "Tab"),
        )
      : null;
    const wrap = el("span", { class: "cm-task-tools" }, button, pending, hint);
    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // the cursor stays on the line, so the tools do too
      e.stopPropagation();
      const ctx = lineTaskContext(view, view.state.doc.lineAt(view.posAtDOM(wrap)).number);
      const word = (e.target as HTMLElement).closest<HTMLElement>(".cm-hint-word");
      if (!ctx) return;
      if (word) openFieldEditor(word.dataset.field as HintField, word, "", ctx);
      else if ((e.target as HTMLElement).closest(".cm-task-pending")) {
        const spec = convertPhrases(view.state, ctx.task.line, today());
        if (spec) view.dispatch(spec);
      } else if ((e.target as HTMLElement).closest(".cm-task-gear")) openTaskMenu(button, ctx);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const WORD_TITLES: Record<HintField, string> = { due: "a due date", rec: "a repeat", assignees: "a person", tags: "a tag", priority: "a priority" };

/** ⌘. (Ctrl+. elsewhere) on a task line opens its ⚙ menu from the keyboard; the menu's items take Tab and Enter. */
const openMenuKey = keymap.of([
  {
    key: "Mod-.",
    run: (view) => {
      const at = taskToolsAt(view.state);
      const gear = view.dom.querySelector<HTMLElement>(".cm-task-gear");
      const ctx = at && lineTaskContext(view, at.line);
      if (!ctx || !gear) return false;
      openTaskMenu(gear, ctx);
      return true;
    },
  },
]);

const today = () => localDate(Date.now());

/** Tab right after a phrase on a task line makes the line's phrases tokens (not while a suggestion list is open). */
const phraseKey = Prec.high(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        if (completionStatus(view.state) === "active") return false;
        const spec = phraseTab(view.state, today());
        return !!spec && (view.dispatch(spec), true);
      },
    },
  ]),
);

/** The phrase a press started on, if it was underlined then: the click that follows turns just that one. */
let pressed: { line: number; text: string } | null = null;
const phraseClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    pressed = null;
    const mark = (e.target as HTMLElement).closest?.(".cm-phrase");
    if (!mark || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
    const pos = view.posAtDOM(mark);
    const at = phrasesAt(view.state, today());
    const p = at?.phrases.find((x) => pos >= x.from && pos < x.to);
    if (at && p) pressed = { line: at.line, text: view.state.sliceDoc(p.from, p.to) };
    return false;
  },
  click(_e, view) {
    const p = pressed;
    pressed = null;
    if (!p || !view.state.selection.main.empty) return false; // a drag across it selects; it doesn't turn it
    const spec = convertPhrases(view.state, p.line, today(), p.text);
    if (spec) view.dispatch(spec);
    return false;
  },
});

/** What a converted line was set to, as words for its toast: "due Tomorrow, repeats weekly". */
function setLabel(was: TaskMeta, now: TaskMeta): string {
  const changed = (k: "due" | "start" | "rec" | "until" | "times") => now[k] !== null && now[k] !== was[k];
  return [
    changed("due") && `due ${dayLabel(now.due!)}`,
    changed("start") && `starts ${dayLabel(now.start!)}`,
    changed("rec") && `repeats ${recLabel(now.rec!).toLowerCase()}`,
    changed("until") && `until ${dayLabel(now.until!)}`,
    changed("times") && `${now.times} times`,
  ].filter(Boolean).join(", ");
}

/**
 * Leaving a task line turns the phrases just typed at the end of its words into tokens, once the
 * move has landed: its own undo step, so one undo takes back just that. A toast says what they
 * became, with an Undo that puts the words back if the line hasn't changed since.
 */
const convertOnLeave = EditorView.updateListener.of((u) => {
  const tr = u.transactions.at(-1);
  const spec = tr && phrasesLeft(tr, today());
  if (!spec) return;
  queueMicrotask(() => {
    if (u.view.state !== u.state) return; // something else happened first: leave the words
    const change = spec.changes as { from: number; to: number; insert: string };
    const n = u.state.doc.lineAt(change.from).number;
    const before = u.state.doc.line(n).text;
    u.view.dispatch({ ...spec, annotations: isolateHistory.of("full") });
    const after = u.view.state.doc.line(n).text;
    const [was, now] = [parseTask(before)!, parseTask(after)!];
    toast({
      text: `${now.summary}: ${setLabel(was.meta, now.meta)}`,
      icon: "calendar",
      actionLabel: "Undo",
      action: () => {
        const at = u.view.state.doc.lines >= n && u.view.state.doc.line(n);
        if (!at || at.text !== after) return toast({ text: "That task changed since, so it stays as it is" });
        u.view.dispatch({ changes: { from: at.from, to: at.to, insert: before }, userEvent: "input.task", annotations: isolateHistory.of("full") });
      },
    });
  });
});

/** The editor extension: the tools on the cursor's task line, ⌘. to open its menu, and its phrases underlined and turned into tokens. */
export const taskLineTools = [taskTools((missing, pending) => new ToolsWidget(missing, pending), today), openMenuKey, taskPhrases(today), phraseKey, phraseClick, lineVisit, convertOnLeave];
