// Tasks: list, add in words, change tokens, tick, repeat, move and remove; and the day at a glance.
import { QuireError } from "../paths.ts";
import { fmtTasks, fmtToday, fmtWrite } from "../format.ts";
import type { Quire } from "../quire.ts";
import type { TaskPatch } from "../tasks.ts";
import { bool, command, list, num, str } from "./types.ts";

const LINE = "The task's line, as list_tasks showed it (path:line)";
const TEXT = "The task's text after the checkbox, as list_tasks showed it (guards against the note having changed).";
const TEXT_CLI = " On the CLI it's looked up from the line when left out.";

/** A task's text, given, or read from its line (the CLI's way: people name a task by where it is). */
function taskText(quire: Quire, note: string, line: number, text: string | undefined): string {
  if (text !== undefined) return text;
  const task = quire.tasks({ note }).find((t) => t.line === line);
  if (!task) throw new QuireError(`There's no task on line ${line} of ${note}`, "not_found");
  return task.text;
}

/**
 * The fields a task can carry, as update_task takes them. Kept in one place so a feature that adds
 * a field (people to assign, say) adds it here and both the CLI and MCP offer it.
 */
export const TASK_FIELDS = {
  due: str({ nullable: true, label: "date", describe: "YYYY-MM-DD or YYYY-MM-DDTHH:MM" }),
  start: str({ nullable: true, label: "date", describe: "Hide until this date" }),
  rec: str({
    nullable: true,
    label: "rule",
    describe:
      "How it repeats, from the due date: daily, weekly, monthly, yearly, 3d, 2w, mon,thu, 2w-mon,thu, 6th (a 31st falls on a shorter month's last day), last-day, last-day-2 (two days before the last day), 1st-tue,3rd-tue, last-fri, mar-1, 1st-mon-mar, day-50; " +
      "a gap after it's done: after-1m, after-10d; or RRULE:FREQ=…;BYDAY=… (COUNT and UNTIL too)",
  }),
  until: str({ nullable: true, label: "date", describe: "The repeat's last day, YYYY-MM-DD: no occurrence after it" }),
  times: num({ nullable: true, min: 1, label: "n", describe: "How many times the repeat is left to happen, this one included; each tick counts one down" }),
  priority: str({ nullable: true, enum: ["high", "low"], label: "high|low" }),
  assignees: list({ flag: "assignee", label: "people", describe: "People, without @" }),
  tags: list({ flag: "tag", label: "tags", describe: "Tags, without #" }),
};

