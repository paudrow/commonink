// Connected accounts: a person connects Google Calendar once, and adds its calendars to any workspace
// they're in, where only they see them. Google Contacts rides the same grant: connecting it from the
// Contacts page adds its scope (Google keeps the ones already granted), and syncing writes the
// contacts into that workspace's People/ (src/core/googleContacts.ts). The grant lives in D1 (`connections`), its tokens sealed
// under INTEGRATIONS_KEY (secrets.ts); only this Worker and its workspaces read them, and no response
// carries one. Connecting asks Google for read access, and for editing events only when someone turns
// write-back on (incremental consent). Where Google isn't configured, Previews and local development
// get a stand-in (google-mock.ts); production says it isn't configured.
import type { SqlDb } from "../../src/core/store.ts";
import { b64url, cookie, escapeHtml, page, readSession, seal, setCookie, text, unseal } from "./auth.ts";
import type { Env } from "./env.ts";
import { exchangeCode, GOOGLE, GoogleClient, GoogleError, googleMode, refreshGrant, revokeGrant, SCOPES, scopesFor, type GoogleApi, type GoogleProduct, type Grant } from "./google.ts";
import { MockPeople, PeopleClient } from "./google-people.ts";
import type { ContactsConnection, PeopleApi } from "../../src/core/googleContacts.ts";
import { MockGoogle } from "./google-mock.ts";
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
  /** May meeting notes' links be written to their events (the calendar.events scope)? */
  canWrite: boolean;
  /** Google Contacts: not granted, read only, or editable (edits made here go back). */
  contacts: "none" | "read" | "write";
  connectedAt: number;
}

const row = (env: Env, user: string) =>
  env.DB.prepare("SELECT account, scopes, access_enc, refresh_enc, expires_at, created_at FROM connections WHERE user_id = ? AND provider = 'google'").bind(user).first<Row>();

export async function connectionInfo(env: Env, user: string): Promise<ConnectionInfo | null> {
  const r = await row(env, user);
  if (!r) return null;
  const scopes = r.scopes.split(" ");
  const contacts = scopes.includes(SCOPES.contactsWrite) ? "write" : scopes.includes(SCOPES.contactsRead) ? "read" : "none";
  return { account: r.account, canWrite: scopes.includes(SCOPES.write), contacts, connectedAt: r.created_at };
}

/** Someone's Google Contacts connection, for syncing: null until they've granted contacts. */
export async function contactsConnection(env: Env, user: string): Promise<ContactsConnection | null> {
  const info = await connectionInfo(env, user);
  return info && info.contacts !== "none" ? { account: info.account, canWrite: info.contacts === "write" } : null;
}

/** Google Contacts, as `user`: the People API, or the stand-in (kept in D1, so it's one per person). */
export function peopleApi(env: Env, user: string): PeopleApi {
  const token = () => accessToken(env, user);
  return googleMode(env) === "mock" ? new MockPeople(env.DB, user, token) : new PeopleClient(token);
}

async function sealGrant(env: Env, user: string, g: Grant) {
  const key = await keyOf(env);
  return { access: await encrypt(key, g.access, context(user, "access")), refresh: g.refresh ? await encrypt(key, g.refresh, context(user, "refresh")) : null };
}

