// npm run demo:video: record the feature tour for the demo video (#373) as an mp4. It starts the
// online app locally (developer sign-in, the stand-in Google of cloud/src/google-mock.ts), fills a
// new workspace with a small demo vault, and drives it in Chromium with a caption for each step and
// a drawn cursor, since a recorded page has neither.
//
//   npm run demo:video                               record to ~/commonink-demo-video/feature-tour.mp4
//   npm run demo:video -- --out <file.mp4>           somewhere else (never in the repo: media isn't committed)
//   npm run demo:video -- --url https://pr-…         against a Preview (anything with developer sign-in)
//   npm run demo:video -- --size 1920x1080           the default is 1280x720 (larger is the same picture, enlarged)
//   npm run demo:video -- --only calendar,contacts   some scenes (see SCENES in demo-video-tour.ts)
//   npm run demo:video -- --shots <dir>              also save a picture at each caption
//   npm run demo:video -- --headed                   watch it record
//   npm run demo:video -- --serve                    start and fill the local app, then wait (to rehearse by hand)
//
// The part of the video with the real Google consent screen can't be scripted (it needs a person's
// Google sign-in): scripts/demo-video-join.ts joins a screen recording of it onto this one.
// Needs playwright-core's Chromium (npx playwright-core install chromium) and ffmpeg (or FFMPEG=<path>).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { seed } from "./demo-video-seed.ts";
import { SCENES } from "./demo-video-tour.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const flag = (name: string) => args.includes(`--${name}`);
const OUT = path.resolve(opt("out") ?? path.join(os.homedir(), "commonink-demo-video/feature-tour.mp4"));
const [W, H] = (opt("size") ?? "1280x720").split("x").map(Number);
/** The page is laid out this wide whatever the video's size, so the app looks the same; a larger video is this one enlarged (Playwright records a page at its own size, whatever its pixel density). */
const PAGE_W = 1280;
const ONLY = opt("only")?.split(",");
const SHOTS = opt("shots");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
/** The person the tour signs in as: someone new on each run of a Preview, so it starts from the same workspace every time. */
const AS = opt("url") ? `demo${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}` : "";

if (path.relative(ROOT, OUT).split(path.sep)[0] !== "..") throw new Error(`--out must be outside the repo (media isn't committed): ${OUT}`);
if (!W || !H) throw new Error("--size is <width>x<height>, like 1920x1080");

/** playwright-core from PLAYWRIGHT_CORE, node_modules, or npx's cache (as bench/web.ts finds it). */
function playwright(): any {
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

function run(cmd: string, argv: string[], what: string) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`${what} failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
}

/** The online app on this machine, with empty storage of its own: built, migrated, and answering. */
async function startLocal(): Promise<{ origin: string; stop: () => void }> {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-demo-video-"));
  const port = 8800 + Math.floor(Math.random() * 100);
  const wrangler = path.join(ROOT, "node_modules/.bin/wrangler");
  if (!flag("no-build")) run("npm", ["run", "build:web"], "Building the web app");
  run(wrangler, ["d1", "migrations", "apply", "commonink", "--local", "-c", "cloud/wrangler.jsonc", "--persist-to", state], "Applying the migrations");
  const server: ChildProcess = spawn(
    wrangler,
    ["dev", "-c", "cloud/wrangler.jsonc", "--port", String(port), "--local-upstream", `localhost:${port}`, "--persist-to", state, "--var", "DEV_LOGIN:1", "--var", "SESSION_SECRET:demo-video-only"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  server.stdout!.on("data", (d: Buffer) => (log += d));
  server.stderr!.on("data", (d: Buffer) => (log += d));
  const stop = () => {
    try {
      process.kill(-server.pid!); // wrangler and the workerd it started
    } catch {}
    fs.rmSync(state, { recursive: true, force: true });
  };
  const origin = `http://localhost:${port}`;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) break;
    if (await fetch(origin).then((r) => r.ok, () => false)) return { origin, stop };
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`The local app didn't start:\n${log.slice(-2000)}`);
}

/**
 * What the page draws that a recording lacks, on every page the tour visits: the caption bar, a
 * cursor that follows the mouse (with a ring on each click), and a card that covers the page for
 * titles. Set through element.style, which a strict style-src allows.
 */
