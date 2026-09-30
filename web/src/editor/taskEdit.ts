// Task edits in the editor, and what the editor offers on a task line. An edit is the task line
// rewritten by the one token writer, as a transaction, so it lands in the undo history like typing
// does; ticking a repeating task adds its next occurrence below in the same transaction, so one undo
// takes both back. No DOM here: the widgets that draw these live in taskTools.ts.
import { noteTree } from "./tree.ts";
import { StateField, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, type WidgetType } from "@codemirror/view";
import { editTaskLines, localDate, parseTask, TASK_LINE, type TaskPatch } from "../../../src/core/tasks.ts";
import { parseQuickAdd, type QuickKind, type QuickSpan } from "../../../src/core/quickAdd.ts";

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
  for (let n: { name: string; parent: unknown } | null = noteTree(state).resolveInner(pos, -1); n; n = n.parent as typeof n) if (CODE.has(n.name)) return true;
  return false;
};

/** Whether `pos` is in a task's text: on a task line, past its checkbox, and not in code. */
export function inTaskText(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const m = line.text.match(TASK_LINE);
  return !!m && pos >= line.to - m[4].length && !inCode(state, pos);
}

export type HintField = "due" | "rec" | "assignees" | "tags" | "priority";
/** The hint's words, in the order they show, and the field each one's editor sets. */
export const HINTS: Array<[string, HintField]> = [["due", "due"], ["repeat", "rec"], ["@", "assignees"], ["#", "tags"], ["!", "priority"]];

/**
 * Where the task line's tools go: the end of the line the cursor is on, if it's a task (and the
 * editor takes edits). `missing` is the fields the task doesn't have yet, which the hint offers;
 * `pending` is the tokens its phrases would become (what Tab does), in the line's order.
 */
export function taskToolsAt(state: EditorState, today = localDate(Date.now())): { line: number; pos: number; missing: HintField[]; pending: string[] } | null {
  const { head, anchor } = state.selection.main;
  const line = state.doc.lineAt(head);
  if (state.readOnly || state.doc.lineAt(anchor).number !== line.number || !inTaskText(state, line.to)) return null;
  const m = parseTask(line.text)!.meta;
  const pending = phrasesAt(state, today)?.phrases.map((p) => p.token) ?? [];
  const says = (key: string) => pending.some((t) => t.startsWith(`${key}:`));
  const has: Record<HintField, boolean> = { due: !!m.due || says("due"), rec: !!m.rec || says("rec"), assignees: m.assignees.length > 0, tags: m.tags.length > 0, priority: !!m.priority };
  return { line: line.number, pos: line.to, missing: HINTS.map(([, f]) => f).filter((f) => !has[f]), pending };
}