async function save(env: Env, user: string, g: Grant, account: string) {
  const { access, refresh } = await sealGrant(env, user, g);
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

/** A live access token for `user`, refreshed first if it's about to run out. */
export async function accessToken(env: Env, user: string): Promise<string> {
  const r = await row(env, user);
  if (!r) throw new Error("feed:Google Calendar isn't connected any more. Connect it again from Calendars.");
  const key = await keyOf(env);
  if (r.expires_at - 60_000 > Date.now()) return decrypt(key, r.access_enc, context(user, "access"));
  if (!r.refresh_enc) throw new Error("feed:Google Calendar needs connecting again");
  const refresh = await decrypt(key, r.refresh_enc, context(user, "refresh"));
  let g: Grant;
  try {
    g = googleMode(env) === "mock" ? { ...mockGrant(r.scopes.split(" ")), refresh } : await refreshGrant(client(env), refresh);
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 400 || e.status === 401)) throw new Error("feed:Google Calendar access was taken back. Connect it again from Calendars.");
    throw new Error("feed:Couldn't reach Google Calendar");
  }
  // Refreshing doesn't say which scopes it covers when they're unchanged. Only this same connection is
  // updated: one disconnected (or made again) while the refresh was in flight stays as it is now.
  const { access, refresh: sealed } = await sealGrant(env, user, g);
  await env.DB.prepare(
    "UPDATE connections SET scopes = ?, access_enc = ?, refresh_enc = COALESCE(?, refresh_enc), expires_at = ? WHERE user_id = ? AND provider = 'google' AND created_at = ?",
  )
    .bind((g.scopes.length ? g.scopes : r.scopes.split(" ")).join(" "), access, sealed, g.expiresAt, user, r.created_at)
    .run();
  return g.access;
}

/** Google, as `user`: the real API, or the stand-in (which keeps what's written in `db`). */
export function googleApi(env: Env, user: string, db?: SqlDb): GoogleApi {
  const token = () => accessToken(env, user);
  return googleMode(env) === "mock" ? new MockGoogle(token, db) : new GoogleClient(token, GOOGLE);
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
  /** What it's for: where it comes back to, and which scopes it asks for. Calendar when left out. */
  for?: GoogleProduct;
  exp: number;
}

/** Where connecting ends: back on the Calendar (or Contacts), in the workspace it started from. */
const back = (url: URL, p: Pick<Pending, "workspace" | "for">, outcome: string) => `${url.origin}/${p.for === "contacts" ? "contacts" : "calendar"}?w=${encodeURIComponent(p.workspace)}&google=${outcome}`;

const found = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};

/**
 * /auth/google/calendar (start), /callback (Google sends the person back), and on Previews /mock
 * (the stand-in's consent page). Starting takes `w`, the workspace to come back to, `write=1` to
 * also ask to edit events (or contacts), and `for=contacts` to connect Google Contacts instead.
 */
export async function googleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return found(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent("/calendar")}`);
  const mode = googleMode(env);
  if (mode === "off") return notConfigured();

  switch (url.pathname) {
    case "/auth/google/calendar": {
      const workspace = (url.searchParams.get("w") ?? "").replace(/[^a-z0-9]/g, "").slice(0, 40);
      const write = url.searchParams.get("write") === "1";
      const product: GoogleProduct = url.searchParams.get("for") === "contacts" ? "contacts" : "calendar";
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const pending = await seal(env.SESSION_SECRET, { state, verifier, user: user.id, workspace, write, for: product, exp: Date.now() + 10 * 60_000 } satisfies Pending);
      const cookies = [setCookie(PENDING, pending, 600)];
      if (mode === "mock") return found(`${url.origin}/auth/google/calendar/mock?state=${state}`, cookies);
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const auth = new URL(GOOGLE.auth);
      auth.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        redirect_uri: client(env, url.origin).redirect,
        response_type: "code",
        scope: ["openid", "email", ...scopesFor(product, write)].join(" "),
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
      return page(
        200,
        `<h1>Stand-in for Google</h1>
         <p class="muted">This server has no Google OAuth client, so this page plays Google's part. Nothing here reaches Google.</p>
         <p>Common Ink would like to ${
           pending.for === "contacts"
             ? `<b>see your contacts</b>${pending.write ? " and <b>edit them</b>" : ""}`
             : `<b>see your calendars</b>${pending.write ? " and <b>add links to meeting notes to your events</b>" : ""}`
         }.</p>
         <form method="post"><input type="hidden" name="decision" value="allow"><button type="submit">Allow</button></form>
         <form method="post"><input type="hidden" name="decision" value="deny"><button type="submit" style="background:none;color:inherit;border:1px solid var(--line)">Cancel</button></form>`,
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
        // Google adds to what was granted before (include_granted_scopes); the stand-in does the same here.
        const had = mode === "mock" ? ((await row(env, user.id))?.scopes.split(" ") ?? []) : [];
        grant = mode === "mock" ? mockGrant([...new Set([...had, "openid", "email", ...scopesFor(pending.for ?? "calendar", pending.write)])]) : await exchangeCode(client(env, url.origin), code, pending.verifier);
      } catch {
        return found(back(url, pending, "failed"), clear);
      }
      if (!scopesFor(pending.for ?? "calendar", false).concat(scopesFor(pending.for ?? "calendar", true)).some((s) => grant.scopes.includes(s))) return found(back(url, pending, "denied"), clear);
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
     <p class="muted">Connecting Google Calendar needs a Google OAuth client and an encryption key for its tokens.
     The person who runs this server sets <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and
     <code>INTEGRATIONS_KEY</code> with <code>wrangler secret put</code>.</p>
     <p><a href="/calendar">Back to the Calendar</a></p>`,
  );
}


