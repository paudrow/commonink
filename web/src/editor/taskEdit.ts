// A task edit in the editor (a chip, or the checkbox): the task line rewritten by the one token
// writer, as a transaction, so it lands in the undo history like typing does. Ticking a repeating
// task adds its next occurrence below in the same transaction, so one undo takes both back.
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { editTaskLines, localDate, type TaskPatch } from "../../../src/core/tasks.ts";

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