/** The task line's tools as a decoration at the end of the cursor's line: drawn, never part of the document. */
export function taskTools(widget: (missing: HintField[], pending: string[]) => WidgetType, today = () => localDate(Date.now())) {
  const build = (state: EditorState): DecorationSet => {
    const at = taskToolsAt(state, today());
    return at ? Decoration.set([Decoration.widget({ widget: widget(at.missing, at.pending), side: 1 }).range(at.pos)]) : Decoration.none;
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/**
 * The phrases quick-add would read on the cursor's task line ("tomorrow", "every week"), where they
 * are in the document. They're only marked (a dotted underline): nothing changes until Tab or a
 * click turns them into tokens (convertPhrases). Null off a task line, or in code.
 */
export function phrasesAt(state: EditorState, today: string): { line: number; phrases: Array<{ from: number; to: number; kind: QuickKind; token: string }> } | null {
  const line = state.doc.lineAt(state.selection.main.head);
  const m = line.text.match(TASK_LINE);
  if (!m || state.readOnly || !inTaskText(state, line.to)) return null;
  const at = line.to - m[4].length;
  const q = parseQuickAdd(m[4], today, [], { targets: false });
  return q.spans.length ? { line: line.number, phrases: q.spans.map((s) => ({ from: at + s.from, to: at + s.to, kind: s.kind, token: s.token })) } : null;
}

/** The dotted underline under the cursor's task line's phrases, titled with what each would become. */
export function taskPhrases(today: () => string = () => localDate(Date.now())) {
  const build = (state: EditorState): DecorationSet => {
    const at = phrasesAt(state, today());
    return at ? Decoration.set(at.phrases.map((p) => Decoration.mark({ class: `cm-phrase is-${p.kind}`, attributes: { title: `Tab or click: ${p.token}` } }).range(p.from, p.to))) : Decoration.none;
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/**
 * What Tab does on a task line with phrases: with the cursor in one, or just after it (a space
 * after counts), it turns the line's phrases into tokens. Null anywhere else, so Tab indents as usual.
 */
export function phraseTab(state: EditorState, today: string): TransactionSpec | null {
  const at = phrasesAt(state, today);
  const head = state.selection.main.head;
  const touching = at?.phrases.some((p) => (head > p.from && head <= p.to) || (head === p.to + 1 && state.sliceDoc(p.to, head) === " "));
  return at && touching && state.selection.main.empty ? convertPhrases(state, at.line, today) : null;
}

/**
 * Turn the phrases on task line `n` into tokens (just `only`, the one clicked, if given), as one
 * transaction: the checkbox, its indent and the rest of the line stay. Null if there's nothing to turn.
 */
export function convertPhrases(state: EditorState, n: number, today: string, only?: string): TransactionSpec | null {
  return rewritePhrases(state, n, today, (spans, text) => (only === undefined ? spans : spans.filter((s) => text.slice(s.from, s.to).toLowerCase() === only.toLowerCase())));
}

/** Task line `n` with the phrases `pick` chooses (from the ones read in its text) turned into tokens; the rest stay words. */
function rewritePhrases(state: EditorState, n: number, today: string, pick: (spans: QuickSpan[], text: string) => QuickSpan[]): TransactionSpec | null {
  const line = state.doc.line(n);
  const m = line.text.match(TASK_LINE);
  if (!m || !inTaskText(state, line.to)) return null;
  const read = parseQuickAdd(m[4], today, [], { targets: false });
  const chosen = pick(read.spans, m[4]);
  if (!chosen.length) return null;
  const keep = read.spans.filter((s) => !chosen.includes(s)).map((s) => m[4].slice(s.from, s.to));
  const text = parseQuickAdd(m[4], today, keep, { targets: false }).line.match(TASK_LINE)![4];
  return { changes: { from: line.to - m[4].length, to: line.to, insert: text }, userEvent: "input.task" };
}

/** The cursor's line, from when the cursor came to it: where the line starts, and the ranges typed on it since. */
interface Visit {
  from: number;
  typed: Array<[number, number]>;
}

/** What's been typed on the cursor's line this visit, so leaving it can turn just those phrases into tokens. */
export const lineVisit = StateField.define<Visit>({
  create: (state) => ({ from: state.doc.lineAt(state.selection.main.head).from, typed: [] }),
  update(visit, tr) {
    if (!tr.docChanged && !tr.selection) return visit;
    const line = tr.state.doc.lineAt(tr.state.selection.main.head);
    const stayed = tr.state.doc.lineAt(tr.changes.mapPos(visit.from, -1)).from === line.from;
    const typed = stayed ? mapRanges(visit.typed, tr) : [];
    if (tr.isUserEvent("input") && !tr.isUserEvent("input.task")) {
      tr.changes.iterChangedRanges((_a, _b, from, to) => void (to > from && from >= line.from && to <= line.to && typed.push([from, to])));
    }
    return { from: line.from, typed };
  },
});

const mapRanges = (ranges: Visit["typed"], tr: Transaction): Visit["typed"] =>
  ranges.map(([a, b]): [number, number] => [tr.changes.mapPos(a, 1), tr.changes.mapPos(b, -1)]).filter(([a, b]) => a < b);

/**
 * When `tr` takes the cursor off a task line: the change that turns the phrases typed there this
 * visit into tokens, if they end the task's words ("Buy milk tomorrow"). One inside the sentence
 * ("the Monday memo") or one already there stays words; Tab or a click still turns it. Else null.
 */
export function phrasesLeft(tr: Transaction, today: string): TransactionSpec | null {
  const was = tr.startState.field(lineVisit, false);
  if (!was?.typed.length) return null;
  const left = tr.state.doc.lineAt(tr.changes.mapPos(was.from, -1));
  if (left.from === tr.state.field(lineVisit).from) return null;
  const typed = mapRanges(was.typed, tr);
  const task = parseTask(left.text);
  if (!task) return null;
  const start = left.to - task.text.length;
  return rewritePhrases(tr.state, left.number, today, (spans, text) => {
    // The phrases that end the words: from the last one back, with only spaces between.
    const ending: QuickSpan[] = [];
    let end = task.summary.length;
    for (const s of [...spans].reverse()) {
      if (s.to > end || text.slice(s.to, end).trim()) break;
      ending.push(s);
      end = s.from;
    }
    return ending.filter((s) => typed.some(([a, b]) => start + s.from < b && start + s.to > a));
  });
}
