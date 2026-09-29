// Sign-in: Google OAuth (authorization code + PKCE), and sessions kept in D1 so they can be signed
// out anywhere. New accounts are gated: someone Google hasn't seen here before needs the sign-up code
// (SIGNUP_CODE) or a valid invite link.
import {
  createSession, createWorkspace, endSession, failedSignups, hasUser, inviteIsValid, recordFailedSignup,
  sessionUser, touchSession, upsertUser, type User,
} from "./directory.ts";
import type { Env } from "./env.ts";

// __Host- cookies must be Secure, for this exact host and path "/", so a sibling subdomain can't set
// or overwrite them.
const SESSION = "__Host-ci_session";
const OAUTH = "__Host-ci_oauth";
const SIGNUP = "__Host-ci_signup";
/** Sessions from before they were kept in D1: cleared on sight, and their holder signs in again. */
const LEGACY_SESSION = "ci_session";
/** A session ends this long after sign-in, however much it's used. */
const SESSION_DAYS = 30;
/** A session also ends after this long unused. */
const IDLE_DAYS = 14;
/** How stale a session's last-seen time may get before a request refreshes it (saves a write per request). */
const TOUCH_EVERY = 3600_000;
/** Wrong sign-up codes a Google account may try in a day. */
const SIGNUP_TRIES = 5;

// ------------------------------------------------------------------ signed cookies

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

async function seal(secret: string, payload: object) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

function timingSafeEqual(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function unseal<T extends { exp: number }>(secret: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const bytes = (s: string) => new TextEncoder().encode(s);
  if (!timingSafeEqual(bytes(await hmac(secret, body)), bytes(sig))) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
  return payload.exp > Date.now() ? payload : null;
}

function cookie(req: Request, name: string) {
  for (const part of (req.headers.get("Cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (part.slice(0, i) === name) return part.slice(i + 1);
  }
}

const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const idleSince = () => Date.now() - IDLE_DAYS * 86400_000;

/** Who's signed in on this request, if anyone. */
export async function readSession(req: Request, env: Env): Promise<User | null> {
  const token = cookie(req, SESSION);
  if (!token) return null;
  const id = await sha256(token);
  const row = await sessionUser(env.DB, id, idleSince());
  if (!row) return null;
  const { seenAt, ...user } = row;
  if (Date.now() - seenAt > TOUCH_EVERY) await touchSession(env.DB, id);
  return user;
}

export const clearSessionCookies = () => [setCookie(SESSION, "", 0), setCookie(LEGACY_SESSION, "", 0)];

// ------------------------------------------------------------------ routes

/** Case, spacing and how a keyboard encodes accents don't matter, so a code read out loud still works. */
const normalizeCode = (code: string) => code.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/** The sign-up code, if one is set. All whitespace counts as unset, or an empty entry would match it. */
const signupCode = (env: Env) => (env.SIGNUP_CODE && normalizeCode(env.SIGNUP_CODE)) || null;

/** Compares hashes, so the check takes the same time however much of the code is right. */
async function codeMatches(given: string, expected: string) {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeCode(s))));
  return timingSafeEqual(...(await Promise.all([hash(given), hash(expected)])));
}

/** Someone new may make an account on their way to accept an invite, since a member already vouched for them. */
async function arrivingByInvite(env: Env, next: string) {
  const token = next.match(/^\/invite\/([a-f0-9]+)\/?$/)?.[1];
  return !!token && (await inviteIsValid(env.DB, token));
}

interface PendingSignup {
  sub: string;
  profile: { email: string; name: string; picture?: string };
  next: string;
  exp: number;
}

/**
 * Only paths on this site, so `next` can't bounce people to another one. Browsers read `/\evil.com`
 * as `//evil.com`, so backslashes are out too.
 */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/");

