// "While you were away": what agents did since you last changed anything yourself, as one line at
// the top of Notes and Today ("Claude edited 4 notes and added 6 tasks while you were away").
// No Node imports: the web app writes the line from the summary with awayLine.
import { parseTask, TASK_LINE } from "./tasks.ts";

export interface AwaySummary {
  /** The agents that made the changes, most active first. */
  agents: string[];
  /** Notes the agents created, and other notes they changed (edited, moved, archived, deleted). */
  created: number;
  edited: number;
  /** Task lines the agents added, and open tasks they ticked. */
  tasksAdded: number;
  tasksDone: number;
  /** The span: changes after `after` up to `last`, by change id, from `from` to `to` in time. */
  after: number;
  last: number;
  from: number;
  to: number;
}

/** A note's task lines by their words (tokens like due: left out), each with whether it's ticked. */
function tasksIn(text: string | null): Array<{ key: string; done: boolean }> {
  if (!text) return [];
  const out: Array<{ key: string; done: boolean }> = [];
  for (const line of text.split("\n")) {
    if (!TASK_LINE.test(line)) continue;
    const t = parseTask(line);
    if (t) out.push({ key: t.summary.trim().toLowerCase(), done: t.done });
  }
  return out;
}

/** Tasks added from `before` to `after`, and open tasks that got ticked. A task that only moved counts for nothing. */
export function taskChanges(before: string | null, after: string | null): { added: number; done: number } {
  const was = new Map<string, Array<boolean>>();
  for (const t of tasksIn(before)) was.set(t.key, [...(was.get(t.key) ?? []), t.done]);
  let added = 0;
  let done = 0;
  for (const t of tasksIn(after)) {
    const left = was.get(t.key);
    if (!left?.length) {
      added++;
      continue;
    }
    // The same task as it was, if it's there; otherwise its box changed, which counts if it got ticked.
    const same = left.indexOf(t.done);
    if (same < 0 && t.done) done++;
    left.splice(Math.max(same, 0), 1);
  }
  return { added, done };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names as a sentence: "Claude", "Claude and Codex", "Claude, Codex and 2 more". */
function names(agents: string[]): string {
  if (agents.length <= 1) return agents[0] ?? "An agent";
  if (agents.length === 2) return `${agents[0]} and ${agents[1]}`;
  return `${agents[0]}, ${agents[1]} and ${count(agents.length - 2, "more agent")}`;
}

/** The line: "Claude edited 4 notes and added 6 tasks while you were away". */
export function awayLine(s: AwaySummary): string {
  const did = [
    s.created ? `created ${count(s.created, "note")}` : "",
    s.edited ? `${s.created ? "changed" : "edited"} ${count(s.edited, s.created ? "other note" : "note")}` : "",
    s.tasksAdded ? `added ${count(s.tasksAdded, "task")}` : "",
    s.tasksDone ? `checked off ${count(s.tasksDone, "task")}` : "",
  ].filter(Boolean);
  const list = did.length > 1 ? `${did.slice(0, -1).join(", ")} and ${did.at(-1)}` : did[0] ?? "made changes";
  return `${names(s.agents)} ${list} while you were away`;
}
