// GitHub, connected per person: someone signs in to GitHub once (Settings → Integrations), and the
// issue and pull request cards they're shown (src/core/github.ts) are read with their own token, so
// the private repos they can see get cards too. It's only ever their own: someone else reading the
// same note, shared or not, is answered with their own connection, or with the server's shared
// GITHUB_TOKEN (public repos) when they have none. The grant lives in D1 (`connections`), its token
// sealed under INTEGRATIONS_KEY (secrets.ts) like Google's; it's sent to api.github.com and nowhere
// else, and no response carries it. Where GitHub isn't configured, Previews and local development
// get a stand-in with one demo private issue; production says it isn't configured.
import { GITHUB_API, githubRef, type GithubCard } from "../../src/core/github.ts";
import type { Unfurl, UnfurlOptions } from "../../src/core/unfurl.ts";
import { b64url, cookie, page, readSession, seal, setCookie, text, unseal } from "./auth.ts";
import { found } from "./connections.ts";
import { appPath } from "./drive.ts";
import type { Env } from "./env.ts";
import { decrypt, encrypt } from "./secrets.ts";

export type GithubMode = "real" | "mock" | "off";

/** Real GitHub when it's configured; the stand-in only where developer sign-in is on, which production never is. */
export function githubMode(env: Pick<Env, "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "INTEGRATIONS_KEY" | "DEV_LOGIN">): GithubMode {
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.INTEGRATIONS_KEY) return "real";
  return env.DEV_LOGIN === "1" ? "mock" : "off";
}

/**
 * What connecting asks GitHub for. An OAuth app has no narrower way to read a private repo's issues
 * and pull requests than `repo`, which also allows writing; Common Ink only ever reads (GETs) with it.
 */
export const GITHUB_SCOPE = "repo";

/** Where GitHub is: its site (OAuth) and its API. Tests point both at a stand-in (GITHUB_BASE). */
const endpoints = (env: Env) => ({ web: env.GITHUB_BASE ?? "https://github.com", api: env.GITHUB_BASE ?? GITHUB_API });

