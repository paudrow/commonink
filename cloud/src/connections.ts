// Connected accounts: a person connects Google Calendar once, and adds its calendars to any workspace
// they're in, where only they see them. The grant lives in D1 (`connections`), its tokens sealed
// under INTEGRATIONS_KEY (secrets.ts); only this Worker and its workspaces read them, and no response
// carries one. Connecting asks Google for read access, and for editing events only when someone turns
// write-back on (incremental consent). Google Drive is the same connection: saving a note there asks
// for the drive.file scope the first time (drive.ts), and connecting Calendar later keeps it (Google
// adds scopes to the grant rather than replacing them). Where Google isn't configured, Previews and
// local development get a stand-in (google-mock.ts); production says it isn't configured.
import type { SqlDb } from "../../src/core/store.ts";
import { b64url, cookie, escapeHtml, page, readSession, seal, setCookie, text, unseal } from "./auth.ts";
import type { Env } from "./env.ts";
import { exchangeCode, GOOGLE, GoogleClient, GoogleError, googleMode, refreshGrant, revokeGrant, SCOPES, type GoogleApi, type Grant } from "./google.ts";
import { MockDrive, MockGoogle } from "./google-mock.ts";
import { appPath, DRIVE, DRIVE_SCOPE, DriveClient, type DriveApi } from "./drive.ts";
import { decrypt, encrypt } from "./secrets.ts";

export { googleMode };

/** The sealing key: INTEGRATIONS_KEY, or for the stand-in's fake tokens one made from SESSION_SECRET. */
async function keyOf(env: Env): Promise<string | undefined> {
  if (googleMode(env) !== "mock") return env.INTEGRATIONS_KEY;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mock-integrations:${env.SESSION_SECRET}`));
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

const context = (user: string, which: "access" | "refresh") => `${user}:google:${which}`;

interface Row {
  account: string;
  scopes: string;
  access_enc: string;
  refresh_enc: string | null;
  expires_at: number;
  created_at: number;
}

/** What the app may know about someone's connection: never a token. */
export interface ConnectionInfo {
  account: string;
  /** Were their calendars allowed? (Someone who connected only to save to Drive hasn't.) */
  calendar: boolean;
  /** May meeting notes' links be written to their events (the calendar.events scope)? */
  canWrite: boolean;
  /** May notes be saved to their Google Drive (the drive.file scope)? */
  drive: boolean;
  connectedAt: number;
}

const row = (env: Env, user: string) =>
  env.DB.prepare("SELECT account, scopes, access_enc, refresh_enc, expires_at, created_at FROM connections WHERE user_id = ? AND provider = 'google'").bind(user).first<Row>();

export async function connectionInfo(env: Env, user: string): Promise<ConnectionInfo | null> {
  const r = await row(env, user);
  if (!r) return null;
  const scopes = r.scopes.split(" ");
  return { account: r.account, calendar: scopes.includes(SCOPES.read) || scopes.includes(SCOPES.write), canWrite: scopes.includes(SCOPES.write), drive: scopes.includes(DRIVE_SCOPE), connectedAt: r.created_at };
}

async function save(env: Env, user: string, g: Grant, account: string) {
  const key = await keyOf(env);
  const access = await encrypt(key, g.access, context(user, "access"));
  const refresh = g.refresh ? await encrypt(key, g.refresh, context(user, "refresh")) : null;
  await env.DB.prepare(
    `INSERT INTO connections(user_id, provider, account, scopes, access_enc, refresh_enc, expires_at, created_at) VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET account = excluded.account, scopes = excluded.scopes, access_enc = excluded.access_enc,
       refresh_enc = COALESCE(excluded.refresh_enc, connections.refresh_enc), expires_at = excluded.expires_at`,
  )
    .bind(user, account, g.scopes.join(" "), access, refresh, g.expiresAt, Date.now())
    .run();
}

const client = (env: Env, origin = "") => ({ id: env.GOOGLE_CLIENT_ID!, secret: env.GOOGLE_CLIENT_SECRET!, redirect: `${origin}/auth/google/calendar/callback` });

/** A stand-in grant: fake tokens, the scopes asked for, an hour to live. */
const mockGrant = (scopes: string[]): Grant => ({ access: `mock-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`, refresh: `mock-r-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`, expiresAt: Date.now() + 3600_000, scopes, email: null });

/** What a failure names, and where to connect again: Calendar, unless it's Drive asking. */
const CALENDAR_WORDS = { name: "Google Calendar", again: "Connect it again from Calendars." };
const DRIVE_WORDS = { name: "Google Drive", again: "Connect it again: Share, then Save to Google Drive." };

/** A live access token for `user`, refreshed first if it's about to run out. */
export async function accessToken(env: Env, user: string, words = CALENDAR_WORDS): Promise<string> {
  const r = await row(env, user);
  if (!r) throw new Error(`feed:${words.name} isn't connected any more. ${words.again}`);
  const key = await keyOf(env);
  if (r.expires_at - 60_000 > Date.now()) return decrypt(key, r.access_enc, context(user, "access"));
  if (!r.refresh_enc) throw new Error(`feed:${words.name} needs connecting again`);
  const refresh = await decrypt(key, r.refresh_enc, context(user, "refresh"));
  let g: Grant;
  try {
    g = googleMode(env) === "mock" ? { ...mockGrant(r.scopes.split(" ")), refresh } : await refreshGrant(client(env), refresh);
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 400 || e.status === 401)) throw new Error(`feed:${words.name} access was taken back. ${words.again}`);
    throw new Error(`feed:Couldn't reach ${words.name}`);
  }
  // Refreshing doesn't say which scopes it covers when they're unchanged.
  await save(env, user, { ...g, scopes: g.scopes.length ? g.scopes : r.scopes.split(" ") }, r.account);
  return g.access;
}