/**
 * /auth/google/contacts/mock, on Previews and in local development only: the stand-in's address
 * book, where a contact can be changed or deleted as if in Google, to see a sync bring it in.
 */
export async function mockContactsPage(req: Request, env: Env, url: URL): Promise<Response> {
  if (googleMode(env) !== "mock") return text(404, "Not found");
  const user = await readSession(req, env);
  if (!user) return found(`${url.origin}/auth/dev?next=${encodeURIComponent(url.pathname)}`);
  const people = new MockPeople(env.DB, user.id);
  if (req.method === "POST") {
    if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
    const form = await req.formData();
    const resource = String(form.get("resource") ?? "");
    if (!/^people\/c\d+$/.test(resource)) return text(400, "Which contact?");
    const list = (k: string) => String(form.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((value) => ({ value }));
    if (form.get("delete")) await people.edit(resource, null);
    else {
      await people.edit(resource, {
        names: [{ displayName: String(form.get("name") ?? "").trim() || resource }],
        emailAddresses: list("email"),
        phoneNumbers: list("phone"),
        organizations: [{ name: String(form.get("company") ?? "").trim(), title: String(form.get("role") ?? "").trim() }],
      });
    }
    return found(url.pathname);
  }
  const all = await people.all();
  const field = (name: string, label: string, value: string) => `<label>${label} <input name="${name}" value="${escapeHtml(value)}"></label>`;
  const next = `people/c${1000 + all.length + 1}`;
  const card = (p: (typeof all)[number] | null) => {
    const resource = p?.resourceName ?? next;
    return `<form method="post" style="border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0;display:grid;gap:6px${p?.metadata?.deleted ? ";opacity:.5" : ""}">
      <input type="hidden" name="resource" value="${resource}">
      <b>${p ? escapeHtml(p.names?.[0]?.displayName ?? resource) : "Add a contact"}</b>${p?.metadata?.deleted ? " (deleted)" : ""}
      ${field("name", "Name", p?.names?.[0]?.displayName ?? "")}
      ${field("email", "Emails", (p?.emailAddresses ?? []).map((e) => e.value).join(", "))}
      ${field("phone", "Phones", (p?.phoneNumbers ?? []).map((e) => e.value).join(", "))}
      ${field("company", "Company", p?.organizations?.[0]?.name ?? "")}
      ${field("role", "Role", p?.organizations?.[0]?.title ?? "")}
      <div><button type="submit">${p ? "Save in Google" : "Add in Google"}</button>${p && !p.metadata?.deleted ? ` <button type="submit" name="delete" value="1" style="background:none;color:inherit;border:1px solid var(--line)">Delete in Google</button>` : ""}</div>
    </form>`;
  };
  return page(
    200,
    `<h1>Stand-in Google Contacts</h1>
     <p class="muted">This server has no Google OAuth client, so these demo contacts play your Google address book. Change one here, then press <b>Sync</b> on the Contacts page.</p>
     ${all.map(card).join("")}${card(null)}
     <p><a href="/contacts">Back to Contacts</a></p>`,
  );
}
