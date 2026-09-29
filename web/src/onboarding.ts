// The Getting started checklist ticks itself. When you do one of its things (type /, link a note,
// search, star, tick a task), the guide ticks that box in the note: a live edit by "Guide" that
// arrives like any agent's, highlighted and tagged with its name, with a toast. The server works
// out every edit (src/core/guide.ts); this says what you did, and keeps the checklist's state for
// the ::guide widgets. If the checklist goes (deleted, archived), the guide stops.
import { api, type GuideState, type ServerMsg } from "./api.ts";
import { DIDS, didEvents } from "./events.ts";
import { isSelf } from "./dom.ts";
import { GUIDE, guideState, type GuideAction } from "../../src/core/guide.ts";

let state: GuideState | null = null;
/** The start note, kept while its checklist is gone so that undoing the deletion brings the guide back. */
let path: string | null = null;
/** The demo line has been in the note, so its going means you took it back. */
let sawDemo = false;
const inFlight = new Set<GuideAction>();
const watchers = new Set<(s: GuideState | null) => void>();
let hooks = { archive(_path: string) {}, flush: async () => {} };

/**
 * Start listening. `archive` archives a note (the checklist's last card offers it for the start
 * note); `flush` saves any typing not yet saved, so the guide writes on top of it rather than beside it.
 */
export async function startGuide(h: typeof hooks) {
  hooks = h;
  for (const step of DIDS) didEvents.addEventListener(step, () => void act(step));
  set(await api.guide().catch(() => null));
}

/** Call `fn` with the checklist now and whenever it changes. Returns a function that stops it. */
export function watchGuide(fn: (s: GuideState | null) => void): () => void {
  watchers.add(fn);
  fn(state);
  return () => void watchers.delete(fn);
}

export const archiveNote = (path: string) => hooks.archive(path);

function set(next: GuideState | null) {
  state = next;
  if (next) path = next.path;
  if (next?.demo) sawDemo = true;
  for (const fn of watchers) fn(state);
  if (!next) return;
  if (sawDemo && !next.demo && next.open.includes("watch")) void act("watch");
  if (!next.open.length && !next.finished) void act("finish");
}

const due = (s: GuideState, a: GuideAction) => (a === "demo" ? !s.demo : a === "finish" ? !s.open.length && !s.finished : s.open.includes(a));

/** Have the guide do `action`, if the checklist still needs it. */
export async function act(action: GuideAction): Promise<void> {
  if (!state || !due(state, action) || inFlight.has(action)) return;
  inFlight.add(action);
  try {
    await hooks.flush(); // a box you just ticked by hand is on the server before the guide looks
    set(await api.guideDo(action));
  } catch {
    // The note changed as the guide wrote, or it can't write here: the next thing you do tries again.
  } finally {
    inFlight.delete(action);
  }
}

/** A live update: the start note's new text, a move of it, or a change by an agent working for you (not a teammate's). */
export function guideMessage(m: ServerMsg) {
  if (m.type === "note" && m.path === path && m.content !== null) {
    const s = guideState(m.content);
    set(s && { path: m.path, ...s });
  } else if (m.type === "change" && path) {
    if (m.change.from_path === path && m.change.path !== path) {
      path = null; // renamed, archived: look again, and stop if it's gone
      void api.guide().then(set, () => {});
    } else if (m.change.agent && m.change.agent !== GUIDE && isSelf(m.change.person ?? "")) void act("connect");
  }
}
