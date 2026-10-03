// A page's code (Tags, Query syntax, History…), fetched the first time the page is shown. Built
// files are named by their contents, so a deploy since this tab loaded (on a Preview, every push)
// takes away the names it knows, and the fetch fails. Left alone, that showed a blank page: the
// old page was hidden and the new one never drawn. Instead the app loads again, fresh, at the page
// asked for. If that fresh load can't fetch it either (offline, say), it says so rather than loop.

const RELOADED = "commonink:reloaded-for";
/** A fresh load this soon after the last one, for the same page, is the same failure again. */
const AGAIN_MS = 30_000;

export interface LazyEnv {
  /** A full page load of this address. */
  assign(url: string): void;
  storage(): Pick<Storage, "getItem" | "setItem"> | null;
  now(): number;
}

const browser: LazyEnv = {
  assign: (url) => location.assign(url),
  storage: () => {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
};

/**
 * `load` once, and the same page each time after. `at` is the page's address, loaded afresh when
 * its code can't be fetched; `failed` runs when that already happened, and the page never comes
 * (the promise doesn't settle), so nothing is drawn half-way.
 */
export function lazyPage<T>(at: string, load: () => Promise<T>, failed: (err: unknown) => void, env: LazyEnv = browser) {
  let loading: Promise<T> | null = null;
  return (): Promise<T> =>
    (loading ??= load().catch((err: unknown) => {
      loading = null; // a later try fetches again
      if (reloadOnce(at, env)) return new Promise<T>(() => {});
      failed(err);
      return new Promise<T>(() => {});
    }));
}

/** Loads `at` afresh, unless that was just tried; true when it did. */
function reloadOnce(at: string, env: LazyEnv) {
  const store = env.storage();
  if (!store) return false; // without a note of having tried, a failing page would reload forever
  try {
    const [page, when] = (store.getItem(RELOADED) ?? "").split(" ");
    if (page === at && env.now() - Number(when) < AGAIN_MS) return false;
    store.setItem(RELOADED, `${at} ${env.now()}`);
  } catch {
    return false;
  }
  env.assign(at);
  return true;
}
