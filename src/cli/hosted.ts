// Hosted workspaces from the CLI: `commonink login` (browser OAuth with PKCE and a loopback redirect,
// the same flow remote MCP uses), the credentials it keeps, and running a command in a workspace
// over HTTP. The Worker runs the command with the same table and core as a local vault.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { configFolder } from "../legacy.ts";
import path from "node:path";
import readline from "node:readline";
import { EXIT, type Output } from "../core/commands/index.ts";
import { CLI_ROUTE, fromWire, toWire, type RunRequest, type RunResponse } from "../core/commands/wire.ts";

export const DEFAULT_SERVER = "https://commonink.app";
/** The scope that asks for every workspace (see cloud/src/agents.ts). */
const SCOPE = "workspaces";

/** A failure with the exit code the CLI ends with. */
export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
    public exit: number,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ credentials

export interface Credentials {
  server: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working (ms since the epoch). */
  expiresAt: number;
  /** Who signed in, as the server knows them. */
  user?: string;
  /** Where commands go when they don't say (commonink workspaces use). */
  workspace?: string;
}

/** ~/.config/commonink, or $XDG_CONFIG_HOME/commonink, or $COMMONINK_CONFIG_DIR. */
export const configDir = () => configFolder();
const credentialsFile = () => path.join(configDir(), "credentials.json");

export function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(fs.readFileSync(credentialsFile(), "utf8")) as Credentials;
  } catch {
    return null;
  }
}

/** Only you may read it (0600): it holds a token that acts as you. */
export function saveCredentials(c: Credentials) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = credentialsFile();
  fs.writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export const forgetCredentials = () => fs.rmSync(credentialsFile(), { force: true });

// ------------------------------------------------------------------ HTTP

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new CliError(`Couldn't reach ${new URL(url).origin}: ${(e as Error).message}`, "unavailable", EXIT.unavailable);
  }
}

async function discover(server: string) {
  const res = await call(`${server}/.well-known/oauth-authorization-server`, {});
  if (!res.ok) throw new CliError(`${server} doesn't offer sign-in for the CLI (${res.status})`, "unavailable", EXIT.unavailable);
  return (await res.json()) as { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string };
}

const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

function tokens(c: Omit<Credentials, "accessToken" | "refreshToken" | "expiresAt">, t: { access_token: string; refresh_token: string; expires_in?: number }): Credentials {
  return { ...c, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
}

// ------------------------------------------------------------------ login

/** Open a URL in the browser, best effort (the URL is printed too). */
function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}

/**
 * Sign in to `server` in the browser, and keep the tokens. A loopback server on 127.0.0.1 takes the
 * redirect; with `browser: false` the URL is only printed, and the address the browser ends up on
 * can be pasted back instead (for a machine with no browser, say over SSH).
 */
export async function login(server: string, opts: { browser: boolean; say(line: string): void }): Promise<Credentials> {
  const meta = await discover(server);
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${(listener.address() as { port: number }).port}/callback`;
  try {
    const reg = await call(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "commonink CLI", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], scope: SCOPE }),
    });
    if (!reg.ok) throw new CliError(`Couldn't register the CLI with ${server} (${reg.status}): ${await reg.text()}`, "unavailable", EXIT.unavailable);
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("base64url");
    const url = `${meta.authorization_endpoint}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
      scope: SCOPE,
    })}`;
    opts.say(`Sign in to ${server} in your browser:\n  ${url}`);
    if (opts.browser) openBrowser(url);
    const landed = await Promise.race([callback(listener), pasted(opts)]);
    const back = new URL(landed, redirect);
    if (back.searchParams.get("state") !== state) throw new CliError("The sign-in came back for a different request. Run commonink login again.", "auth", EXIT.auth);
    const code = back.searchParams.get("code");
    if (!code) throw new CliError(`Sign-in didn't finish: ${back.searchParams.get("error_description") ?? back.searchParams.get("error") ?? "no code"}`, "auth", EXIT.auth);
    const res = await call(meta.token_endpoint, form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }));
    if (!res.ok) throw new CliError(`Couldn't finish signing in (${res.status}): ${await res.text()}`, "auth", EXIT.auth);
    const creds = tokens({ server, clientId }, await res.json());
    saveCredentials(creds);
    return creds;
  } finally {
    listener.close();
  }
}