const OVERLAY = `(() => {
  if (window.top !== window) return;
  const css = (el, s) => Object.assign(el.style, s);
  const make = () => {
    if (document.getElementById("demo-caption")) return;
    const font = "600 19px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif";
    const cap = document.createElement("div");
    cap.id = "demo-caption";
    css(cap, { position: "fixed", left: "50%", bottom: "22px", transform: "translateX(-50%)", width: "max-content", maxWidth: "92%", padding: "10px 20px", borderRadius: "12px", background: "rgba(22,22,34,.92)", color: "#fff", font, textAlign: "center", zIndex: "2147483646", pointerEvents: "none", boxShadow: "0 8px 30px rgba(0,0,0,.3)", opacity: "0", transition: "opacity .25s" });
    const card = document.createElement("div");
    card.id = "demo-card";
    css(card, { position: "fixed", inset: "0", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", background: "#191927", color: "#fff", zIndex: "2147483645", pointerEvents: "none", textAlign: "center", padding: "0 12%" });
    const cur = document.createElement("div");
    cur.id = "demo-cursor";
    css(cur, { position: "fixed", left: "0", top: "0", width: "22px", height: "22px", zIndex: "2147483647", pointerEvents: "none", display: "none" });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute("d", "M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.3 L10 13 L16 13 Z");
    arrow.setAttribute("fill", "#111");
    arrow.setAttribute("stroke", "#fff");
    arrow.setAttribute("stroke-width", "1.4");
    arrow.setAttribute("stroke-linejoin", "round");
    svg.append(arrow);
    cur.append(svg);
    const ring = document.createElement("div");
    ring.id = "demo-ring";
    css(ring, { position: "fixed", width: "36px", height: "36px", margin: "-18px 0 0 -18px", borderRadius: "50%", border: "3px solid #5b5bd6", zIndex: "2147483646", pointerEvents: "none", opacity: "0" });
    document.body.append(cap, card, ring, cur);
    const at = (x, y) => css(cur, { display: "block", transform: "translate(" + (x - 3) + "px," + (y - 2) + "px)" });
    document.addEventListener("mousemove", (e) => at(e.clientX, e.clientY), true);
    document.addEventListener("mousedown", (e) => {
      css(ring, { left: e.clientX + "px", top: e.clientY + "px", transition: "none", opacity: ".9", transform: "scale(.4)" });
      requestAnimationFrame(() => css(ring, { transition: "transform .35s ease-out, opacity .35s ease-out", opacity: "0", transform: "scale(1.2)" }));
    }, true);
    window.__demo = {
      caption(text) {
        cap.textContent = text;
        cap.style.opacity = text ? "1" : "0";
      },
      card(title, sub) {
        card.replaceChildren();
        card.style.display = title ? "flex" : "none";
        if (!title) return;
        cur.style.display = "none"; // until it next moves
        const h = document.createElement("div");
        h.textContent = title;
        css(h, { font: "700 52px/1.15 system-ui, sans-serif", letterSpacing: "-.02em" });
        const s = document.createElement("div");
        s.textContent = sub || "";
        css(s, { font: "400 24px/1.4 system-ui, sans-serif", opacity: ".8" });
        card.append(h, s);
      },
      at,
    };
    window.__demoState?.().then((s) => {
      window.__demo.caption(s.caption);
      if (s.mouse) at(s.mouse[0], s.mouse[1]);
    });
  };
  if (document.body) make();
  else document.addEventListener("DOMContentLoaded", make);
})()`;

/** What a scene has to work with: the page, and the moves of someone showing the app to a camera. */
export interface Tour {
  page: any;
  origin: string;
  /** The address developer sign-in is at, for the person this tour is. */
  signInUrl: (next: string) => string;
  /** Show a caption (until the next one) and hold for `ms`. */
  say(text: string, ms?: number): Promise<void>;
  /** A title card over the whole page for `ms`. */
  card(title: string, sub: string, ms?: number): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Glide the cursor to the middle of what `target` finds (a selector or a locator). */
  moveTo(target: any): Promise<void>;
  click(target: any): Promise<void>;
  /** Type like a person. */
  type(text: string, delay?: number): Promise<void>;
  press(key: string): Promise<void>;
  goto(path: string): Promise<void>;
}