/** The sealing key: INTEGRATIONS_KEY, or for the stand-in's fake token one made from SESSION_SECRET. */
async function keyOf(env: Env): Promise<string | undefined> {
  if (githubMode(env) !== "mock") return env.INTEGRATIONS_KEY;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mock-integrations:${env.SESSION_SECRET}`));
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

const context = (user: string) => `${user}:github:access`;

interface Row {
  account: string;
  access_enc: string;
  created_at: number;
}

const row = (env: Env, user: string) => env.DB.prepare("SELECT account, access_enc, created_at FROM connections WHERE user_id = ? AND provider = 'github'").bind(user).first<Row>();

/** What the app may know about someone's GitHub connection: never the token. */
export interface GithubConnection {
  /** Their GitHub login. */
  account: string;
  connectedAt: number;
}

export async function githubConnection(env: Env, user: string): Promise<GithubConnection | null> {
  const r = await row(env, user);
  return r ? { account: r.account, connectedAt: r.created_at } : null;
}

/** Keep a grant. GitHub's tokens for an OAuth app don't run out, so there's no refresh token and no expiry (0). */
async function save(env: Env, user: string, token: string, scopes: string[], account: string) {
  await env.DB.prepare(
    `INSERT INTO connections(user_id, provider, account, scopes, access_enc, refresh_enc, expires_at, created_at) VALUES (?, 'github', ?, ?, ?, NULL, 0, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET account = excluded.account, scopes = excluded.scopes, access_enc = excluded.access_enc, created_at = excluded.created_at`,
  )
    .bind(user, account, scopes.join(" "), await encrypt(await keyOf(env), token, context(user)), Date.now())
    .run();
}

// ------------------------------------------------------------------ GitHub's side

const API_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "CommonInk" };

/** A sign-in code for a token (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). */
async function exchangeCode(env: Env, code: string, verifier: string, redirect: string): Promise<{ token: string; scopes: string[] }> {
  const res = await fetch(`${endpoints(env).web}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!, code, redirect_uri: redirect, code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  // GitHub answers 200 either way: a token, or an `error`.
  const r = (await res.json().catch(() => ({}))) as { access_token?: unknown; scope?: unknown };
  if (!res.ok || typeof r.access_token !== "string" || !r.access_token) throw new Error("GitHub gave no token");
  return { token: r.access_token, scopes: typeof r.scope === "string" ? r.scope.split(/[\s,]+/).filter(Boolean) : [] };
}

/** Whose token it is: their GitHub login. */
async function loginOf(env: Env, token: string): Promise<string> {
  const res = await fetch(`${endpoints(env).api}/user`, { headers: { ...API_HEADERS, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const r = (res.ok ? await res.json().catch(() => ({})) : {}) as { login?: unknown };
  if (typeof r.login !== "string" || !/^[A-Za-z0-9-]{1,60}$/.test(r.login)) throw new Error("GitHub didn't say who this is");
  return r.login;
}

/** Tell GitHub to forget the grant, which ends its token. Best effort. */
async function revokeGrant(env: Env, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoints(env).api}/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID!)}/grant`, {
      method: "DELETE",
      headers: { ...API_HEADERS, Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Forget the connection: GitHub revokes the grant, and the row goes. Returns whether there was one. */
export async function disconnectGithub(env: Env, user: string): Promise<boolean> {
  const r = await row(env, user);
  if (!r) return false;
  if (githubMode(env) === "real") {
    const token = await decrypt(await keyOf(env), r.access_enc, context(user)).catch(() => null);
    if (token) await revokeGrant(env, token);
  }
  await env.DB.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'github'").bind(user).run();
  return true;
}

// ------------------------------------------------------------------ cards

/** The stand-in's private repo: its one issue has a card only for someone who connected (the stand-in) GitHub. */
export const DEMO_ISSUE = "https://github.com/common-ink-demo/private/issues/1";
const DEMO_CARD: GithubCard = {
  url: DEMO_ISSUE,
  repo: "common-ink-demo/private",
  number: 1,
  kind: "issue",
  title: "A private issue, shown because you connected GitHub (a stand-in on this Preview)",
  state: "open",
  reason: null,
  labels: [{ name: "private", color: "5319e7" }],
  author: "octocat",
  comments: 2,
  updatedAt: "2026-10-01T12:00:00Z",
};

/** On Previews: the demo private issue's card, for someone connected to the stand-in. Null for anything else. */
export async function demoCard(env: Env, user: string, url: string): Promise<Unfurl | null> {
  if (githubMode(env) !== "mock") return null;
  const ref = githubRef(url);
  if (!ref || `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase() !== "common-ink-demo/private#1" || !(await row(env, user))) return null;
  return { url, title: DEMO_CARD.title, description: null, image: null, siteName: DEMO_CARD.repo, favicon: null, github: DEMO_CARD };
}

/**
 * What a link preview asked for by `user` reads GitHub with: the shared token, and for a GitHub issue
 * or PR link their own connection first, if they have one. A token GitHub refuses (revoked there, or
 * run out) ends the connection, so Settings says it needs connecting again.
 */
