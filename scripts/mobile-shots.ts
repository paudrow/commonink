// Photograph every screen of the app at phone, tablet and desktop widths, and measure what makes a
// screen hard to use by touch: sideways scroll, and tap targets under 44px. Run it against an app
// signed in by DEV_LOGIN and filled by preview-demo.ts:
//
//   npm run cloud:dev                                                   # or a pull request's Preview
//   node --import tsx scripts/preview-demo.ts http://localhost:8787
//   node --import tsx scripts/mobile-shots.ts http://localhost:8787 out/ [--widths 375,393] [--only tasks,calendar] [--now 2026-10-03T12:00:00]
//
// Writes <screen>-<width>.png and report.json (per shot: the overflow in px, and the small targets).
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const widths = (flag("widths") ?? "375,393,412,768,1024,1280").split(",").map(Number);
const only = flag("only")?.split(",");
/** A fixed time for the browser's clock, so two runs show the same "5m ago" and can be compared pixel for pixel. */
const now = flag("now");
const origin = new URL(args[0] ?? "").origin;
const out = path.resolve(args[1] ?? "mobile-shots");

/** A width's screen: phones and tablets are touch screens, as the app's media queries ask. */
const DEVICES: Record<number, { height: number; touch: boolean }> = {
  375: { height: 667, touch: true },
  393: { height: 852, touch: true },
  412: { height: 915, touch: true },
  768: { height: 1024, touch: true },
  1024: { height: 768, touch: true },
  1280: { height: 800, touch: false },
  1440: { height: 900, touch: false },
};

type Screen = { name: string; signedOut?: boolean; go: (page: Page, width: number) => Promise<void> };

const note = (p: string) => `/#/${p.split("/").map(encodeURIComponent).join("/")}`;
const EDITOR = "#editor-host .cm-content";
const settle = (page: Page, ms = 500) => page.waitForTimeout(ms);

async function open(page: Page, url: string, ready: string) {
  await page.goto(origin + url);
  await page.locator(ready).first().waitFor({ state: "visible" });
  // A note is ready when its text is in the editor, not just the editor.
  if (ready === EDITOR) await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? "").length > 0, EDITOR);
  await page.waitForLoadState("networkidle").catch(() => {});
  await settle(page, ready === EDITOR ? 900 : 700);
}

/** Put the cursor at the end of the open note and type, in Insert mode if Vim keys are on. */
async function typeAtEnd(page: Page, text: string) {
  await page.locator(EDITOR).click();
  await page.keyboard.press("Control+End");
  const vim = await page.locator('#vim-mode[data-mode="normal"]').waitFor({ timeout: 2000 }).then(() => true, () => false);
  if (vim) await page.keyboard.press("o");
  else await page.keyboard.press("Enter");
  await page.keyboard.type(text, { delay: 40 });
  await settle(page, 600);
}

const SCRATCH = "Loose idea.md";
const SCRATCH_TEXT = "# Loose idea\n\nA thought nothing links to yet.\n";
/** The scratch note as it was, so what one screen typed isn't in the next, or in the next run. */
async function resetScratch(page: Page) {
  const me = (await (await page.request.get(`${origin}/api/me`)).json()) as { workspaces: Array<{ id: string; kind: string }> };
  const ws = me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0];
  await page.request.put(`${origin}/api/w/${ws.id}/note`, { headers: { origin }, data: { path: SCRATCH, content: SCRATCH_TEXT } });
}
/** The on-screen keyboard's height, on the phones here. */
const KEYBOARD = 300;
/** A phone's keyboard comes up: the window loses its height, as Android's does (iOS shrinks the visual viewport instead). */
async function keyboardUp(page: Page) {
  const size = page.viewportSize()!;
  if (size.width <= 760) await page.setViewportSize({ width: size.width, height: size.height - KEYBOARD });
  return async () => void (size.width <= 760 && (await page.setViewportSize(size)));
}
const typed = (text: string): Screen["go"] => async (page) => {
  await resetScratch(page);
  await open(page, note(SCRATCH), EDITOR);
  await page.locator(EDITOR).click();
  await keyboardUp(page);
  await typeAtEnd(page, text);
};
const ROADMAP = "Projects/Common Ink roadmap.md";
/** Open the roadmap note and press one of its top-bar buttons: in More on a phone or a touch tablet, in the bar on a computer. */
async function noteButton(page: Page, button: string) {
  await open(page, note(ROADMAP), EDITOR);
  if (await page.locator(button).isVisible()) return page.locator(button).click();
  await page.locator("#more-btn").click();
  const title = (await page.locator(button).getAttribute("title"))!.replace(/\s*\(.*\)$/, "").split(" · ").pop()!;
  await page.locator("#more-menu").getByRole("menuitem", { name: title }).click();
}

