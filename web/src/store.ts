/** This browser's preferences, in localStorage under `quire.*`. */
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`quire.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`quire.${k}`, JSON.stringify(v));
    } catch {}
  },
};
