// Tasks: list, add in words, change tokens, tick, repeat, move and remove; and the day at a glance.
import { VaultError } from "../paths.ts";
import { fmtTasks, fmtToday, fmtWrite } from "../format.ts";
import type { Vault } from "../vault.ts";
import { parseTask, type BacklogScope, type TaskPatch } from "../tasks.ts";
import { actorOf } from "../actor.ts";
import { bool, command, list, num, str } from "./types.ts";

const LINE = "The task's line, as list_tasks showed it (path:line)";
const TEXT = "The task's text after the checkbox, as list_tasks showed it (guards against the note having changed).";
const TEXT_CLI = " On the CLI it's looked up from the line when left out.";

/** A task's text, given, or read from its line (the CLI's way: people name a task by where it is). */
function taskText(vault: Vault, note: string, line: number, text: string | undefined): string {
  if (text !== undefined) return text;
  const task = vault.tasks({ note, backlog: "include" }).find((t) => t.line === line);
  if (!task) throw new VaultError(`There's no task on line ${line} of ${note}`, "not_found");
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
    summary: "Checkbox tasks across the vault, with their tokens, filtered by tag, person, priority or date",
    description:
      "Checkbox tasks across the vault (not archived notes), as their markdown lines with path:line. A task's metadata is tokens in " +
      "its text: due:YYYY-MM-DD, start:YYYY-MM-DD, rec:… (how it repeats), #tag, @person, !high or !low, and done:YYYY-MM-DD once ticked. " +
      "A tag on a task tags the task, not its note. @ followed by a letter is a person; write \\@word for an @ that isn't one. " +
      "Tasks in the Backlog (backlog:YYYY-MM-DD, the day they went) are left out unless backlog asks for them: an open task untouched for the workspace's " +
      "auto_backlog_days (30 by default, in Config/Settings.md) moves there on its own, unless it's tagged #dont-backlog.",
    examples: ["commonink tasks", "commonink tasks --tag work --due '<=today'", "commonink tasks --due '>=today <=+7d' --priority high", "commonink tasks --done-date '>=-7d'","commonink tasks --assignee jane --all --json", "commonink tasks --assignee me", "commonink tasks --by me", "commonink tasks --backlog only"],
    readOnly: true,
    args: {
      status: str({ enum: ["open", "done", "all"], presets: { done: "done", all: "all" }, describe: "Default open" }),
      folder: str(),
      note: str({ describe: "Only this note's tasks" }),
      tag: str({ describe: "Only tasks with this tag or a tag under it" }),
      assignee: str({ describe: 'Only tasks for this person (every @name that\'s theirs), or "me" for the tasks of the person you work for (@me locally)' }),
      by: str({ enum: ["me"], describe: '"me": tasks your person gave someone else, in notes they made' }),
      due: str({ describe: 'A due date filter: <=today (overdue or due today), tomorrow, >=2026-10-01, or a range like ">=today <=+7d" (+7d, -2w, +1m count from today)' }),
      start: str({ describe: 'A start date filter, the same way as due: ">=today <=+7d" for the tasks starting this week' }),
      done: str({ flag: "done-date", describe: 'A done date filter, the same way as due: ">=-7d" for what was ticked in the last week (lists done tasks unless a status is given)' }),
      priority: str({ describe: "high, low or none, or several with commas (high,none)" }),
      backlog: str({ enum: ["include", "only"], describe: "Tasks in the Backlog are left out by default: include lists them with the rest, only lists just them" }),
    },
    run: async ({ vault, user, source, members }, { status, by, ...filters }) => {
      // Asking when tasks were done means the done ones, unless the status says otherwise.
      const want = status ?? (filters.done ? "done" : "open");
      const people = filters.assignee || by ? ((await members?.()) ?? []) : [];
      const person = actorOf(source).person ?? user;
      const found = vault.tasksFor({ user, person, members: people }, { ...filters, by: by as "me" | undefined, backlog: filters.backlog as BacklogScope | undefined }).filter((t) => want === "all" || t.done === (want === "done"));
      return { text: fmtTasks(found), data: found };
    },
  }),
  command({
    cli: "task add",
    mcp: "add_task",
    route: "POST /tasks/add",
    title: "Add task",
    summary: "Add a task in words: dates and repeats become tokens; it goes to today's journal note or → [[Note]]",
    description:
      "Add a task written the way you'd say it: dates and repeats in words become tokens (\"Pay rent every month on the 1st #home\" → " +
      "due:… rec:1st #home; \"call mom tomorrow\", \"next fri\", \"oct 3\", \"in 2 weeks\", \"every other week\", \"last friday of the month\", " +
      "\"every 3 days after done\"). Tokens (due:, !high, @person, #tag) pass through. It goes under ## Tasks in today's journal note " +
      "(Journal/YYYY-MM-DD.md, created if needed), or into the note named with → [[Note]] (at the end of its Tasks section, or of the note, above a footer).",
    examples: ['commonink task add "Pay rent every month on the 1st #home"', 'commonink task add "Review the PR next fri → [[Launch]] @sam"'],
    args: {
      text: str({ required: true, pos: "rest", stdin: true, missing: 'Say what the task is: commonink task add "Call mom tomorrow"', describe: 'The task, e.g. "Review the PR next fri → [[Launch]] @sam"' }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.addTask(a.text, source);
      return { text: `Added "- [ ] ${r.text}" to ${r.path}:${r.line}`, data: r };
    },
  }),
  command({
    cli: "task update",
    mcp: "update_task",
    route: "POST /tasks/update",
    title: "Update task",
    summary: 'Tick, untick, change one task\'s tokens ("none" clears one), or move it to or from the Backlog',
    description:
      "Tick, untick or change the metadata of one task, by the path:line and text list_tasks gave. Only the fields you pass change: " +
      "a value sets that token, null (or [] for lists) removes it, and the rest of the line stays as the user wrote it. Ticking adds done: with today's date; " +
      "ticking a repeating task (rec:) also adds its next occurrence on the line below, and unticking it straight after takes that back. " +
      "backlog: true moves it to the Backlog (out of Today and the task lists, kept in its note with backlog:<today>); false brings it back.",
    examples: ["commonink task Roadmap 8 --due 2026-10-01 --priority high", "commonink task Roadmap 8 --done", "commonink task Bills 3 --rec 6th --until 2027-06-30", "commonink task Roadmap 8 --due none", "commonink task Roadmap 8 --to-backlog", "commonink task Roadmap 8 --from-backlog"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
      done: bool({ presets: { undone: false }, describe: "Tick (true) or untick (false)" }),
      ...TASK_FIELDS,
      backlog: bool({ flag: "to-backlog", presets: { "from-backlog": false }, describe: "Move it to the Backlog (true), or bring it back (false)" }),
      skip: bool({ describe: "Move a repeating task to its next date without ticking it (on its own: other fields are ignored)" }),
    },
    run: ({ vault, source }, { path, line, text, done, skip, backlog, ...fields }) => {
      const t = taskText(vault, path, line, text);
      // In the Backlog already, it keeps the day it went.
      const since = backlog === undefined ? undefined : backlog ? (parseTask(`- [ ] ${t}`)?.meta.backlog ?? vault.day()) : null;
      const patch = Object.fromEntries(Object.entries({ ...fields, checked: done, backlog: since }).filter(([, v]) => v !== undefined)) as TaskPatch;
      const r = skip ? vault.skipTask(path, line, t, source) : vault.updateTask(path, line, t, patch, source);
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
    examples: ["commonink task move Journal/2026-09-28 5 --to Launch"],
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
      to: str({ required: true, describe: "The note to move it to" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.moveTask(a.path, a.line, taskText(vault, a.path, a.line, a.text), a.to, source);
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
    examples: ["commonink task remove Inbox 4"],
    destructive: true,
    args: {
      path: str({ required: true, pos: 0, label: "note", describe: "The note the task is in" }),
      line: num({ required: true, pos: 1, min: 1, describe: LINE }),
      text: str({ mcpRequired: true, describe: TEXT + TEXT_CLI }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.removeTask(a.path, a.line, taskText(vault, a.path, a.line, a.text), source);
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
      "The day at a glance: open tasks overdue, due today and starting today (repeating ones show their rec:; none from the Backlog), and whether today's " +
      "journal note (Journal/YYYY-MM-DD.md) exists. A good start for a morning brief.",
    examples: ["commonink today", "commonink today --date 2026-10-01 --json"],
    readOnly: true,
    args: { today: str({ flag: "date", describe: "The day to read, YYYY-MM-DD; default the user's today" }) },
    run: ({ vault }, a) => {
      const t = vault.today(a.today);
      return { text: fmtToday(t), data: t };
    },
  }),
  command({
    cli: "journal",
    mcp: "open_journal",
    route: "POST /today/journal",
    title: "Open journal",
    summary: "Today's journal note, made from the journal template if it's missing",
    description: "Today's journal note (Journal/YYYY-MM-DD.md): its path, made from Templates/Journal.md (or Templates/Daily note.md, its old name, or a plain one) if it doesn't exist yet.",
    examples: ["commonink journal", "commonink journal --date 2026-10-01"],
    args: { today: str({ flag: "date", describe: "The day, YYYY-MM-DD; default the user's today" }) },
    run: ({ vault, source }, a) => {
      const r = vault.dailyNote(a.today ?? vault.today().date, source);
      return { text: `${r.created ? "Started" : "Already there:"} ${r.path}`, data: { path: r.path, created: r.created } };
    },
  }),
];