const SCREENS: Screen[] = [
  { name: "sign-in", signedOut: true, go: async (page) => void (await page.goto(origin + "/")) },
  { name: "notes", go: (page) => open(page, "/notes", "#notes-view .feed-card") },
  { name: "drawer", go: async (page, width) => {
    await open(page, "/notes", "#notes-view .feed-card");
    if (width <= 760) await page.locator("#menu-btn").click();
    await settle(page);
  } },
  { name: "editor", go: (page) => open(page, note("Projects/Common Ink roadmap.md"), EDITOR) },
  { name: "editor-long", go: (page) => open(page, note("Try/GitHub-flavored markdown/GitHub markdown sampler.md"), EDITOR) },
  { name: "editor-more-menu", go: async (page) => {
    await open(page, note("Projects/Common Ink roadmap.md"), EDITOR);
    await page.locator("#more-btn").click();
    await settle(page);
  } },
  { name: "editor-keyboard", go: async (page) => {
    await open(page, note(ROADMAP), EDITOR);
    await page.locator(EDITOR).click();
    await keyboardUp(page);
    await settle(page);
  } },
  { name: "editor-share-menu", go: async (page) => {
    await noteButton(page, "#share-btn");
    await settle(page);
  } },
  { name: "editor-move-picker", go: async (page) => {
    await noteButton(page, "#move-btn");
    await settle(page);
  } },
  { name: "editor-slash", go: typed("/") },
  { name: "editor-link-picker", go: typed("[[") },
  { name: "editor-mention", go: typed("@") },
  { name: "today", go: (page) => open(page, "/today", "#today-view > *") },
  { name: "tasks", go: (page) => open(page, "/tasks", "#tasks-view > *") },
  { name: "task-fields", go: async (page) => {
    await open(page, "/tasks", "#tasks-view .qt-row");
    await page.locator("#tasks-view .qt-row").first().hover();
    await page.locator('#tasks-view .qt-row .qt-act[aria-label="Task fields"]').first().click();
    await settle(page);
  } },
  { name: "notes-card-menu", go: async (page) => {
    await open(page, "/notes", "#notes-view .feed-card");
    await page.locator("#notes-view .feed-card").first().click({ button: "right", position: { x: 40, y: 12 } });
    await settle(page);
  } },
  { name: "new-folder-prompt", go: async (page, width) => {
    await open(page, "/notes", "#notes-view .feed-card");
    if (width <= 760) await page.locator("#menu-btn").click();
    await page.locator("#new-folder").click();
    await settle(page);
  } },
  { name: "kanban", go: (page) => open(page, note("Try/Kanban boards/Launch board.md"), EDITOR) },
  { name: "calendar", go: (page) => open(page, "/calendar", "#calendar-view .cal") },
  { name: "calendar-week", go: async (page) => {
    await open(page, "/calendar", "#calendar-view .cal");
    await page.locator(".cal-views button", { hasText: "Week" }).click();
    await settle(page);
  } },
  { name: "calendar-month", go: async (page) => {
    await open(page, "/calendar", "#calendar-view .cal");
    await page.locator(".cal-views button", { hasText: "Month" }).click();
    await settle(page);
  } },
  { name: "search", go: async (page, width) => {
    await open(page, "/notes", "#notes-view .feed-card");
    await page.locator(width <= 760 ? "#search-top" : "#search-btn").click();
    await page.locator("#palette-input").fill("launch");
    await settle(page);
  } },
  { name: "contacts", go: (page) => open(page, "/contacts", "#contacts-view > *") },
  { name: "contact", go: async (page) => {
    await open(page, "/contacts", "#contacts-view > *");
    await page.getByText("Mina Okafor").first().click();
    await settle(page);
  } },
  { name: "tags", go: (page) => open(page, "/tags", "#tags-view > *") },
  { name: "assets", go: (page) => open(page, "/assets", "#assets-view > *") },
  { name: "history", go: (page) => open(page, "/history", "#history-view > *") },
  { name: "archive", go: (page) => open(page, "/archive", "#notes-view > *") },
  { name: "trash", go: (page) => open(page, "/trash", "#notes-view > *") },
  { name: "shared", go: (page) => open(page, "/shared", "#shared-view > *") },
  { name: "settings", go: async (page) => {
    await open(page, "/notes", "#notes-view .feed-card");
    await page.keyboard.press("Control+,");
    await page.locator("#settings").waitFor({ state: "visible" });
    await settle(page);
  } },
];

