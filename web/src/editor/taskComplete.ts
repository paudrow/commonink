// Completions for a task's tokens as you type them: `due:` and `start:` offer days, `rec:` offers
// repeats, and `!` offers a priority. Only in a task's text, never in code. (`@` offers people from
// the mention source and `#` tags from the tag source; both use inTaskText too.)
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { addDays, localDate } from "../../../src/core/tasks.ts";
import { REPEAT_PICKS, type MenuField } from "../taskChipEditors.ts";
import { inTaskText } from "./taskEdit.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Days to offer after `due:` or `start:`, counted from `today`: today, tomorrow, the rest of the coming week, next week. */
export function dayPicks(today: string): Array<{ label: string; date: string }> {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    ...[2, 3, 4, 5, 6].map((n) => ({ label: `Next ${WEEKDAYS[(weekday + n) % 7]}`, date: addDays(today, n) })),
    { label: "Next week", date: addDays(today, 7) },
  ];
}

/** "Pick a date…" and "More options…": take the half-typed token out and open that field's editor there. */
const openEditor = (field: MenuField, tokenFrom: number, opts?: { more?: boolean }) => (view: EditorView, _c: Completion, _from: number, to: number) => {
  // At the end of the line, the space typed before the token goes too: the editor writes the token back in its place.
  const line = view.state.doc.lineAt(tokenFrom);
  const space = view.state.sliceDoc(to, line.to).trim() ? 0 : view.state.sliceDoc(line.from, tokenFrom).match(/[ \t]*$/)![0].length;
  const cut = tokenFrom - space;
  view.dispatch({ changes: { from: cut, to }, selection: { anchor: cut }, userEvent: "input.complete" });
  void import("./taskTools.ts").then((m) => m.openFieldAt(view, field, cut, opts));
};

/** An option with the icon the completion list draws beside it. */
const pick = (c: Completion, icon: string): Completion => ({ ...c, icon }) as Completion;

export function taskTokenSource(ctx: CompletionContext): CompletionResult | null {
  const typed = ctx.matchBefore(/(?<!\S)(?:(due|start|scheduled|rec):\S*|![a-z]*)$/i);
  if (!typed || !inTaskText(ctx.state, typed.from)) return null;
  const key = typed.text.match(/^(\w+):/)?.[1].toLowerCase();
  if (!key) {
    return { from: typed.from, options: [pick({ label: "!high", detail: "High priority" }, "flag"), pick({ label: "!low", detail: "Low priority" }, "flag")], validFor: /^![a-z]*$/i };
  }
  const from = typed.from + key.length + 1;
  if (key === "rec") {
    return {
      from,
      validFor: /^\S*$/,
      options: [
        ...REPEAT_PICKS.map(([label, rec], i) => pick({ label, detail: rec, apply: rec, boost: -i }, "reset")),
        pick({ label: "More options…", apply: openEditor("rec", typed.from, { more: true }), boost: -99 }, "sliders"),
      ],
    };
  }
  const field = key === "due" ? "due" : "start";
  return {
    from,
    validFor: /^\S*$/,
    options: [
      ...dayPicks(localDate(Date.now())).map((d, i) => pick({ label: d.label, detail: d.date, apply: d.date, boost: -i }, "calendar")),
      pick({ label: "Pick a date…", apply: openEditor(field, typed.from), boost: -99 }, "calendar"),
    ],
  };
}
