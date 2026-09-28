// Sign-in: Google OAuth (authorization code + PKCE), and signed session cookies so checking who's
// asking needs no database round trip.
import { createWorkspace, upsertUser, type User } from "./directory.ts";
import type { Env } from "./env.ts";

const SESSION = "ci_session";
const OAUTH = "ci_oauth";
const SESSION_DAYS = 30;

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

async function unseal<T extends { exp: number }>(secret: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  // constant-time compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
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

export interface Session {
  uid: string;
  exp: number;
}

export function readSession(req: Request, env: Env) {
  return unseal<Session>(env.SESSION_SECRET, cookie(req, SESSION));
}

// ------------------------------------------------------------------ routes

/** Only same-site relative paths, so `next` can't bounce people to another site. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export async function handleAuth(req: Request, env: Env, onSignedIn: (user: User, isNew: boolean) => Promise<void>): Promise<Response> {
  const url = new URL(req.url);
  const redirect = (to: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: to });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 302, headers });
  };
  const startSession = async (user: User, isNew: boolean, next: string, extra: string[] = []) => {
    await onSignedIn(user, isNew);
    const value = await seal(env.SESSION_SECRET, { uid: user.id, exp: Date.now() + SESSION_DAYS * 86400_000 });
    return redirect(next, [...extra, setCookie(SESSION, value, SESSION_DAYS * 86400)]);
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
      const { user, isNew } = await upsertUser(env.DB, `google:${claims.sub}`, { email: claims.email, name: claims.name ?? claims.email.split("@")[0], picture: claims.picture });
      return startSession(user, isNew, pending.next, [setCookie(OAUTH, "", 0)]);
    }

    case "/auth/dev": {
      if (env.DEV_LOGIN !== "1") return text(404, "Not found");
      // `?as=sam` signs in as another local person, for trying out sharing.
      const as = (url.searchParams.get("as") ?? "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20);
      const profile = as
        ? { email: `${as}@localhost`, name: `${as[0].toUpperCase()}${as.slice(1)} Dev`, picture: null }
        : { email: "dev@localhost", name: "Dev User", picture: null };
      const { user, isNew } = await upsertUser(env.DB, as ? `dev:${as}` : "dev:local", profile);
      return startSession(user, isNew, safeNext(url.searchParams.get("next")));
    }

    case "/auth/logout":
      return redirect("/", [setCookie(SESSION, "", 0)]);
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
  await env.WORKSPACE.get(env.WORKSPACE.idFromName(id)).fetch(
    new Request("https://workspace/seed", { method: "POST", headers: { "x-ci-workspace": id } }),
  );
}

const text = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function notConfigured() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Common Ink</title>
     <body style="font:15px/1.6 -apple-system,system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#26241f">
     <h1 style="font-size:22px">Google sign-in isn't set up yet</h1>
     <p>This deployment needs a Google OAuth client. Set <code>GOOGLE_CLIENT_ID</code> and
     <code>GOOGLE_CLIENT_SECRET</code> with <code>wrangler secret put</code>, then try again.</p>
     <p><a href="/">Back</a></p></body>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
