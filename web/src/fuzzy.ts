/** Subsequence match with bonuses for word starts and runs. -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 0;
  const direct = s.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - s.length * 0.1 + (direct === 0 || /[\s/_-]/.test(s[direct - 1]) ? 200 : 0);
  let score = 0;
  let run = 0;
  let si = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, si);
    if (i < 0) return -1;
    run = i === si ? run + 1 : 0;
    score += 10 + run * 8 + (i === 0 || /[\s/_-]/.test(s[i - 1]) ? 15 : 0) - Math.min(i - si, 10);
    si = i + 1;
  }
  return score - s.length * 0.1;
}