/** What's wrong for a finger on the page as it stands: sideways scroll, and visible controls under 44px. */
function measure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const name = (n: Element) => {
    const label = n.getAttribute("aria-label") || n.getAttribute("title") || (n.textContent ?? "").trim().slice(0, 30);
    return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${typeof n.className === "string" && n.className ? "." + n.className.split(/\s+/).slice(0, 2).join(".") : ""} "${label}"`;
  };
  const small: string[] = [];
  const wide: string[] = [];
  for (const n of document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=button], [role=menuitem], [role=option], [role=tab], summary")) {
    if (n.closest("[hidden], [inert]")) continue;
    let r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const style = getComputedStyle(n);
    if (style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") continue;
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    if (!hit || !(n.contains(hit) || hit.contains(n) || n.closest("label")?.contains(hit))) continue;
    // A control inside a label, or with a grown ::after, is tapped by the larger area.
    const label = n.closest("label");
    if (label) r = label.getBoundingClientRect();
    const after = getComputedStyle(n, "::after");
    let w = r.width;
    let h = r.height;
    if (after.content !== "none" && after.position === "absolute") {
      if (style.position === "static" && n.offsetParent) {
        // The ::after is laid out in the nearest positioned ancestor (a month's day fills its cell).
        const box = n.offsetParent.getBoundingClientRect();
        w = box.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0);
        h = box.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0);
      } else {
        w += -(parseFloat(after.left) || 0) - (parseFloat(after.right) || 0);
        h += -(parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0);
      }
    }
    if (w < 43.5 && h < 43.5) small.push(`${name(n)} ${Math.round(w)}x${Math.round(h)}`);
    else if (h < 43.5 && !(n instanceof HTMLAnchorElement && style.display === "inline")) small.push(`${name(n)} ${Math.round(w)}x${Math.round(h)}`);
  }
  for (const n of document.querySelectorAll<HTMLElement>("body *")) {
    if (n.closest("[hidden]")) continue;
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.top >= vh || r.bottom <= 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    // Clipped or scrolled by an ancestor on purpose (tabs, a week grid, a code block): not the page's overflow.
    let clipped = false;
    for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      const pr = p.getBoundingClientRect();
      if (o !== "visible" && pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; }
      if (getComputedStyle(p).opacity === "0") { clipped = true; break; }
      if (getComputedStyle(p).position === "fixed" && getComputedStyle(p).transform !== "none" && pr.right <= 0) { clipped = true; break; } // the closed drawer
    }
    if (!clipped && getComputedStyle(n).visibility !== "hidden" && getComputedStyle(n).opacity !== "0" && !(r.right <= 0)) wide.push(`${name(n)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return {
    overflow: Math.max(0, document.documentElement.scrollWidth - vw, document.body.scrollWidth - vw),
    wide: wide.slice(0, 12),
    smallCount: small.length,
    small: small.slice(0, 40),
  };
}

async function signedIn(browser: Browser, width: number) {
  const d = DEVICES[width] ?? { height: 900, touch: width < 1100 };
  const context = await browser.newContext({ viewport: { width, height: d.height }, hasTouch: d.touch, isMobile: d.touch && width < 760, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  await context.addInitScript("window.__name = (f) => f"); // tsx names the functions it compiles; measure() runs in the page
  // Each page load starts with no tabs open and the calendar on its own first view.
  await context.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (/^commonink\.(tabs:|calendarView)/.test(k)) localStorage.removeItem(k);
  });
  // Vim keys are on at test sites; a phone has no Esc key, so its screens are taken as a new person's.
  if (d.touch) await context.addInitScript(() => localStorage.setItem("commonink.vim", "false"));
  const page = await context.newPage();
  if (now) await page.clock.setFixedTime(new Date(now));
  page.setDefaultTimeout(15_000);
  return { context, page };
}

fs.mkdirSync(out, { recursive: true });
const reportFile = path.join(out, "report.json");
const report: Record<string, ReturnType<typeof measure> | { error: string }> = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : {};
const browser = await chromium.launch({ executablePath: process.env.COMMONINK_CHROMIUM || undefined });
for (const width of widths) {
  const { context, page } = await signedIn(browser, width);
  await page.goto(`${origin}/auth/dev?next=/`);
  await page.waitForLoadState("networkidle");
  const anon = await signedIn(browser, width);
  for (const screen of SCREENS) {
    if (only && !only.includes(screen.name)) continue;
    const key = `${screen.name}-${width}`;
    const p = screen.signedOut ? anon.page : page;
    try {
      await screen.go(p, width);
      await p.screenshot({ path: path.join(out, `${key}.png`) });
      report[key] = await p.evaluate(measure);
      console.log(key, `overflow ${report[key].overflow}px, ${report[key].smallCount} small targets`);
    } catch (e) {
      await p.screenshot({ path: path.join(out, `${key}.png`) }).catch(() => {});
      report[key] = { error: (e as Error).message.split("\n")[0] };
      console.log(key, "FAILED", report[key].error);
    }
    await p.keyboard.press("Escape").catch(() => {});
    if (p.viewportSize()!.height !== (DEVICES[width]?.height ?? 900)) await p.setViewportSize({ width, height: DEVICES[width]?.height ?? 900 });
  }
  await resetScratch(page);
  await anon.context.close();
  await context.close();
}
await browser.close();
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
