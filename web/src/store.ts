/** This browser's preferences, in localStorage under `commonink.*`. */
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`commonink.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`commonink.${k}`, JSON.stringify(v));
    } catch {}
  },
};
