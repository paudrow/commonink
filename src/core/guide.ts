// The Getting started guide: a checklist note (tagged `start`) whose boxes tick themselves as you
// try each thing, written into the note as the guide, the way any agent's edit arrives. Each box is
// found by a marker comment at the end of its task line (`<!-- guide:star -->`), so rewording it
// doesn't lose it. The guide only ever makes the few edits below, worked out here from the note's
// text; nothing a client sends ends up in the note. No Node imports: the web app uses this too.
import type { Vault } from "./vault.ts";
import { VaultError } from "./paths.ts";
import { TASK_LINE } from "./tasks.ts";
import { parseDirective } from "./directive.ts";

/** Who the guide's edits are by: an agent, working for whoever did the thing it ticked. */
export const GUIDE = "Guide";
export const START_TAG = "start";

/** The things to try, in the checklist's order. */
export const GUIDE_STEPS = ["slash", "link", "search", "star", "tick", "watch", "connect"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];
/** Tick a step, show the demo edit, or add the closing line once every box is ticked. */
export type GuideAction = GuideStep | "demo" | "finish";

export interface GuideState {
  path: string;
  open: GuideStep[];
  done: GuideStep[];
  /** The demo line is in the note (added, not yet taken back). */
  demo: boolean;
  /** The closing "You're set" line is in the note. */
  finished: boolean;
}

const MARKER = /<!--\s*guide:([a-z]+)\s*-->/;
const mark = (name: string) => `<!-- guide:${name} -->`;
const isStep = (s: string): s is GuideStep => (GUIDE_STEPS as readonly string[]).includes(s);

export const DEMO_TEXT = `Hi, I'm the guide. I just wrote this line into your note, the way an agent you connect would: live, highlighted, with my name on it. Press ⌘Z (Ctrl+Z off a Mac) to take it back. ${mark("demo")}`;
export const FINISHED_TEXT = `**You're set.** That's the tour. [[Tips]] has markup, embeds and keys, and [[Overview]] shows your workspace at a glance. This note has done its job, so archive it whenever you like. ${mark("finished")}`;

/** A request's action, checked at the boundary. */
export function parseGuideAction(s: string): GuideAction {
  if (isStep(s) || s === "demo" || s === "finish") return s;
  throw new VaultError(`"action" must be one of ${[...GUIDE_STEPS, "demo", "finish"].join(", ")}`);
}

/** Which boxes are ticked in a start note's text; null if it has none of the guide's (the checklist is gone). */
export function guideState(content: string): Omit<GuideState, "path"> | null {
  const open: GuideStep[] = [];
  const done: GuideStep[] = [];
  for (const line of content.split("\n")) {
    const step = line.match(MARKER)?.[1];
    const task = line.match(TASK_LINE);
    if (!task || !step || !isStep(step) || open.includes(step) || done.includes(step)) continue;
    (task[2] === " " ? open : done).push(step);
  }
  if (!open.length && !done.length) return null;
  return { open, done, demo: content.includes(mark("demo")), finished: content.includes(mark("finished")) };
}

const markerOf = (line: string) => line.match(MARKER)?.[1];
const guideWidget = (line: string, step: string) => {
  const d = parseDirective(line);
  return d?.name === "guide" && d.args.step === step;
};

/** The start note's text after `action`: the boxes and lines the guide adds, and nothing else. */
export function guideNext(content: string, action: GuideAction): string {
  const lines = content.split("\n");
  if (isStep(action)) {
    const i = lines.findIndex((l) => TASK_LINE.test(l) && markerOf(l) === action);
    if (i >= 0) lines[i] = lines[i].replace(TASK_LINE, (_m, a: string, _box: string, b: string, rest: string, cr: string) => `${a}x${b}${rest}${cr}`);
  }
  if (action === "demo" && !content.includes(mark("demo"))) {
    const task = lines.findIndex((l) => TASK_LINE.test(l) && markerOf(l) === "watch");
    const widget = lines.findIndex((l, i) => i > task && guideWidget(l, "watch"));
    const after = widget >= 0 ? widget : task;
    if (after >= 0) {
      const indent = widget >= 0 ? lines[widget].match(/^\s*/)![0] : "  ";
      lines.splice(after + 1, 0, "", indent + DEMO_TEXT);
    }
  }
  const state = guideState(lines.join("\n"));
  if (state && !state.open.length && !state.finished) {
    const at = lines.findIndex((l) => guideWidget(l, "done"));
    if (at >= 0) lines.splice(at, 0, lines[at].match(/^\s*/)![0] + FINISHED_TEXT, "");
  }
  return lines.join("\n");
}

/**
 * `before` → `after` as one exact-string replacement: the lines that differ, widened by a line at a
 * time until the old text occurs just once. Null if nothing changed.
 */
export function asReplacement(before: string, after: string): { oldString: string; newString: string } | null {
  if (before === after) return null;
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  for (;;) {
    const oldString = a.slice(start, a.length - end).join("\n");
    if (oldString && before.split(oldString).length === 2) return { oldString, newString: b.slice(start, b.length - end).join("\n") };
    if (start > 0) start--;
    else if (end > 0) end--;
    else return { oldString: before, newString: after };
  }
}

/** The active note tagged `start` that still has the guide's checklist: its state, text and version. */
export function findStartNote(vault: Vault): { state: GuideState; content: string; version: string } | null {
  for (const n of vault.list(undefined, "active", START_TAG)) {
    const content = n.kind === "md" ? vault.files.read(n.path) : null;
    const state = content === null ? null : guideState(content);
    if (state) return { state: { path: n.path, ...state }, content: content!, version: n.version };
  }
  return null;
}

/**
 * Do `action` in the start note, if there is one and it has something to do, through the same
 * exact-string edit agents use, at the version just read. `source` is the guide working for the
 * person who asked (see agentSource).
 */
export function runGuide(vault: Vault, action: GuideAction, source: string) {
  const note = findStartNote(vault);
  if (!note) return { state: null, write: null };
  const { state, content, version } = note;
  const edit = asReplacement(content, guideNext(content, action));
  if (!edit) return { state, write: null };
  const r = vault.edit(state.path, { ...edit, baseVersion: version }, source);
  const next = vault.files.read(state.path)!;
  return { state: { path: state.path, ...guideState(next)! }, write: { path: state.path, content: next, version: r.version, change: r.change } };
}