/** Google, as `user`: the real API, or the stand-in (which keeps what's written in `db`). */
export function googleApi(env: Env, user: string, db?: SqlDb): GoogleApi {
  const token = () => accessToken(env, user);
  return googleMode(env) === "mock" ? new MockGoogle(token, db) : new GoogleClient(token, GOOGLE);
}

/** Google Drive, as `user`: the real API, or the stand-in, whose "Open in Drive" pages are at `origin`. */
export function driveApi(env: Env, user: string, origin: string): DriveApi {
  const token = () => accessToken(env, user, DRIVE_WORDS);
  return googleMode(env) === "mock" ? new MockDrive(token, origin) : new DriveClient(token, DRIVE);
}

/** Forget the connection: Google revokes the grant, and the row goes. Returns whether there was one. */
export async function disconnectGoogle(env: Env, user: string): Promise<boolean> {
  const r = await row(env, user);
  if (!r) return false;
  if (googleMode(env) === "real") {
    const key = await keyOf(env);
    const token = await decrypt(key, r.refresh_enc ?? r.access_enc, context(user, r.refresh_enc ? "refresh" : "access")).catch(() => null);
    if (token) await revokeGrant(token);
  }
  await env.DB.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'google'").bind(user).run();
  return true;
}

// ------------------------------------------------------------------ connecting

const PENDING = "__Host-ci_gcal";

interface Pending {
  state: string;
  verifier: string;
  user: string;
  workspace: string;
  write: boolean;
  /** Connecting to save to Drive: it asks for drive.file, and comes back to `next`. */
  drive?: { next: string; as: string };
  exp: number;
}

/** Where connecting ends: back on the Calendar, in the workspace it started from; for Drive, back on the note. */
function back(url: URL, p: Pending, outcome: string) {
  if (!p.drive) return `${url.origin}/calendar?w=${encodeURIComponent(p.workspace)}&google=${outcome}`;
  let to = new URL(p.drive.next, url.origin);
  if (to.origin !== url.origin) to = new URL("/", url.origin); // appPath made sure; this makes surer
  to.searchParams.set("drive", outcome);
  if (p.drive.as) to.searchParams.set("as", p.drive.as);
  return to.toString();
}

const found = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};

/** What a grant needs to count: the calendar (read or edit), or for Drive, drive.file. */
const granted = (scopes: string[], p: Pending) => (p.drive ? scopes.includes(DRIVE_SCOPE) : scopes.includes(SCOPES.read) || scopes.includes(SCOPES.write));

/**
 * /auth/google/calendar and /auth/google/drive (start), /auth/google/calendar/callback (Google sends
 * the person back, either way), and on Previews /auth/google/calendar/mock (the stand-in's consent
 * page) and /auth/google/drive/mock/file (what "Open in Drive" shows there). Starting Calendar takes
 * `w`, the workspace to come back to, and `write=1` to also ask to edit events; starting Drive takes
 * `next`, the note to come back to, and `as`, the format the person picked.
 */
