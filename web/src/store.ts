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

/**
 * Pull request Previews (pr-12-commonink.<subdomain>.workers.dev) and local development
 * (localhost), where Common Ink is tested. A few defaults differ there: Vim keys start on, as the
 * people testing it use them. Everywhere else (v1.commonink.app) a new user gets the usual defaults.
 */
export function isTestSite(host = location.hostname): boolean {
  return /^pr-\d+-commonink\./.test(host) || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