export async function githubOptions(env: Env, user: string, url: string): Promise<UnfurlOptions> {
  const opts: UnfurlOptions = { githubToken: env.GITHUB_TOKEN || undefined, githubApi: env.GITHUB_BASE };
  if (githubMode(env) !== "real" || !githubRef(url)) return opts;
  const r = await row(env, user);
  const token = r && (await decrypt(await keyOf(env), r.access_enc, context(user)).catch(() => null));
  if (!r || !token) return opts;
  // Only this same connection goes: one made again while GitHub was answering stays.
  const rejected = async () => void (await env.DB.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'github' AND created_at = ?").bind(user, r.created_at).run());
  return { ...opts, githubOwn: { token, as: user, rejected } };
}

// ------------------------------------------------------------------ connecting

const PENDING = "__Host-ci_gh";

interface Pending {
  state: string;
  verifier: string;
  user: string;
  /** Where in the app to come back to. */
  next: string;
  exp: number;
}

/** Where connecting ends: back where it started, with how it went (`?github=connected|denied|failed`). */
function back(url: URL, next: string, outcome: string) {
  let to = new URL(next, url.origin);
  if (to.origin !== url.origin) to = new URL("/", url.origin); // appPath made sure; this makes surer
  to.searchParams.set("github", outcome);
  return to.toString();
}

/**
 * /auth/github (start; `next` is where in the app to come back to), /auth/github/callback (GitHub
 * sends the person back, either way), and on Previews /auth/github/mock (the stand-in's consent page).
 */
export async function githubAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return found(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent("/")}`);
  const mode = githubMode(env);
  if (mode === "off") return notConfigured();
  const redirect = `${url.origin}/auth/github/callback`;

  switch (url.pathname) {
    case "/auth/github": {
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const pending = await seal(env.SESSION_SECRET, { state, verifier, user: user.id, next: appPath(url.searchParams.get("next")), exp: Date.now() + 10 * 60_000 } satisfies Pending);
      const cookies = [setCookie(PENDING, pending, 600)];
      if (mode === "mock") return found(`${url.origin}/auth/github/mock?state=${state}`, cookies);
      const auth = new URL(`${endpoints(env).web}/login/oauth/authorize`);
      auth.search = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID!,
        redirect_uri: redirect,
        scope: GITHUB_SCOPE,
        state,
        code_challenge: b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
        code_challenge_method: "S256",
      }).toString();
      return found(auth.toString(), cookies);
    }

    case "/auth/github/mock": {
      if (mode !== "mock") return text(404, "Not found");
      const pending = await unseal<Pending>(env.SESSION_SECRET, cookie(req, PENDING));
      const state = url.searchParams.get("state") ?? "";
      if (!pending || pending.state !== state || pending.user !== user.id) return text(400, "That connection expired. Start again from Settings.");
      if (req.method === "POST") {
        if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
        const allow = (await req.formData().catch(() => null))?.get("decision") === "allow";
        return found(`${redirect}?state=${state}&${allow ? "code=mock" : "error=access_denied"}`);
      }
      return page(
        200,
        `<h1>Stand-in for GitHub</h1>
         <p class="muted">This server has no GitHub OAuth app, so this page plays GitHub's part. Nothing here reaches GitHub.</p>
         <p>Common Ink would like to <b>read the issues and pull requests of your private repositories</b>.</p>
         <form method="post"><input type="hidden" name="decision" value="allow"><button type="submit">Allow</button></form>
         <form method="post"><input type="hidden" name="decision" value="deny"><button type="submit" style="background:none;color:inherit;border:1px solid var(--line)">Cancel</button></form>`,
      );
    }

    case "/auth/github/callback": {
      const pending = await unseal<Pending>(env.SESSION_SECRET, cookie(req, PENDING));
      const clear = [setCookie(PENDING, "", 0)];
      if (!pending || pending.state !== url.searchParams.get("state") || pending.user !== user.id) return text(400, "That connection expired or was tampered with. Start again from Settings.");
      const code = url.searchParams.get("code");
      if (!code) return found(back(url, pending.next, "denied"), clear);
      try {
        if (mode === "mock") await save(env, user.id, `mock-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`, [GITHUB_SCOPE], "octocat");
        else {
          const grant = await exchangeCode(env, code, pending.verifier, redirect);
          await save(env, user.id, grant.token, grant.scopes, await loginOf(env, grant.token));
        }
      } catch {
        return found(back(url, pending.next, "failed"), clear);
      }
      return found(back(url, pending.next, "connected"), clear);
    }
  }
  return text(404, "Not found");
}

function notConfigured() {
  return page(
    503,
    `<h1>GitHub isn't configured on this server</h1>
     <p class="muted">Connecting GitHub needs a GitHub OAuth app and an encryption key for its tokens.
     The person who runs this server sets <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code> and
     <code>INTEGRATIONS_KEY</code> with <code>wrangler secret put</code>.</p>
     <p><a href="/">Back to your notes</a></p>`,
  );
}