export async function googleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  const next = url.pathname === "/auth/google/drive" ? appPath(url.searchParams.get("next")) : "/calendar";
  if (!user) return found(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent(next)}`);
  const mode = googleMode(env);
  if (mode === "off") return notConfigured();

  switch (url.pathname) {
    case "/auth/google/calendar":
    case "/auth/google/drive": {
      const workspace = (url.searchParams.get("w") ?? "").replace(/[^a-z0-9]/g, "").slice(0, 40);
      const write = url.searchParams.get("write") === "1";
      const drive = url.pathname === "/auth/google/drive" ? { next, as: (url.searchParams.get("as") ?? "").replace(/[^a-z]/g, "").slice(0, 8) } : undefined;
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const pending = await seal(env.SESSION_SECRET, { state, verifier, user: user.id, workspace, write, drive, exp: Date.now() + 10 * 60_000 } satisfies Pending);
      const cookies = [setCookie(PENDING, pending, 600)];
      if (mode === "mock") return found(`${url.origin}/auth/google/calendar/mock?state=${state}`, cookies);
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const auth = new URL(GOOGLE.auth);
      auth.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        redirect_uri: client(env, url.origin).redirect,
        response_type: "code",
        scope: ["openid", "email", ...(drive ? [DRIVE_SCOPE] : [SCOPES.read, ...(write ? [SCOPES.write] : [])])].join(" "),
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        login_hint: user.email,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return found(auth.toString(), cookies);
    }

    case "/auth/google/calendar/mock": {
      if (mode !== "mock") return text(404, "Not found");
      const pending = await unseal<Pending>(env.SESSION_SECRET, cookie(req, PENDING));
      const state = url.searchParams.get("state") ?? "";
      if (!pending || pending.state !== state || pending.user !== user.id) return text(400, "That connection expired. Start again from Calendars.");
      if (req.method === "POST") {
        if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
        const allow = (await req.formData().catch(() => null))?.get("decision") === "allow";
        return found(`${url.origin}/auth/google/calendar/callback?state=${state}&${allow ? "code=mock" : "error=access_denied"}`);
      }
      const asks = pending.drive
        ? "<b>see, edit, create and delete only the specific Google Drive files that you use with this app</b>"
        : `<b>see your calendars</b>${pending.write ? " and <b>add links to meeting notes to your events</b>" : ""}`;
      return page(
        200,
        `<h1>Stand-in for Google</h1>
         <p class="muted">This server has no Google OAuth client, so this page plays Google's part. Nothing here reaches Google.</p>
         <p>Common Ink would like to ${asks}.</p>
         <form method="post"><input type="hidden" name="decision" value="allow"><button type="submit">Allow</button></form>
         <form method="post"><input type="hidden" name="decision" value="deny"><button type="submit" style="background:none;color:inherit;border:1px solid var(--line)">Cancel</button></form>`,
      );
    }

    case "/auth/google/drive/mock/file": {
      if (mode !== "mock") return text(404, "Not found");
      const q = (k: string) => escapeHtml(url.searchParams.get(k) ?? "");
      const kb = Math.max(1, Math.round(Number(url.searchParams.get("bytes")) / 1024) || 1);
      return page(
        200,
        `<h1>Stand-in for Google Drive</h1>
         <p class="muted">This server has no Google OAuth client, so nothing went to Google. With Google configured, this would open the file in Drive.</p>
         <p><b>${q("name")}</b> would be in the <b>Common Ink</b> folder of your Drive, as a ${q("as")}, made from ${q("from")} (${kb} KB).</p>`,
      );
    }

    case "/auth/google/calendar/callback": {
      const pending = await unseal<Pending>(env.SESSION_SECRET, cookie(req, PENDING));
      const clear = [setCookie(PENDING, "", 0)];
      if (!pending || pending.state !== url.searchParams.get("state") || pending.user !== user.id) return text(400, "That connection expired or was tampered with. Start again from Calendars.");
      const code = url.searchParams.get("code");
      if (!code) return found(back(url, pending, "denied"), clear);
      let grant: Grant;
      try {
        if (mode === "mock") {
          // Google adds what's asked for to what was granted before (include_granted_scopes); so does the stand-in.
          const had = (await row(env, user.id))?.scopes.split(" ") ?? [];
          const asked = pending.drive ? [DRIVE_SCOPE] : [SCOPES.read, ...(pending.write ? [SCOPES.write] : [])];
          grant = mockGrant([...new Set(["openid", "email", ...had.filter(Boolean), ...asked])]);
        } else grant = await exchangeCode(client(env, url.origin), code, pending.verifier);
      } catch {
        return found(back(url, pending, "failed"), clear);
      }
      if (!granted(grant.scopes, pending)) return found(back(url, pending, "denied"), clear);
      await save(env, user.id, grant, grant.email ?? user.email);
      return found(back(url, pending, "connected"), clear);
    }
  }
  return text(404, "Not found");
}

function notConfigured() {
  return page(
    503,
    `<h1>Google isn't configured on this server</h1>
     <p class="muted">Connecting Google Calendar or Google Drive needs a Google OAuth client and an encryption key for its tokens.
     The person who runs this server sets <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and
     <code>INTEGRATIONS_KEY</code> with <code>wrangler secret put</code>.</p>
     <p><a href="/calendar">Back to the Calendar</a></p>`,
  );
}

