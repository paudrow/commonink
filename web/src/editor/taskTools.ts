// What a task line offers while the cursor is on it: a ⚙ button at the end of the line that opens
// the task's field menu (the same one task lists have), and, while the task has no tokens yet, a
// faint hint of what it can carry. Every change goes through taskLineEdit, so undo takes it back.
import { WidgetType, type EditorView } from "@codemirror/view";
import { parseTask } from "../../../src/core/tasks.ts";
import { el, icon } from "../dom.ts";
import { openFieldEditor, openTaskMenu, taskPeople, type ChipContext, type MenuField } from "../taskChipEditors.ts";
import { editorContext } from "./blocks.ts";
import { taskLineEdit, taskTools } from "./taskEdit.ts";

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
  constructor(readonly hint: boolean) {
    super();
  }
  eq(o: ToolsWidget) {
    return o.hint === this.hint;
  }
  toDOM(view: EditorView) {
    const button = el("button", { type: "button", class: "cm-task-gear", title: "Priority, due, repeat, person, tags…", "aria-label": "Task fields" }, icon("sliders", 13));
    const wrap = el("span", { class: "cm-task-tools" }, button, this.hint ? el("span", { class: "cm-task-hint", "aria-hidden": "true" }, "due · repeat · @ · # · !") : null);
    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // the cursor stays on the line, so the button does too
      e.stopPropagation();
      const ctx = lineTaskContext(view, view.state.doc.lineAt(view.posAtDOM(wrap)).number);
      if (ctx) openTaskMenu(button, ctx);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** The editor extension: the tools on the cursor's task line. */
export const taskLineTools = taskTools((hint) => new ToolsWidget(hint));
