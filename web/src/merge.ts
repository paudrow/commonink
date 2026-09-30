import { diffLines } from "diff";
import { diff3Merge } from "node-diff3";

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Minimal line-level edits turning `a` into `b`, as CodeMirror changes (positions in `a`),
 * plus the ranges that changed in `b` (for highlighting).
 */
export function editsBetween(a: string, b: string): { changes: Edit[]; touched: Array<{ from: number; to: number }> } {
  const parts = diffLines(a, b);
  const changes: Edit[] = [];
  const touched: Array<{ from: number; to: number }> = [];
  let pa = 0;
  let pb = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const len = p.value.length;
    if (!p.added && !p.removed) {
      pa += len;
      pb += len;
    } else if (p.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        changes.push({ from: pa, to: pa + len, insert: next.value });
        touched.push({ from: pb, to: pb + next.value.length });
        pb += next.value.length;
        i++;
      } else {
        changes.push({ from: pa, to: pa + len, insert: "" });
        touched.push({ from: pb, to: pb });
      }
      pa += len;
    } else {
      changes.push({ from: pa, to: pa, insert: p.value });
      touched.push({ from: pb, to: pb + len });
      pb += len;
    }
  }
  return { changes, touched };
}

/**
 * Three-way line merge of our buffer and their disk version against the common base. Changes to
 * neighbouring lines, or lines both sides added at the same place, are kept together; only both
 * sides changing the same lines is a conflict.
 */
export function merge3(base: string, ours: string, theirs: string): { ok: true; text: string } | { ok: false } {
  // Each last line with its newline: otherwise text added after it reads as a change to that line.
  const split = (s: string) => (s && !s.endsWith("\n") ? `${s}\n` : s).split(/(?<=\n)/);
  let text = "";
  for (const region of diff3Merge(split(ours), split(base), split(theirs), { excludeFalseConflicts: true })) {
    const lines = region.ok ?? (region.conflict && resolve(region.conflict));
    if (!lines) return { ok: false };
    text += lines.join("");
  }
  // Whether it ends in a newline is merged too: ours, unless only theirs changed it.
  const lacks = (s: string) => s !== "" && !s.endsWith("\n");
  if ((lacks(ours) === lacks(base) ? lacks(theirs) : lacks(ours)) && text.endsWith("\n")) text = text.slice(0, -1);
  return { ok: true, text };
}

/**
 * The lines for a region diff3 calls a conflict, when every change in it came from one side: `a`
 * ours, `o` the base, `b` theirs. Null when both sides changed the same lines.
 */
function resolve({ a, o, b }: { a: string[]; o: string[]; b: string[] }): string[] | null {
  const starts = (x: string[], y: string[]) => x.length >= y.length && y.every((l, i) => x[i] === l);
  const ends = (x: string[], y: string[]) => x.length >= y.length && y.every((l, i) => x[x.length - y.length + i] === l);
  // Both only added lines, at the same place: theirs, then ours.
  if (!o.length) return [...b, ...a];
  // One side only added lines after (or before) what the other changed.
  if (starts(b, o)) return [...a, ...b.slice(o.length)];
  if (starts(a, o)) return [...b, ...a.slice(o.length)];
  if (ends(b, o)) return [...b.slice(0, b.length - o.length), ...a];
  if (ends(a, o)) return [...a.slice(0, a.length - o.length), ...b];
  // The same number of lines on every side: each line as whichever side changed it.
  if (a.length !== o.length || b.length !== o.length) return null;
  const out = o.map((line, i) => (a[i] === line ? b[i] : b[i] === line || b[i] === a[i] ? a[i] : null));
  return out.every((l) => l !== null) ? (out as string[]) : null;
}
