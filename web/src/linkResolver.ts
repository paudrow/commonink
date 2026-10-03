// A shared note's page re-renders on every live update, and each render checks its [[links]] one
// by one. This keeps that cheap: each link is asked about once for the page's lifetime (a check
// still in flight is shared, a failed one is asked again next time), a newer render stops an older
// one's checks, and a render checks at most `limit` distinct links.

export function linkResolver<T>(ask: (key: string) => Promise<T>, limit = 200) {
  const answers = new Map<string, Promise<T>>();
  let latest = 0;
  /** One render's checks: `current()` turns false once a newer render begins; `resolve` gives null past the limit. */
  return function begin() {
    const mine = ++latest;
    const asked = new Set<string>();
    return {
      current: () => mine === latest,
      resolve(key: string): Promise<T> | null {
        if (!asked.has(key) && asked.size >= limit) return null;
        asked.add(key);
        let answer = answers.get(key);
        if (!answer) {
          answer = ask(key);
          answers.set(key, answer);
          // Failures (busy, offline) aren't the answer: let a later render ask again.
          answer.catch(() => answers.get(key) === answer && answers.delete(key));
        }
        return answer;
      },
    };
  };
}
