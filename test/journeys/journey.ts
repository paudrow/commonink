// User journeys: the few things everyone does in Common Ink, run end to end the way a person (in a
// real browser) or an agent (over MCP or the CLI) does them. Each reads as a Gherkin scenario:
//
//   journey("Capture a thought and find it again", ({ given, when, then }) => {
//     given("a vault with a note called Tips", async () => { … });
//     when("I make a new note that links to [[Tips]]", async () => { … });
//     then("Tips lists it under Backlinks", async () => { … });
//   });
//
// Each step is a node:test subtest, so a failure names the step it broke on, and the steps after it
// are skipped rather than failing for the same reason. test/journeys/README.md lists the journeys.
import { after, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { tempVault } from "../helpers.ts";

export const ROOT = path.resolve(import.meta.dirname, "../..");

/** Undone when the test file ends: servers, agents, the browser. (A step's own `after` would run as the step ends.) */
const cleanups: Array<() => unknown> = [];
after(async () => {
  for (const c of cleanups.reverse()) await c();
});

/** `todo`: a step the app doesn't pass yet, saying why (an issue): reported, but not failing the run. */
type Step = (text: string, run: () => unknown, opts?: { todo: string }) => void;
type Keywords = { given: Step; when: Step; then: Step; and: Step };

/** A scenario: its steps run in order, each named `Given …`, `When …`, `Then …` or `And …`. */
export function journey(title: string, define: (k: Keywords) => void, opts: { skip?: string | false } = {}) {
  const steps: Array<{ name: string; run: () => unknown; todo?: string }> = [];
  const step = (keyword: string): Step => (text, run, o) => void steps.push({ name: `${keyword} ${text}`, run, todo: o?.todo });
  define({ given: step("Given"), when: step("When"), then: step("Then"), and: step("And") });
  test(title, { skip: opts.skip || false }, async (t) => {
    let failed: string | undefined;
    t.after(async () => {
      for (const c of contexts) await c.close();
      contexts.clear();
    });
    for (const s of steps) {
      if (failed) {
        await t.test(s.name, { skip: `"${failed}" failed` }, () => {});
        continue;
      }
      if (s.todo) {
        await t.test(s.name, { todo: s.todo }, async () => void (await s.run()));
        continue;
      }
      await t.test(s.name, async () => {
        try {
          await s.run();
        } catch (e) {
          failed = s.name;
          const shots = await screenshots(title);
          if (shots.length && e instanceof Error) e.message += `\n\nThe page then: ${shots.join(", ")}`;
          throw e;
        }
      });
    }
    if (failed) throw new Error(`Stopped at: ${failed}`);
  });
}

/** Waits until `check` passes (it throws or returns false until then), or fails with its last error. */
export async function eventually<T>(check: () => T | Promise<T>, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const v = await check();
      if (v !== false) return v;
      if (Date.now() > end) throw new Error("still false");
    } catch (e) {
      if (Date.now() > end) throw e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * The local app (its API, live updates and the Vite-served UI) on a fresh vault holding `files`,
 * stopped when the test file ends.
 */
export async function startLocalApp(files: Record<string, string>) {
  const vault = tempVault(files);
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/main.ts"], {
    cwd: ROOT,
    env: { ...process.env, COMMONINK_VAULT: vault, PORT: "0", COMMONINK_NO_UI: "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  cleanups.push(() => server.kill());
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    server.stdout!.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    server.on("exit", (code) => reject(new Error(`the app's server exited (${code})`)));
  });
  const origin = `http://localhost:${port}`;
  return {
    vault,
    origin,
    /** A note's markdown as it is on disk. */
    read: (rel: string) => fs.readFileSync(path.join(vault, rel), "utf8"),
    exists: (rel: string) => fs.existsSync(path.join(vault, rel)),
    /** A write straight to the file, the way another editor or a sync tool changes it. */
    write: (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    },
  };
}

/** Browser profiles opened in the running journey, closed when it ends. */
const contexts = new Set<BrowserContext>();
/** Their pages, photographed when a step fails. */
const pages = new Set<Page>();

async function screenshots(title: string): Promise<string[]> {
  const dir = process.env.JOURNEY_ARTIFACTS || path.join(os.tmpdir(), "commonink-journeys");
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  let i = 0;
  for (const page of pages) {
    const file = path.join(dir, `${title.replace(/[^\w]+/g, "-")}-${++i}.png`);
    if (!page.isClosed()) await page.screenshot({ path: file }).then(() => out.push(file), () => {});
  }
  return out;
}

/** The `commonink` CLI on `vault`, the way a shell agent runs it. */
export function commonink(vault: string, args: string[], input?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(path.join(ROOT, "bin/commonink"), args, { env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** An agent connected to `vault` over MCP (stdio), calling itself `name`; disconnected when the file ends. */
export async function mcpAgent(vault: string, name: string) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "COMMONINK_AGENT"));
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: path.join(ROOT, "bin/commonink"), args: ["mcp"], env: { ...env, COMMONINK_VAULT: vault } }));
  cleanups.push(() => client.close());
  /** A tool call's text, and whether it was an error. */
  return async (tool: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
  };
}

let browser: Promise<Browser | string> | undefined;

/**
 * Headless Chromium, or why there isn't one. CI installs it (npx playwright-core install
 * chromium-headless-shell); COMMONINK_CHROMIUM points at another build. Without one, the browser
 * journeys are skipped locally and fail in CI.
 */
export function chromium(): Promise<Browser | string> {
  browser ??= (async () => {
    try {
      const { chromium } = await import("playwright-core");
      const b = await chromium.launch({ executablePath: process.env.COMMONINK_CHROMIUM || undefined });
      cleanups.push(() => b.close());
      return b;
    } catch (e) {
      const why = `no Chromium for the browser journeys (npx playwright-core install chromium-headless-shell, or set COMMONINK_CHROMIUM): ${(e as Error).message.split("\n")[0]}`;
      if (process.env.CI) throw new Error(why);
      return why;
    }
  })();
  return browser;
}

/** A person in a fresh browser profile (Vim keys on, as on every test site), with the app open on `url`: at a computer, or holding `device` (a phone's touch screen). */
export async function person(b: Browser, url: string, device: { width: number; height: number; touch?: boolean } = { width: 1400, height: 900 }): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const { touch = false, ...viewport } = device;
  const context = await b.newContext({ viewport, hasTouch: touch, isMobile: touch, timezoneId: process.env.TZ || undefined });
  contexts.add(context);
  // A new workspace asks how its agents should organize notes; these journeys are about other things.
  await context.addInitScript(() => localStorage.setItem("commonink.organizingAsked.local", "true"));
  const page = await context.newPage();
  pages.add(page);
  page.on("close", () => pages.delete(page));
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  return { context, page, errors };
}
