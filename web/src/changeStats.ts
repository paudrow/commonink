// The "+3 −1" beside an entry in History and Activity. An entry of several autosaves (groupChanges)
// shows the net change, as History's diff of it counts it, not the sum of each save's count: a line
// typed in one save and deleted in the next isn't a change. The server works it out from the texts.
import { api, type Change, type LineStat } from "./api.ts";
import { el } from "./dom.ts";

const known = new Map<string, LineStat | null>();
const loading = new Set<string>();

/** Change ids as compact ranges for the URL: [12, 13, 14, 20] → "12-14,20". */
export function toRanges(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return out.join(",");
}

/**
 * An entry's stat: a single save's own summary, or for several saves (`ids`, as toRanges writes
 * them) the net change once loadStats has it. Null while it isn't known, or for an upload.
 */
export function entryStat(entry: Change & { count: number }, ids: string): LineStat | null {
  if (entry.count > 1) return known.get(ids) ?? null;
  const m = entry.summary?.match(/^\+(\d+) −(\d+)$/);
  return m ? { add: Number(m[1]), del: Number(m[2]) } : null;
}

/** Fetch the net stats not known yet for these entries' ids. True if any arrived, so it's worth drawing again. */
export async function loadStats(sets: string[]): Promise<boolean> {
  const missing = [...new Set(sets)].filter((s) => !known.has(s) && !loading.has(s));
  let arrived = false;
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    chunk.forEach((s) => loading.add(s));
    const got = await api.diffStats(chunk).catch(() => null);
    chunk.forEach((s, k) => {
      loading.delete(s);
      if (got) known.set(s, got[k] ?? null);
    });
    arrived ||= !!got;
  }
  return arrived;
}

export const statEl = (s: LineStat) => el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${s.add}`), el("span", { class: "del" }, `−${s.del}`));
