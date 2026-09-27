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

/** Three-way line merge of our buffer and their disk version against the common base. */
export function merge3(base: string, ours: string, theirs: string): { ok: true; text: string } | { ok: false } {
  const split = (s: string) => s.split(/(?<=\n)/);
  let text = "";
  for (const region of diff3Merge(split(ours), split(base), split(theirs), { excludeFalseConflicts: true })) {
    if (region.ok) text += region.ok.join("");
    else return { ok: false };
  }
  return { ok: true, text };
}
