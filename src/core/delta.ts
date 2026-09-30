// A text as the edits that turn another text into it, the way the change log keeps older versions
// of a note (see changeTexts.ts). Like a git packfile's deltas: copy a stretch of the base, or
// insert new text. Stored as JSON, `[at, length]` for a copy and a string for an insert, so any
// string survives (JSON escapes a lone surrogate) and small edits to a long note stay small.
import { diffLines } from "diff";

type Op = [number, number] | string;

/** The edits that turn `base` into `target`. */
export function makeDelta(base: string, target: string): string {
  let head = 0;
  const most = Math.min(base.length, target.length);
  while (head < most && base.charCodeAt(head) === target.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < most - head && base.charCodeAt(base.length - 1 - tail) === target.charCodeAt(target.length - 1 - tail)) tail++;
  const ops: Op[] = [];
  const copy = (at: number, length: number) => {
    const last = ops[ops.length - 1];
    if (!length) return;
    if (Array.isArray(last) && last[0] + last[1] === at) last[1] += length;
    else ops.push([at, length]);
  };
  const insert = (text: string) => {
    if (!text) return;
    if (typeof ops[ops.length - 1] === "string") ops[ops.length - 1] += text;
    else ops.push(text);
  };
  copy(0, head);
  const from = base.slice(head, base.length - tail);
  const to = target.slice(head, target.length - tail);
  // Past a few thousand edits a line diff turns quadratic; the middle is then just new text.
  const parts = from && to ? diffLines(from, to, { maxEditLength: 2000 }) : undefined;
  if (parts) {
    let at = head;
    for (const p of parts) {
      if (p.added) insert(p.value);
      else if (p.removed) at += p.value.length;
      else {
        copy(at, p.value.length);
        at += p.value.length;
      }
    }
  } else insert(to);
  copy(base.length - tail, tail);
  return JSON.stringify(ops);
}

/** `base` with `delta`'s edits applied: the `target` makeDelta was given. */
export function applyDelta(base: string, delta: string): string {
  let out = "";
  for (const op of JSON.parse(delta) as Op[]) out += typeof op === "string" ? op : base.slice(op[0], op[0] + op[1]);
  return out;
}
