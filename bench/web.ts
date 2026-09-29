// npm run bench:web: the web app in headless Chromium against a local server on a made-up vault.
// It times first load, typing in a 5k-line note of tasks, the Tasks page with 5k tasks, scrolling
// Notes, the Tags page with 1k tags, a 500-card board and split view with two 1 MB notes, and
// checks for listeners and nodes left behind after opening and closing panes and popovers.
//
//   npm run bench:web                        against the dev server (Vite)
//   npm run bench:web -- --dist dist         first load only, from a production build
//   PLAYWRIGHT_CORE=/path/to/playwright-core npm run bench:web
//
// Needs playwright-core and its Chromium (npx playwright-core install chromium-headless-shell).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { generateVault, TODAY } from "./vault.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const DIST = opt("dist");
const REPS = Number(opt("reps") ?? 5);
const JSON_OUT = opt("json");

/** playwright-core from PLAYWRIGHT_CORE, node_modules, or npx's cache. */
// Not a dependency, so typed loosely.
async function playwright(): Promise<any> {
  const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core"];
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d, "node_modules/playwright-core"));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return createRequire(import.meta.url)(c);
    } catch {}
  }
  throw new Error("playwright-core not found: set PLAYWRIGHT_CORE, or run `npx playwright-core --version` once");
}

/** A scratch vault: the 1k-note vault, plus the notes the scenarios open. */
function scratchVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-web-bench-"));
  const v = generateVault(1000);
  const put = (rel: string, text: string | Uint8Array) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  for (const [rel, text] of Object.entries(v.files)) put(rel, text);
  for (const [rel, bytes] of Object.entries(v.assets)) put(rel, bytes);
  const people = ["jane", "sam", "priya", "leo"];
  put(
    "Bench/Tasks 5k.md",
    `# Tasks 5k\n\n${Array.from({ length: 5000 }, (_, i) => `- [${i % 4 ? " " : "x"}] Task ${i} about [[Bench/Board]] due:2026-10-${String((i % 28) + 1).padStart(2, "0")} @${people[i % 4]} #work/t${i % 40}${i % 9 ? "" : " rec:weekly"}${i % 7 ? "" : " !high"}`).join("\n")}\n`,
  );
  put("Bench/Tags.md", `# Tags\n\n${Array.from({ length: 1000 }, (_, i) => `#area${i % 10}/group${i % 97}/tag${i}`).join(" ")}\n`);
  const cards = (n: number, from: number) => Array.from({ length: n }, (_, i) => `- [ ] Card ${from + i} @${people[i % 4]} due:2026-10-${String((i % 28) + 1).padStart(2, "0")} #kb/c${i % 20}`).join("\n");
  put("Bench/Board.md", `# Board\n\n:::kanban\n## Backlog\n${cards(250, 0)}\n\n## Doing\n${cards(150, 250)}\n\n## Done\n${cards(100, 400).replaceAll("[ ]", "[x]")}\n:::\n`);
  return dir;
}

function startServer(vault: string, port: number): Promise<() => void> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/main.ts"], {
    cwd: ROOT,
    env: { ...process.env, QUIRE_VAULT: vault, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (d: Buffer) => d.toString().includes("http://localhost:") && resolve(() => child.kill()));
    child.on("exit", (code) => reject(new Error(`server exited (${code})`)));
  });
}

async function startPreview(dist: string, api: number, port: number): Promise<() => void> {
  const { preview } = await import("vite");
  const server = await preview({
    root: path.join(ROOT, "web"),
    logLevel: "silent",
    build: { outDir: path.resolve(dist) },
    preview: { port, strictPort: true, proxy: { "/api": { target: `http://localhost:${api}`, changeOrigin: true } } },
  });
  return () => void server.close();
}

const rows: Array<{ scenario: string; metric: string; runs: number; p50: number; p95: number }> = [];
const pct = (s: number[], p: number) => [...s].sort((a, b) => a - b)[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
function record(scenario: string, metric: string, samples: number[]) {
  const row = { scenario, metric, runs: samples.length, p50: pct(samples, 50), p95: pct(samples, 95) };
  rows.push(row);
  console.log(`${scenario.padEnd(30)} ${metric.padEnd(34)} ${String(row.runs).padStart(5)}  ${row.p50.toFixed(1).padStart(9)}  ${row.p95.toFixed(1).padStart(9)}`);
}

const vault = scratchVault();
const apiPort = 4790 + Math.floor(Math.random() * 100);
const stopServer = await startServer(vault, apiPort);
const appPort = DIST ? apiPort + 200 : apiPort;
const stopPreview = DIST ? await startPreview(DIST, apiPort, appPort) : () => {};
const origin = `http://localhost:${appPort}`;
const { chromium } = await playwright();
const browser = await chromium.launch();
const ids = new Map<string, string>((await (await fetch(`http://localhost:${apiPort}/api/notes`)).json()).map((n: { path: string; id: string }) => [n.path, n.id]));
const noteUrl = (p: string) => `${origin}/notes/x-${ids.get(p)}`;

async function page() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await context.newPage();
  await p.addInitScript(() => {
    // Time from each key press to the frame after it's handled.
    (window as any).__keys = [];
    addEventListener(
      "keydown",
      () => {
        const t = performance.now();
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => (window as any).__keys.push(performance.now() - t);
          ch.port2.postMessage(0);
        });
      },
      true,
    );
    (window as any).__long = [];
    new PerformanceObserver((l) => (window as any).__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: "longtask", buffered: true });
  });
  return { context, p };
}
/**
 * Wait for an element without keeping a handle to it: page.waitForSelector's handles live on in
 * the page and would count as leaked nodes.
 */