export async function handleAuth(req: Request, env: Env, onSignedIn: (user: User, isNew: boolean) => Promise<void>): Promise<Response> {
  const url = new URL(req.url);
  const redirect = (to: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: to });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 302, headers });
  };
  const startSession = async (user: User, isNew: boolean, next: string, extra: string[] = []) => {
    await onSignedIn(user, isNew);
    // A fresh token every sign-in, and the one this browser had (if any) stops working.
    const old = cookie(req, SESSION);
    if (old) await endSession(env.DB, await sha256(old));
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await createSession(env.DB, await sha256(token), user.id, Date.now() + SESSION_DAYS * 86400_000, idleSince());
    return redirect(next, [...extra, setCookie(LEGACY_SESSION, "", 0), setCookie(SESSION, token, SESSION_DAYS * 86400)]);
  };

  switch (url.pathname) {
    case "/auth/google": {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return notConfigured();
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const sealed = await seal(env.SESSION_SECRET, { state, verifier, next: safeNext(url.searchParams.get("next")), exp: Date.now() + 10 * 60_000 });
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return redirect(auth.toString(), [setCookie(OAUTH, sealed, 600)]);
    }

    case "/auth/google/callback": {
      const pending = await unseal<{ state: string; verifier: string; next: string; exp: number }>(env.SESSION_SECRET, cookie(req, OAUTH));
      const code = url.searchParams.get("code");
      if (!pending || !code || url.searchParams.get("state") !== pending.state) return text(400, "Sign-in expired or was tampered with. Please try again.");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: `${url.origin}/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: pending.verifier,
        }),
      });
      const token = (await res.json()) as { id_token?: string; error?: string };
      if (!token.id_token) return text(502, `Google sign-in failed (${token.error ?? res.status}).`);
      // The ID token came straight from Google's token endpoint over TLS, so its signature needn't be
      // re-verified (OIDC Core 3.1.3.7); still check it's for us, from Google, current, and verified.
      const claims = JSON.parse(new TextDecoder().decode(fromB64url(token.id_token.split(".")[1]))) as {
        aud: string; iss: string; exp: number; sub: string; email: string; email_verified: boolean; name?: string; picture?: string;
      };
      if (claims.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) || claims.exp * 1000 < Date.now() || !claims.email_verified) {
        return text(403, "That Google account couldn't be verified.");
      }
      const sub = `google:${claims.sub}`;
      const profile = { email: claims.email, name: claims.name ?? claims.email.split("@")[0], picture: claims.picture };
      if (!(await hasUser(env.DB, sub)) && !(await arrivingByInvite(env, pending.next))) {
        // Hold on to who they are (signed, for 15 minutes) and ask for the sign-up code before making the account.
        const ticket = await seal(env.SESSION_SECRET, { sub, profile, next: pending.next, exp: Date.now() + 15 * 60_000 } satisfies PendingSignup);
        return redirect("/auth/signup", [setCookie(OAUTH, "", 0), setCookie(SIGNUP, ticket, 15 * 60)]);
      }
      const { user, isNew } = await upsertUser(env.DB, sub, profile);
      return startSession(user, isNew, pending.next, [setCookie(OAUTH, "", 0)]);
    }

    case "/auth/signup": {
      const ticket = await unseal<PendingSignup>(env.SESSION_SECRET, cookie(req, SIGNUP));
      // The other signed cookies share the format, so check it's really a ticket.
      if (!ticket?.sub || !ticket.profile?.email) return redirect("/");
      const cancel = setCookie(SIGNUP, "", 0);
      const code = signupCode(env);
      if (!code) return signupPage(ticket, "closed", [cancel]);
      if (req.method !== "POST") return signupPage(ticket, "ask");
      if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
      if ((await failedSignups(env.DB, ticket.sub, Date.now() - 86400_000)) >= SIGNUP_TRIES) return signupPage(ticket, "locked", [cancel]);
      const form = await req.formData().catch(() => null);
      if (!(await codeMatches(String(form?.get("code") ?? ""), code))) {
        await recordFailedSignup(env.DB, ticket.sub);
        return signupPage(ticket, "wrong");
      }
      const { user, isNew } = await upsertUser(env.DB, ticket.sub, ticket.profile);
      return startSession(user, isNew, ticket.next, [cancel]);
    }

    case "/auth/dev": {
      if (env.DEV_LOGIN !== "1") return text(404, "Not found");
      // `?as=sam` signs in as another local person, for trying out sharing.
      const as = (url.searchParams.get("as") ?? "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20);
      const profile = as
        ? { email: `${as}@localhost`, name: `${as[0].toUpperCase()}${as.slice(1)} Dev`, picture: null }
        : { email: "dev@localhost", name: "Dev User", picture: null };
      // Previews share one D1 but each has its own Durable Objects, so a developer there is someone
      // new per Preview (keyed by its host); otherwise their workspace would be empty in the next one.
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const { user, isNew } = await upsertUser(env.DB, `dev:${local ? "" : `${url.hostname}:`}${as || "local"}`, profile);
      return startSession(user, isNew, safeNext(url.searchParams.get("next")));
    }

    case "/auth/logout": {
      const token = cookie(req, SESSION);
      if (token) await endSession(env.DB, await sha256(token));
      return redirect("/", [...clearSessionCookies(), setCookie(SIGNUP, "", 0)]);
    }
  }
  return text(404, "Not found");
}

/** Every new person gets a personal workspace, filled with the starter notes. */
export async function ensurePersonalWorkspace(env: Env, user: User) {
  const has = await env.DB.prepare("SELECT 1 FROM workspaces WHERE owner_id = ? AND kind = 'personal'").bind(user.id).first();
  if (has) return;
  const id = await createWorkspace(env.DB, user, `${user.name.split(" ")[0]}'s notes`, "personal");
  await seedWorkspace(env, id);
}

export async function seedWorkspace(env: Env, id: string) {
  await env.WORKSPACE.get(env.WORKSPACE.idFromName(id)).seed(id);
}

export const text = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(status: number, body: string, cookies: string[] = []) {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
     <title>Common Ink</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
     <style>
       :root { color-scheme: light dark; --bg: #fbfaf8; --ink: #26241f; --muted: #6f6a61; --line: #e7e3db; --field: #fff; --accent: #4545b8; --bad: #b3261e; }
       @media (prefers-color-scheme: dark) { :root { --bg: #17171a; --ink: #d9d7d2; --muted: #9a968d; --line: #2c2c31; --field: #1f1f23; --accent: #a9a9ff; --bad: #f2b8b5; } }
       body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 -apple-system, system-ui, sans-serif; }
       main { max-width: 420px; margin: 12vh auto; padding: 0 20px; }
       h1 { font-size: 22px; margin: 16px 0 6px; }
       p { margin: 0 0 14px; }
       .muted { color: var(--muted); }
       .bad { color: var(--bad); }
       a { color: var(--accent); }
       input { box-sizing: border-box; width: 100%; height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--field); color: inherit; font: inherit; }
       button { margin-top: 12px; width: 100%; height: 44px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
       @media (prefers-color-scheme: dark) { button { color: #17171a; } }
     </style>
     <main><img src="/favicon.svg" width="40" height="40" alt="">${body}</main>`,
    { status, headers },
  );
}

function signupPage(ticket: PendingSignup, state: "ask" | "wrong" | "locked" | "closed", cookies: string[] = []) {
  const who = `<p class="muted">Signed in with Google as ${escapeHtml(ticket.profile.email)}. <a href="/auth/logout">Not you?</a></p>`;
  if (state === "closed") {
    return page(403, `<h1>Common Ink isn't open to new accounts yet</h1>${who}<p>If someone invited you, open their invite link again.</p>`, cookies);
  }
  if (state === "locked") {
    return page(429, `<h1>Too many tries</h1>${who}<p>That's too many wrong codes for today. Check the code with whoever gave it to you, and try again tomorrow.</p>`, cookies);
  }
  return page(
    state === "wrong" ? 403 : 200,
    `<h1>Enter your sign-up code</h1>${who}
     <p>Common Ink is invite-only for now. Enter the code you were given to make your account.</p>
     <form method="post" action="/auth/signup">
       <input name="code" type="password" autocomplete="off" autofocus required aria-label="Sign-up code" placeholder="Sign-up code">
       ${state === "wrong" ? `<p class="bad" role="alert" style="margin:8px 0 0">That code isn't right. Check it and try again.</p>` : ""}
       <button type="submit">Create my account</button>
     </form>`,
    cookies,
  );
}

function notConfigured() {
  return page(
    503,
    `<h1>Google sign-in isn't set up yet</h1>
     <p>This deployment needs a Google OAuth client. Set <code>GOOGLE_CLIENT_ID</code> and
     <code>GOOGLE_CLIENT_SECRET</code> with <code>wrangler secret put</code>, then try again.</p>
     <p><a href="/">Back</a></p>`,
  );
}