/** The redirect the browser makes back to us, as a path with its query. */
function callback(listener: http.Server): Promise<string> {
  return new Promise((resolve) =>
    listener.on("request", (req, res) => {
      if (!req.url?.startsWith("/callback")) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Signed in</title><p>You're signed in. You can close this tab and go back to the terminal.</p>");
      resolve(req.url);
    }),
  );
}

/** Or the address pasted into the terminal, when the browser is on another machine. */
function pasted(opts: { browser: boolean; say(line: string): void }): Promise<string> {
  if (opts.browser || !process.stdin.isTTY) return new Promise(() => {});
  opts.say("Once you've allowed it, paste the address your browser ended up on (it starts with http://127.0.0.1):");
  const rl = readline.createInterface({ input: process.stdin });
  return new Promise((resolve) => rl.once("line", (line) => (rl.close(), resolve(line.trim()))));
}

/** Sign out: the server forgets the token (RFC 7009), and so does this computer. */
export async function logout(): Promise<string | null> {
  const c = loadCredentials();
  if (!c) return null;
  try {
    const meta = await discover(c.server);
    await call(meta.revocation_endpoint ?? meta.token_endpoint, form({ token: c.refreshToken, client_id: c.clientId }));
    await call(meta.revocation_endpoint ?? meta.token_endpoint, form({ token: c.accessToken, client_id: c.clientId }));
  } catch {
    // Signed out here whatever the server says; the token runs out on its own.
  }
  forgetCredentials();
  return c.server;
}

// ------------------------------------------------------------------ requests

/** The access token, refreshed first if it's about to run out. */
async function fresh(c: Credentials, force = false): Promise<Credentials> {
  if (!force && c.expiresAt > Date.now() + 60_000) return c;
  const meta = await discover(c.server);
  const res = await call(meta.token_endpoint, form({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId }));
  if (!res.ok) throw new CliError(`Your sign-in to ${c.server} has ended. Run commonink login.`, "auth", EXIT.auth);
  const next = tokens(c, await res.json());
  saveCredentials(next);
  return next;
}

/** A request to the CLI's API with the signed-in person's token; once more with a fresh one on a 401. */
async function authed(c: Credentials, p: string, init: RequestInit = {}): Promise<Response> {
  let creds = await fresh(c);
  const go = () => call(`${creds.server}${CLI_ROUTE}${p}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${creds.accessToken}` } });
  let res = await go();
  if (res.status === 401) {
    creds = await fresh(creds, true);
    res = await go();
  }
  if (res.status === 401) throw new CliError(`Your sign-in to ${c.server} isn't accepted any more. Run commonink login.`, "auth", EXIT.auth);
  return res;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  kind: "personal" | "team";
  role: "owner" | "editor" | "viewer";
}

export async function workspaces(c: Credentials): Promise<{ user: { name: string }; workspaces: WorkspaceInfo[] }> {
  const res = await authed(c, "/workspaces");
  if (!res.ok) throw new CliError(`Couldn't list your workspaces (${res.status})`, "unavailable", EXIT.unavailable);
  return (await res.json()) as { user: { name: string }; workspaces: WorkspaceInfo[] };
}

const EXIT_OF: Record<string, number> = { usage: EXIT.usage, invalid: EXIT.error, not_found: EXIT.not_found, conflict: EXIT.conflict, exists: EXIT.exists, forbidden: EXIT.forbidden };

/** Run a command in a hosted workspace. */
export async function runRemote(c: Credentials, req: RunRequest): Promise<Output> {
  const res = await authed(c, "/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toWire(req)) });
  const body = (await res.json().catch(() => null)) as RunResponse | { error?: string } | null;
  if (res.status === 429) throw new CliError((body as { error?: string })?.error ?? "Too many requests: try again soon.", "unavailable", EXIT.unavailable);
  if (!body || !("ok" in body)) throw new CliError(`${c.server} couldn't run it (${res.status})`, "unavailable", EXIT.unavailable);
  if (!body.ok) throw new CliError(body.error, body.code, EXIT_OF[body.code] ?? EXIT.error);
  const out = fromWire(body) as RunResponse & { ok: true };
  return { text: out.text, data: out.data, ...(out.save ? { save: out.save } : {}) };
}
