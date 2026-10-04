// GitHub issue and pull request cards: a github.com issue or PR link on its own line shows its title,
// state, labels and activity instead of a plain link card. The data comes from GitHub's REST API,
// fetched server-side. Only api.github.com is ever fetched (the owner, repo and number are checked
// before they go into the path), and a redirect is only followed when it stays there, as GitHub does
// for a moved repo or a transferred issue. Without a token GitHub allows 60 requests an hour per
// address, so cards are cached for a few minutes; GITHUB_TOKEN raises that and reaches private repos.
// Online, someone who connected their own GitHub account (cloud/src/github.ts) is answered with their
// token, and what it reads is kept apart from everyone else's cards (`as`).
import { readCapped } from "./unfurl.ts";

export interface GithubRef {
  owner: string;
  repo: string;
  number: number;
}

export type GithubState = "open" | "closed" | "merged" | "draft";

export interface GithubCard {
  /** The issue's or pull request's page on github.com. */
  url: string;
  /** "owner/repo". */
  repo: string;
  number: number;
  kind: "issue" | "pull";
  title: string;
  state: GithubState;
  /** Why a closed issue was closed: done, or not planned (shown greyed). */
  reason: "completed" | "not_planned" | null;
  /** Each label's name and hex color ("d73a4a", no "#"), or null where GitHub's isn't one. */
  labels: Array<{ name: string; color: string | null }>;
  author: string | null;
  comments: number;
  /** ISO 8601. */
  updatedAt: string;
}

export const GITHUB_API = "https://api.github.com";
const TTL = 5 * 60_000;
/** A failure (rate limit, private repo, offline) is retried sooner than a card is refreshed. */
const FAIL_TTL = 60_000;
const TIMEOUT = 6000;
const MAX_BYTES = 512 * 1024;
const CACHE_SIZE = 500;

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** https://github.com/owner/repo/issues/12 or /pull/12 (with /files, ?query or #comment after it) → its parts. */
export function githubRef(url: string): GithubRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "github.com" || u.port || u.username || u.password) return null;
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d{1,9})(?:\/[\w-]+)*\/?$/);
  if (!m || !NAME.test(m[1]) || !NAME.test(m[2]) || /^\.+$/.test(m[2])) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

const cache = new Map<string, { at: number; ttl: number; value: Promise<GithubCard | null> }>();

export interface GithubCardOptions {
  token?: string;
  api?: string;
  timeout?: number;
  /** Whose token it is, when it's one person's: their cards are kept for them alone, never served to anyone else. */
  as?: string;
  /** Called when GitHub says the token is no good (a 401): it was revoked or has run out. */
  rejected?: () => Promise<void> | void;
}

/** The card for a github.com issue or PR link, or null when it isn't one or GitHub won't say. */
export function githubCard(url: string, opts: GithubCardOptions = {}): Promise<GithubCard | null> {
  const ref = githubRef(url);
  if (!ref) return Promise.resolve(null);
  // A space can't be in an owner's name, so one person's cards can't be mistaken for the shared ones.
  const key = `${opts.as ?? ""} ${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry = { at: Date.now(), ttl: TTL, value: Promise.resolve<GithubCard | null>(null) };
  entry.value = fetchCard(ref, opts.api ?? GITHUB_API, opts.token, opts.timeout ?? TIMEOUT, opts.rejected)
    .catch(() => null)
    .then((card) => {
      if (!card) entry.ttl = FAIL_TTL;
      return card;
    });
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!); // the oldest
  return entry.value;
}

async function fetchCard(ref: GithubRef, api: string, token: string | undefined, timeout: number, rejected?: () => Promise<void> | void): Promise<GithubCard | null> {
  const origin = new URL(api).origin;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "CommonInk",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const signal = AbortSignal.timeout(timeout);
  // The issues endpoint answers for pull requests too, with their merge and draft state.
  let u = new URL(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, origin);
  for (let hop = 0; ; hop++) {
    const res = await fetch(u, { redirect: "manual", signal, headers });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      const next = new URL(loc, u);
      if (hop === 2 || next.origin !== origin) return null;
      u = next;
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      if (res.status === 401 && token) await rejected?.();
      return null;
    }
    return toCard(JSON.parse(await readCapped(res, MAX_BYTES)), ref);
  }
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** GitHub's issue JSON → a card, trusting nothing in it: every field is checked and capped. */
export function toCard(d: any, ref: GithubRef): GithubCard | null {
  if (!d || typeof d !== "object" || typeof d.number !== "number") return null;
  const pull = !!d.pull_request && typeof d.pull_request === "object";
  const closed = d.state === "closed";
  const state: GithubState = pull && d.pull_request.merged_at ? "merged" : closed ? "closed" : pull && d.draft === true ? "draft" : "open";
  const page = text(d.html_url, 500);
  const fallback = `https://github.com/${ref.owner}/${ref.repo}/${pull ? "pull" : "issues"}/${d.number}`;
  // The repo as GitHub names it now (after a rename or transfer), from its page link.
  const at = page?.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/\d+$/);
  return {
    url: at ? page! : fallback,
    repo: at ? `${at[1]}/${at[2]}` : `${ref.owner}/${ref.repo}`,
    number: d.number,
    kind: pull ? "pull" : "issue",
    title: text(d.title, 300) ?? `#${d.number}`,
    state,
    reason: closed && !pull ? (d.state_reason === "not_planned" ? "not_planned" : "completed") : null,
    labels: (Array.isArray(d.labels) ? d.labels : [])
      .slice(0, 20)
      .map((l: any) => ({ name: text(typeof l === "string" ? l : l?.name, 60), color: typeof l?.color === "string" && /^[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : null }))
      .filter((l: { name: string | null }) => l.name) as GithubCard["labels"],
    author: text(d.user?.login, 60),
    comments: typeof d.comments === "number" && d.comments >= 0 ? Math.floor(d.comments) : 0,
    updatedAt: typeof d.updated_at === "string" && !Number.isNaN(Date.parse(d.updated_at)) ? d.updated_at : new Date(0).toISOString(),
  };
}