export const tasks = [
  command({
    cli: "tasks",
    mcp: "list_tasks",
    route: "GET /tasks",
    title: "List tasks",
    summary: "Checkbox tasks across the vault, with their tokens, filtered by tag, person or due date",
    description:
      "Checkbox tasks across the vault (not archived notes), as their markdown lines with path:line. A task's metadata is tokens in " +
      "its text: due:YYYY-MM-DD, start:YYYY-MM-DD, rec:… (how it repeats), #tag, @person, !high or !low, and done:YYYY-MM-DD once ticked.",
    examples: ["quire tasks", "quire tasks --tag work --due '<=today'", "quire tasks --assignee jane --all --json"],
    readOnly: true,
    args: {
      status: str({ enum: ["open", "done", "all"], presets: { done: "done", all: "all" }, describe: "Default open" }),
      folder: str(),
      note: str({ describe: "Only this note's tasks" }),
      tag: str({ describe: "Only tasks with this tag or a tag under it" }),
      assignee: str({ describe: "Only tasks with this @person" }),
      due: str({ describe: "A due date filter: <=today (overdue or due today), tomorrow, >=2026-10-01…" }),
    },
    run: ({ quire }, { status, ...filters }) => {
      const want = status ?? "open";
      const found = quire.tasks(filters).filter((t) => want === "all" || t.done === (want === "done"));
      return { text: fmtTasks(found), data: found };
    },
  }),
  command({
    cli: "task add",
    mcp: "add_task",
    route: "POST /tasks/add",
    title: "Add task",
    summary: "Add a task in words: dates and repeats become tokens; it goes to today's daily note or → [[Note]]",
    description:
      "Add a task written the way you'd say it: dates and repeats in words become tokens (\"Pay rent every month on the 1st #home\" → " +
      "due:… rec:1st #home; \"call mom tomorrow\", \"next fri\", \"oct 3\", \"in 2 weeks\", \"every other week\", \"last friday of the month\", " +
      "\"every 3 days after done\"). Tokens (due:, !high, @person, #tag) pass through. It goes under ## Tasks in today's daily note " +
      "(Journal/YYYY-MM-DD.md, created if needed), or into the note named with → [[Note]].",
    examples: ['quire task add "Pay rent every month on the 1st #home"', 'quire task add "Review the PR next fri → [[Launch]] @sam"'],
    args: {
      text: str({ required: true, pos: "rest", stdin: true, missing: 'Say what the task is: quire task add "Call mom tomorrow"', describe: 'The task, e.g. "Review the PR next fri → [[Launch]] @sam"' }),
    },
    run: ({ quire, source }, a) => {
      const r = quire.addTask(a.text, source);
      return { text: `Added "- [ ] ${r.text}" to ${r.path}:${r.line}`, data: r };
    },
  }),
  command({
    cli: "task update",
    mcp: "update_task",
    route: "POST /tasks/update",
    title: "Update task",
    summary: 'Tick, untick or change one task\'s tokens; "none" clears one',
    description:
      "Tick, untick or change the metadata of one task, by the path:line and text list_tasks gave. Only the fields you pass change: " +
      "a value sets that token, null (or [] for lists) removes it, and the rest of the line stays as the user wrote it. Ticking adds done: with today's date; " +
      "ticking a repeating task (rec:) also adds its next occurrence on the line below, and unticking it straight after takes that back.",
    examples: ["quire task Roadmap 8 --due 2026-10-01 --priority high", "quire task Roadmap 8 --done", "quire task Bills 3 --rec 6th --until 2027-06-30", "quire task Roadmap 8 --due none"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
      done: bool({ presets: { undone: false }, describe: "Tick (true) or untick (false)" }),
      ...TASK_FIELDS,
      skip: bool({ describe: "Move a repeating task to its next date without ticking it (on its own: other fields are ignored)" }),
    },
    run: ({ quire, source }, { path, line, text, done, skip, ...fields }) => {
      const t = taskText(quire, path, line, text);
      const patch = Object.fromEntries(Object.entries({ ...fields, checked: done }).filter(([, v]) => v !== undefined)) as TaskPatch;
      const r = skip ? quire.skipTask(path, line, t, source) : quire.updateTask(path, line, t, patch, source);
      return { text: fmtWrite(r, r.change ? "Updated" : "No change to"), data: r };
    },
  }),
  command({
    cli: "task move",
    mcp: "move_task",
    route: "POST /tasks/move",
    title: "Move task",
    summary: "Move a task (and what's nested under it) to another note's Tasks section",
    description: "Move a task (and the lines nested under it) to another note, by the path:line and text list_tasks gave. It goes at the end of that note's Tasks section, or of the note.",
    examples: ["quire task move Journal/2026-09-28 5 --to Launch"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
      to: str({ required: true, describe: "The note to move it to" }),
    },
    run: ({ quire, source }, a) => {
      const r = quire.moveTask(a.path, a.line, taskText(quire, a.path, a.line, a.text), a.to, source);
      return { text: `Moved "${r.text}" to ${r.path}:${r.line}`, data: r };
    },
  }),
  command({
    cli: "task remove",
    mcp: "remove_task",
    route: "POST /tasks/remove",
    title: "Remove task",
    summary: "Take a task's line (and what's nested under it) out of its note",
    description: "Remove one task's line, and the lines nested under it, from its note, by the path:line and text list_tasks gave. Only when the user asks; ticking it is usually what they want.",
    examples: ["quire task remove Inbox 4"],
    destructive: true,
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
    },
    run: ({ quire, source }, a) => {
      const r = quire.removeTask(a.path, a.line, taskText(quire, a.path, a.line, a.text), source);
      return { text: fmtWrite(r, "Removed a task from"), data: r };
    },
  }),
  command({
    cli: "today",
    mcp: "get_today",
    route: "GET /today",
    title: "Get today",
    summary: "The day at a glance: overdue, due today, starting today, and today's journal note",
    description:
      "The day at a glance: open tasks overdue, due today and starting today (repeating ones show their rec:), and whether today's " +
      "journal note (Journal/YYYY-MM-DD.md) exists. A good start for a morning brief.",
    examples: ["quire today", "quire today --date 2026-10-01 --json"],
    readOnly: true,
    args: { today: str({ flag: "date", describe: "The day to read, YYYY-MM-DD; default the user's today" }) },
    run: ({ quire }, a) => {
      const t = quire.today(a.today);
      return { text: fmtToday(t), data: t };
    },
  }),
  command({
    cli: "journal",
    mcp: "open_journal",
    route: "POST /today/journal",
    title: "Open journal",
    summary: "Today's journal note, made from the daily template if it's missing",
    description: "Today's journal note (Journal/YYYY-MM-DD.md): its path, made from Templates/Daily note.md (or a plain one) if it doesn't exist yet.",
    examples: ["quire journal", "quire journal --date 2026-10-01"],
    args: { today: str({ flag: "date", describe: "The day, YYYY-MM-DD; default the user's today" }) },
    run: ({ quire, source }, a) => {
      const r = quire.dailyNote(a.today ?? quire.today().date, source);
      return { text: `${r.created ? "Started" : "Already there:"} ${r.path}`, data: { path: r.path, created: r.created } };
    },
  }),
];
