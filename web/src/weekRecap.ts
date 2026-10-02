// "Your week", the Today page's week card (weekRecapCard.ts): a week, Monday to Sunday where you
// are, in a few lines: the days you wrote on, the notes you made and edited, the tasks ticked, what
// agents did for you, your busiest day and the note you kept coming back to. It's this week so far,
// except on the first visit of a new week, when it's last week's recap until you save or dismiss it.
// Pure, so it can be tested: the card reads the change log and the tasks, and draws what this works out.
import { addDays, localDate } from "../../src/core/tasks.ts";
import { mondayOf } from "./writingDays.ts";

/** What the recap needs of a change (see Change in api.ts). */
export interface RecapChange {
  ts: number;
  path: string;
  op: string;
  note_id: string | null;
  person: string | null;
  source: string;
  agent: string | null;
}

export interface WeekRecap {
  /** The week's Monday and Sunday, YYYY-MM-DD. */
  from: string;
  to: string;
  /** How many of its days you created or edited a note on. */
  wrote: number;
  /** Notes you made, and other notes you edited (one each, however many times). */
  created: number;
  edited: number;
  /** Tasks ticked done during the week (by their done: date). */
  ticked: number;
  /** Changes agents made for you. */
  agentEdits: number;
  /** The day you changed the most notes, and how many changes. */
  busiest: { day: string; changes: number } | null;
  /** The note you edited on the most days, when that's more than one. */
  revisited: { path: string; days: number } | null;
}

/** The week before `today`'s Monday. */
export const lastMonday = (today: string) => addDays(mondayOf(today), -7);

/**
 * Whether the card shows last week's recap: it's not yet been saved or dismissed this week (`seen`
 * is the Monday it last was), and last week had something in it.
 */
export const recapDue = (today: string, seen: string, last: WeekRecap) => seen !== mondayOf(today) && !quiet(last);

/** A week with nothing in it. */
export const quiet = (r: WeekRecap) => !r.wrote && !r.ticked && !r.agentEdits;

/** The week from `monday`, from the change log and the tasks. `self` says whether a change's person is you. */
export function weekRecap(
  changes: RecapChange[],
  tasks: Array<{ done: boolean; meta: { done: string | null } }>,
  monday: string,
  self: (who: string) => boolean,
  timeZone?: string,
): WeekRecap {
  const from = monday;
  const to = addDays(monday, 6);
  const inWeek = (day: string) => day >= from && day <= to;
  const made = new Set<string>();
  const touched = new Set<string>();
  const perDay = new Map<string, number>();
  const noteDays = new Map<string, { path: string; ts: number; days: Set<string> }>();
  let agentEdits = 0;
  for (const c of changes) {
    if (c.op !== "create" && c.op !== "edit") continue; // moves, archiving and the like aren't writing
    const day = localDate(c.ts, timeZone);
    if (!inWeek(day) || !self(c.person ?? c.source)) continue;
    if (c.agent) {
      agentEdits++;
      continue;
    }
    const key = c.note_id ?? c.path;
    (c.op === "create" ? made : touched).add(key);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const n = noteDays.get(key) ?? { path: c.path, ts: 0, days: new Set<string>() };
    if (c.ts >= n.ts) Object.assign(n, { path: c.path, ts: c.ts }); // where it is as of its latest change
    n.days.add(day);
    noteDays.set(key, n);
  }
  for (const k of made) touched.delete(k);
  const ticked = tasks.filter((t) => t.done && t.meta.done && inWeek(t.meta.done.slice(0, 10))).length;

  let busiest: WeekRecap["busiest"] = null;
  for (const [day, changes] of [...perDay].sort(([a], [b]) => a.localeCompare(b))) if (!busiest || changes > busiest.changes) busiest = { day, changes };
  let revisited: WeekRecap["revisited"] = null;
  let latest = 0;
  for (const n of noteDays.values()) {
    const days = n.days.size;
    if (days < 2) continue; // coming back means more than one day
    if (!revisited || days > revisited.days || (days === revisited.days && n.ts > latest)) ((revisited = { path: n.path, days }), (latest = n.ts));
  }
  return { from, to, wrote: perDay.size, created: made.size, edited: touched.size, ticked, agentEdits, busiest, revisited };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const weekday = (day: string) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
/** A note's name from its path: "Projects/Plan.md" is "Plan". */
export const noteTitle = (path: string) => path.replace(/^.*\//, "").replace(/\.(md|html)$/, "");

/** The recap's lines, as the card and the saved note both say them; what's zero is left out, but for the days you wrote. */
export function recapLines(r: WeekRecap): string[] {
  const lines = [`You wrote on ${r.wrote} of 7 days`];
  if (r.created && r.edited) lines.push(`${plural(r.created, "note")} created, ${r.edited} more edited`);
  else if (r.created || r.edited) lines.push(`${plural(r.created || r.edited, "note")} ${r.created ? "created" : "edited"}`);
  if (r.ticked) lines.push(`${plural(r.ticked, "task")} ticked off`);
  if (r.agentEdits) lines.push(`${plural(r.agentEdits, "edit")} by agents for you`);
  if (r.busiest) lines.push(`Busiest day: ${weekday(r.busiest.day)}, with ${plural(r.busiest.changes, "change")}`);
  return lines;
}

/** Where "Save as journal note" puts it: beside the daily notes, named for the week's Monday. */
export const recapPath = (r: WeekRecap) => `Journal/Week of ${r.from}.md`;

/** The saved note: a heading that names it, the lines, and a link to the note you came back to. */
export function recapMarkdown(r: WeekRecap): string {
  const lines = recapLines(r).map((l) => `- ${l}`);
  if (r.revisited) lines.push(`- Came back to most: [[${noteTitle(r.revisited.path)}]], on ${plural(r.revisited.days, "day")}`);
  return `# Week of ${r.from}\n\n${r.from} to ${r.to}\n\n${lines.join("\n")}\n`;
}