const waitFor = (p: any, selector: string, opts: { state?: string; timeout?: number } = {}) => p.locator(selector).first().waitFor({ timeout: 60_000, ...opts });
/** Whether split view shows a note beside the first (a string, for page.waitForFunction). */
const SIDE_SHOWS = `() => !document.querySelector("#side-pane").hidden && document.querySelectorAll("#side-host .cm-line").length > 0`;
const elapsed = async (_p: unknown, fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

console.log(`${"scenario".padEnd(30)} ${"metric".padEnd(34)} ${"runs".padStart(5)}  ${"p50 ms".padStart(9)}  ${"p95 ms".padStart(9)}`);
try {
  // First load: a new browser profile each time, to the Notes page with its first cards drawn.
  {
    const dcl: number[] = [];
    const cards: number[] = [];
    const bytes: number[] = [];
    for (let i = 0; i < REPS; i++) {
      const { context, p } = await page();
      let got = 0;
      p.on("response", (r: any) => void r.body().then((b: Buffer) => (got += b.length)).catch(() => {}));
      const t = performance.now();
      await p.goto(`${origin}/notes`, { waitUntil: "domcontentloaded" });
      dcl.push(performance.now() - t);
      await waitFor(p, ".feed-card", { timeout: 60_000 });
      cards.push(performance.now() - t);
      await p.waitForTimeout(1500); // the requests that follow the first cards
      bytes.push(got / 1024);
      await context.close();
    }
    const label = DIST ? "first load (build)" : "first load (dev server)";
    record(label, "DOMContentLoaded", dcl);
    record(label, "Notes cards drawn", cards);
    record(label, "KB transferred (uncompressed)", bytes);
  }
  if (DIST) throw "done"; // the rest runs against the dev server

  let { context, p } = await page();
  await p.goto(`${origin}/notes`);
  await waitFor(p, ".feed-card");

  // Typing in a 5k-line note of tasks, each line full of chips.
  await p.goto(noteUrl("Bench/Tasks 5k.md"));
  await waitFor(p, ".cm-content .tk", { timeout: 60_000 });
  await p.click(".cm-content");
  await p.keyboard.press("Escape");
  await p.keyboard.type("gg");
  await p.keyboard.type("10jo"); // a new line under the tenth: every line below it moves
  await p.evaluate(() => ((window as any).__keys = []));
  await p.keyboard.type("- [ ] typed due:2026-10-01 @jane #work ", { delay: 30 });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  record("typing (5k-line task note)", "key to next frame", await p.evaluate(() => (window as any).__keys.slice(1)));
  await p.keyboard.type("u"); // undo, so the note is as it was

  // The Tasks page with every task.
  record("Tasks page", "5k+ tasks: first 500 drawn", [
    await elapsed(p, async () => {
      await p.goto(`${origin}/tasks`);
      await p.waitForFunction(() => document.querySelectorAll("#tasks-view .qt-text").length >= 400, undefined, { timeout: 60_000 });
    }),
  ]);
  record("Tasks page", "Show all: every task drawn", [
    await elapsed(p, async () => {
      await p.click("#tasks-view .qt-more");
      await p.waitForFunction(() => document.querySelectorAll("#tasks-view .qt-text").length > 3000, undefined, { timeout: 60_000 });
    }),
  ]);
  record("Tasks page", "DOM nodes", [await p.evaluate(() => document.querySelectorAll("*").length)]);

  // Scrolling Notes to load page after page.
  await p.goto(`${origin}/notes`);
  await waitFor(p, ".feed-card");
  // (A string: the bundler's helpers don't exist in the page.)
  await p.evaluate(`{
    window.__frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 100000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }`);
  await p.mouse.move(700, 450);
  for (let i = 0; i < 60; i++) {
    await p.mouse.wheel(0, 900);
    await p.waitForTimeout(50);
  }
  const frames: number[] = await p.evaluate(() => (window as any).__frames.slice(1));
  record("Notes scroll (60 wheel turns)", "frame time", frames);
  record("Notes scroll (60 wheel turns)", "cards loaded", [await p.evaluate(() => document.querySelectorAll(".feed-card").length)]);

  // The Tags page with 1k tags.
  record("Tags page", "1k tags drawn", [
    await elapsed(p, async () => {
      await p.goto(`${origin}/tags`);
      await p.waitForFunction(() => document.querySelectorAll("#tags-view .tags-row").length >= 10, undefined, { timeout: 60_000 });
    }),
  ]);

  // History and Assets, from the sidebar (each loads when first opened).
  record("History page", "changes drawn", [
    await elapsed(p, async () => {
      await p.click("#history-btn");
      await waitFor(p, "#history-view .hist-row");
    }),
  ]);
  record("Assets page", "assets drawn", [
    await elapsed(p, async () => {
      await p.click("#assets-btn");
      await waitFor(p, "#assets-view .as-card");
    }),
  ]);

  // A board with 500 cards.
  record("Kanban", "500 cards drawn", [
    await elapsed(p, async () => {
      await p.goto(noteUrl("Bench/Board.md"));
      await p.waitForFunction(() => document.querySelectorAll(".kb-card").length >= 500, undefined, { timeout: 60_000 });
    }),
  ]);

  // Split view with two 1 MB notes, in a new profile: with nothing to show beside the first yet, the
  // split button asks which note, and the second opens there.
  await context.close();
  ({ context, p } = await page());
  await p.goto(noteUrl("Logs/Big log 1.md"));
  await waitFor(p, "#editor-host .cm-content");
  await p.click("#split-btn");
  await waitFor(p, "#palette", { state: "visible" });
  await p.keyboard.type("Big log 0");
  await p.waitForTimeout(500);
  record("Split view (two 1 MB notes)", "side pane drawn", [
    await elapsed(p, async () => {
      await p.click("#palette .palette-item >> nth=0");
      await p.waitForFunction(() => document.querySelector("#side-host .cm-content")?.textContent?.includes("Big log 0"), undefined, { timeout: 60_000 });
    }),
  ]);

  // Listeners and nodes left behind: open and close the side pane, the palette and a chip's editor
  // 20 times each (after one round each, so first-use setup doesn't count).
  const cdp = await context.newCDPSession(p);
  await cdp.send("Performance.enable");
  const counts = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = (name: string) => metrics.find((x: { name: string }) => x.name === name)!.value;
    return { listeners: m("JSEventListeners"), nodes: m("Nodes") };
  };
  const cycles: Record<string, () => Promise<void>> = {
    "side pane": async () => {
      await p.click("#split-btn");
      await p.waitForFunction(`!(${SIDE_SHOWS})()`);
      await p.click("#split-btn");
      await p.waitForFunction(SIDE_SHOWS);
    },
    palette: async () => {
      await p.click("#search-btn");
      await waitFor(p, "#palette", { state: "visible" });
      await p.keyboard.press("Escape");
      await waitFor(p, "#palette", { state: "hidden" });
    },
    "chip editor": async () => {
      await p.click("#editor-host .tk[data-field='due']");
      await waitFor(p, ".chip-pop");
      await p.keyboard.press("Escape");
      await waitFor(p, ".chip-pop", { state: "detached" });
    },
  };
  for (const [name, cycle] of Object.entries(cycles)) {
    await cycle();
    const before = await counts();
    for (let i = 0; i < 20; i++) await cycle();
    const after = await counts();
    record(`20 × ${name}`, "listeners left", [after.listeners - before.listeners]);
    record(`20 × ${name}`, "DOM nodes left", [after.nodes - before.nodes]);
  }

  // A change on disk in a note that isn't open: what the page asks for, per change.
  await p.goto(`${origin}/notes`);
  await waitFor(p, ".feed-card");
  await p.waitForTimeout(1000);
  const requests: string[] = [];
  p.on("request", (r: any) => r.url().includes("/api/") && requests.push(new URL(r.url()).pathname));
  for (let i = 0; i < 5; i++) {
    fs.appendFileSync(path.join(vault, "Ideas/External.md"), `\nLine ${i} from outside #work\n- [ ] Outside task ${i}\n`);
    await p.waitForTimeout(1500);
  }
  record("5 changes on disk", "API requests per change", [requests.length / 5]);
  console.log("  requests:", [...new Set(requests)].map((r) => `${r} x${requests.filter((x) => x === r).length}`).join(", "));
  await context.close();
} catch (e) {
  if (e !== "done") throw e;
} finally {
  await browser.close();
  stopPreview();
  stopServer();
  fs.rmSync(vault, { recursive: true, force: true });
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify({ machine: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.platform()} ${os.release()}`, today: TODAY, mode: DIST ? "build" : "dev", rows }, null, 2)}\n`);
