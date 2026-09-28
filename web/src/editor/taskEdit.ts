// A chip edit in the editor: the task line rewritten by the one token writer (editTask), as a
// transaction, so it lands in the undo history like typing does.
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { editTask, type TaskPatch } from "../../../src/core/tasks.ts";

/**
 * The change that applies `patch` to the task on line `n`, or null if nothing would change. Throws
 * if the line is no longer `expected` (the note changed while the chip's editor was open).
 */
export function taskLineEdit(state: EditorState, n: number, expected: string, patch: TaskPatch): TransactionSpec | null {
  const line = n <= state.doc.lines ? state.doc.line(n) : null;
  if (!line || line.text !== expected) throw new Error("That task changed while you were editing it. Click its chip again.");
  const next = editTask(line.text, patch);
  return next === line.text ? null : { changes: { from: line.from, to: line.to, insert: next }, userEvent: "input.task" };
}
