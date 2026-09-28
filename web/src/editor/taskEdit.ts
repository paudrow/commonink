// Task edits in the editor, and what the editor offers on a task line. An edit is the task line
// rewritten by the one token writer, as a transaction, so it lands in the undo history like typing
// does; ticking a repeating task adds its next occurrence below in the same transaction, so one undo
// takes both back. No DOM here: the widgets that draw these live in taskTools.ts.
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, type WidgetType } from "@codemirror/view";
import { editTaskLines, localDate, parseTask, TASK_LINE, type TaskPatch } from "../../../src/core/tasks.ts";

/**
 * The change that applies `patch` to the task on line `n`, or null if nothing would change. Throws
 * if the line is no longer `expected` (the note changed while the chip's editor was open).
 */
export function taskLineEdit(state: EditorState, n: number, expected: string, patch: TaskPatch, today = localDate(Date.now())): TransactionSpec | null {
  const line = n <= state.doc.lines ? state.doc.line(n) : null;
  if (!line || line.text !== expected) throw new Error("That task changed while you were editing it. Click its chip again.");
  // Ticking touches at most the line below too (the next occurrence, added or taken back).
  const below = n < state.doc.lines ? state.doc.line(n + 1) : null;
  const before = below ? [line.text, below.text] : [line.text];
  const after = editTaskLines(before, 0, patch, today);
  if (after.join("\n") === before.join("\n")) return null;
  return { changes: { from: line.from, to: (below ?? line).to, insert: after.join("\n") }, userEvent: "input.task" };
}

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "HTMLBlock", "CommentBlock", "Frontmatter"]);
const inCode = (state: EditorState, pos: number) => {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent as typeof n) if (CODE.has(n.name)) return true;
  return false;
};

/** Whether `pos` is in a task's text: on a task line, past its checkbox, and not in code. */
export function inTaskText(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const m = line.text.match(TASK_LINE);
  return !!m && pos >= line.to - m[4].length && !inCode(state, pos);
}

/**
 * Where the task line's tools go: the end of the line the cursor is on, if it's a task (and the
 * editor takes edits). `hint` is for a task with no tokens yet, to show what it can carry.
 */
export function taskToolsAt(state: EditorState): { line: number; pos: number; hint: boolean } | null {
  const { head, anchor } = state.selection.main;
  const line = state.doc.lineAt(head);
  if (state.readOnly || state.doc.lineAt(anchor).number !== line.number || !inTaskText(state, line.to)) return null;
  const m = parseTask(line.text)!.meta;
  const bare = !m.due && !m.start && !m.done && !m.rec && !m.priority && !m.assignees.length && !m.tags.length;
  return { line: line.number, pos: line.to, hint: bare };
}

/** The task line's tools as a decoration at the end of the cursor's line: drawn, never part of the document. */
export function taskTools(widget: (hint: boolean) => WidgetType) {
  const build = (state: EditorState): DecorationSet => {
    const at = taskToolsAt(state);
    return at ? Decoration.set([Decoration.widget({ widget: widget(at.hint), side: 1 }).range(at.pos)]) : Decoration.none;
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
