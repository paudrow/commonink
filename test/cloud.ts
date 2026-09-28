// The hosted Worker, run locally in workerd for tests: its real D1, R2 and Durable Objects (empty,
// and gone when the test ends), developer sign-in, and a stand-in for the built web app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestHarness } from "wrangler";

const CLOUD = path.resolve(import.meta.dirname, "../cloud");

export const APP_HTML = `<!doctype html><title>Common Ink</title><script>document.title += "!"</script><script type="module" src="/assets/app.js"></script>`;

export type Cloud = Awaited<ReturnType<typeof startCloud>>;

export async function startCloud(vars: Record<string, string> = {}) {
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-assets-"));
  fs.writeFileSync(path.join(assets, "index.html"), APP_HTML);
  fs.writeFileSync(path.join(assets, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const config = JSON.parse(fs.readFileSync(path.join(CLOUD, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const { $schema, routes, previews, ...rest } = config;
  const server = createTestHarness({
    root: CLOUD,
    workers: [
      {
        config: {
          ...rest,
          main: path.join(CLOUD, rest.main),
          assets: { ...rest.assets, directory: assets },
          vars: { DEV_LOGIN: "1", SESSION_SECRET: "test-only-secret", ...vars },
          d1_databases: rest.d1_databases.map((d: { migrations_dir: string }) => ({ ...d, migrations_dir: path.join(CLOUD, d.migrations_dir) })),
        },
      },
    ],
  });
  const { url } = await server.listen();
  await server.getWorker().applyD1Migrations("DB");
  const origin = url.origin;

  /** A request as someone (a cookie) or no one, sent the way our own pages send it. */
  const request = (cookie: string | null, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    server.fetch(new URL(p, origin), {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method === "GET" ? {} : { origin }),
        ...(body === undefined || body instanceof Uint8Array ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });

  /** Developer sign-in as `as`; returns the session cookie. */
  async function signIn(as: string) {
    const res = await server.fetch(new URL(`/auth/dev?as=${as}`, origin), { redirect: "manual" });
    const set = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("ci_session=") && !c.endsWith("="));
    if (!set) throw new Error(`Couldn't sign in as ${as} (${res.status})`);
    return set;
  }

  async function call<T = any>(cookie: string | null, method: string, p: string, body?: unknown): Promise<T> {
    const res = await request(cookie, method, p, body);
    if (res.status >= 400) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  return { server, origin, request, signIn, call, close: () => (server.close(), fs.rmSync(assets, { recursive: true, force: true })) };
}

/**
 * A team workspace with one of each role, plus someone who isn't in it. Returns each one's
 * session cookie and the workspace's API base.
 */
export async function team(cloud: Cloud) {
  const owner = await cloud.signIn("owner");
  const { id } = await cloud.call(owner, "POST", "/api/workspaces", { name: "Team" });
  const base = `/api/w/${id}`;
  const join = async (as: string, role: "editor" | "viewer") => {
    const cookie = await cloud.signIn(as);
    const { url } = await cloud.call(owner, "POST", `${base}/invites`, { role });
    const res = await cloud.request(cookie, "GET", new URL(url).pathname);
    if (res.status !== 302) throw new Error(`${as} couldn't join (${res.status})`);
    return cookie;
  };
  return { id, base, owner, editor: await join("editor", "editor"), viewer: await join("viewer", "viewer"), stranger: await cloud.signIn("stranger") };
}