async function record(origin: string) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-demo-raw-"));
  const view = { width: PAGE_W, height: Math.round((PAGE_W * H) / W) };
  const context = await browser.newContext({ viewport: view, recordVideo: { dir: raw, size: view }, locale: "en-US" });
  context.setDefaultTimeout(15_000);
  const state = { caption: "", mouse: null as [number, number] | null };
  await context.exposeBinding("__demoState", () => state);
  await context.addInitScript(OVERLAY);
  // Vim keys are on by default on localhost and Previews (isTestSite); the tour types as most people do.
  await context.addInitScript(`try { localStorage.setItem("commonink.vim", "false") } catch {}`);
  const page = await context.newPage();
  const began = Date.now();
  let shots = 0;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const wait = (ms: number) => page.waitForTimeout(ms);
  const show = (fn: string, ...a: unknown[]) => page.evaluate(([f, v]: [string, unknown[]]) => (window as any).__demo?.[f](...v), [fn, a]).catch(() => {});
  const t: Tour = {
    page,
    origin,
    signInUrl: (next) => `${origin}/auth/dev?next=${encodeURIComponent(next)}${AS ? `&as=${AS}` : ""}`,
    wait,
    async say(text, ms = 2400) {
      state.caption = text;
      await show("caption", text);
      await wait(ms);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++shots).padStart(2, "0")}.png`) });
    },
    async card(title, sub, ms = 3000) {
      await show("caption", "");
      await show("card", title, sub);
      await wait(ms);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++shots).padStart(2, "0")}.png`) });
      await show("card", "");
      await show("caption", state.caption);
    },
    async moveTo(target) {
      const loc = typeof target === "string" ? page.locator(target).first() : target;
      let box = null;
      // A page that's still drawing can replace the element between finding it and measuring it.
      for (let i = 0; i < 5 && !box; i++) {
        await loc.waitFor({ state: "visible" });
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        box = await loc.boundingBox();
        if (!box) await wait(300);
      }
      if (!box) throw new Error(`Nothing to point at: ${target}`);
      const to: [number, number] = [box.x + box.width / 2, box.y + Math.min(box.height / 2, 60)];
      const from = state.mouse ?? [view.width / 2, view.height / 2];
      const steps = Math.max(8, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 28));
      for (let i = 1; i <= steps; i++) {
        const k = 1 - (1 - i / steps) ** 3; // ease out
        await page.mouse.move(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k);
        await wait(10);
      }
      state.mouse = to;
    },
    async click(target) {
      await t.moveTo(target);
      await wait(150);
      await t.moveTo(target); // again, in case the page moved it meanwhile
      await page.mouse.down();
      await wait(70);
      await page.mouse.up();
      await wait(300);
    },
    async type(text, delay = 38) {
      await page.keyboard.type(text, { delay });
    },
    async press(key) {
      await page.keyboard.press(key);
      await wait(300);
    },
    async goto(p) {
      await page.goto(origin + p);
      await show("caption", state.caption);
    },
  };

  let failed: unknown;
  let start = 0;
  try {
    await seed(origin, AS); // in a session of its own: the browser signs in on camera
    await page.goto(origin);
    start = Date.now() - began;
    for (const scene of SCENES) {
      if (ONLY && !ONLY.includes(scene.name) && scene.name !== "sign-in") continue;
      console.log(`Scene: ${scene.name}`);
      await t.say("", 0); // the last scene's caption is over
      await scene.run(t);
    }
    await wait(600);
  } catch (e) {
    failed = e;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "failed.png") }).catch(() => {});
  }
  const video = page.video();
  await context.close();
  await browser.close();
  if (failed) throw failed;
  const webm = await video.path();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // Without the seconds before the first page drew; H.264 at 30 frames a second, which YouTube takes as is.
  run(FFMPEG, ["-y", "-ss", (start / 1000).toFixed(2), "-i", webm, "-an", "-vf", `scale=${W}:${H}:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", OUT], "ffmpeg");
  fs.rmSync(raw, { recursive: true, force: true });
  console.log(`Recorded ${OUT}`);
}

const local = opt("url") ? null : await startLocal();
const origin = local?.origin ?? new URL(opt("url")!).origin;
process.on("SIGINT", () => {
  local?.stop();
  process.exit(130);
});
try {
  if (flag("serve")) {
    await seed(origin, AS);
    console.log(`Filled ${origin}. Sign in at ${origin}/auth/dev?next=/notes (Ctrl+C stops it).`);
    await new Promise(() => {});
  }
  await record(origin);
} finally {
  local?.stop();
}
