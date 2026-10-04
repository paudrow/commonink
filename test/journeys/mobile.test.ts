// The journeys a person takes on a phone, by touch, in a real browser emulating an iPhone 15 and a
// Pixel 7 (Playwright's devices: the screen, touch, and user agent of each). Each phone has its own
// servers and vault, so one phone's ticks and moves aren't in the other's notes. Signing in runs
// against the hosted Worker (test/cloud.ts) serving the web app as built; the rest run on the local app.
import { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, type Page } from "playwright-core";
import { startCloud } from "../cloud.ts";
import { chromium, commonink, eventually, journey, person, ROOT, startLocalApp } from "./journey.ts";

const b = await chromium();
const skip = typeof b === "string" ? b : false;
const browser = typeof b === "string" ? undefined! : b;

const PHONES = ["iPhone 15", "Pixel 7"] as const;
/** The on-screen keyboard's height. */
const KEYBOARD = 300;

const FILES = {
  "Tips.md": "# Tips\n\nKeep notes short.\n",
  "Pocket.md": "# Pocket\n\nWritten on the train.\n",
  "Chores.md": "# Chores\n\n- [ ] Water the plants\n- [ ] Take out the bins\n",
  "Someday.md": "# Someday\n\nThings that can wait.\n",
  "Trip.md": "# Trip\n\n:::kanban\n## To book\n- [ ] Train to Porto\n- [ ] Two nights near Ribeira\n\n## Booked\n- [ ] Flights\n\n## Done\n:::\n",
  "People/Mina Okafor.md": "---\nemail: mina@example.com\ncompany: Acme\nrole: Designer\n---\n# Mina Okafor\n\nMet at the spring meetup.\n",
  "People/Jo Park.md": "---\nemail: jo@example.com\n---\n# Jo Park\n",
};

/** The web app as built, for the hosted Worker to serve: the sign-in journey lands in the real app. */
function buildApp(): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-app-"));
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "web", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`vite build failed: ${r.stderr || r.stdout}`);
  return out;
}

const built = skip ? "" : buildApp();
after(() => built && fs.rmSync(built, { recursive: true, force: true }));

for (const phone of PHONES) {
  const device = devices[phone];
  // Its own hosted Worker too: each phone signs in to an account nobody has used.
  const cloud = skip ? undefined! : await startCloud({}, built);
  after(() => cloud?.close());
  const app = skip ? undefined! : await startLocalApp(FILES);
  const size = device.viewport!;

  /** A person holding this phone, with the app open on `url`; Vim keys off, as for anyone new. */
  async function onPhone(url: string): Promise<Page> {
    const { context, page } = await person(browser, "about:blank", device);
    await context.addInitScript(() => localStorage.setItem("commonink.vim", "false"));
    await page.goto(url);
    return page;
  }
  /** The keyboard comes up or goes: the window loses its height to it, as Android's does. */
  const keyboard = (page: Page, up: boolean) => page.setViewportSize({ width: size.width, height: size.height - (up ? KEYBOARD : 0) });
  /** Where a control is, once it shows (search results come a moment after the typing). */
  const box = (page: Page, sel: string) =>
    eventually(async () => {
      const r = await page.locator(sel).first().boundingBox();
      assert.ok(r, `${sel} isn't showing`);
      return r;
    });
  const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  /** A control is big enough for a finger: 44px each way. */
  async function tappable(page: Page, sel: string, what: string) {
    const r = await box(page, sel);
    assert.ok(r.width >= 44 && r.height >= 44, `${what} is ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  /** The file in the vault whose text has `text`, as it is on disk. */
  function fileWith(text: string): { path: string; text: string } | undefined {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(app.vault, dir), { withFileTypes: true }).flatMap((e) => (e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const p of walk("")) {
      if (!p.endsWith(".md")) continue;
      const body = app.read(p);
      if (body.includes(text)) return { path: p, text: body };
    }
  }
  /** Tap into the open note at its end, and the keyboard comes up. */
  async function tapIntoNote(page: Page) {
    await page.locator("#editor-host .cm-content").tap();
    await page.keyboard.press("Control+End");
    await keyboard(page, true);
    await page.locator("#kb-bar").waitFor();
  }
  /**
   * Enter, and a moment for it to land: for Android's Chrome, CodeMirror holds a key until the next
   * frame (the keyboard there reports keys late), and a key typed before that would overtake it.
   */
  async function enter(page: Page) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
  }
  const tool = (page: Page, name: string) => page.locator("#kb-bar").getByRole("button", { name, exact: true });

  journey(`${phone}: sign in`, ({ given, when, then, and }) => {
    let page: Page;
    given("the front page, signed out", async () => {
      page = await onPhone(cloud.origin);
      await page.getByRole("heading", { level: 1 }).waitFor();
    });
    then("it fits the phone, and Sign in is big enough to tap", async () => {
      assert.equal(await sideways(page), 0);
      await tappable(page, "a.signin", "Sign in");
    });
    when("I tap Sign in", async () => {
      await page.locator("a.signin").tap();
    });
    then("I'm in the app, with its bar along the bottom", async () => {
      await page.locator("#bottom-nav").waitFor();
      assert.deepEqual(await page.locator("#bottom-nav button").allTextContents(), ["Today", "Notes", "Tasks", "Search", "Menu"]);
      assert.equal(await sideways(page), 0);
    });
    and("a new workspace's first question rises from the bottom, the screen's width, and Decide later closes it", async () => {
      // New here, the app asks how agents should organize notes (organizing.ts).
      const ask = page.locator(".ask .ask-box");
      await ask.waitFor();
      await eventually(async () => {
        const r = (await ask.boundingBox())!;
        assert.deepEqual([r.x, r.width, Math.round(r.y + r.height)], [0, size.width, size.height]);
      });
      const later = ask.getByRole("button", { name: /Decide later/ });
      const r = (await later.boundingBox())!;
      assert.ok(r.height >= 44, `Decide later is ${r.height}px tall`);
      await later.tap();
      await page.locator(".ask").waitFor({ state: "hidden" });
    });
    and("Menu has my account at its foot", async () => {
      await page.locator("#menu-btn").tap();
      await page.locator("#sidebar .acct-name").waitFor();
      assert.ok(((await page.locator("#sidebar .acct-name").textContent()) ?? "").trim().length > 0);
    });
  }, { skip });

  journey(`${phone}: navigate with the mobile nav`, ({ given, when, then, and }) => {
    let page: Page;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    then("a bar along the bottom has Today, Notes, Tasks, Search and Menu, each big enough to tap", async () => {
      assert.deepEqual(await page.locator("#bottom-nav button").allTextContents(), ["Today", "Notes", "Tasks", "Search", "Menu"]);
      for (const id of ["bn-today", "bn-notes", "bn-tasks", "search-top", "menu-btn"]) await tappable(page, `#${id}`, id);
      assert.equal(await page.locator("#bn-notes").getAttribute("aria-current"), "page");
      await page.locator("#sidebar").waitFor({ state: "hidden" });
    });
    when("I tap Tasks, then Today", async () => {
      await page.locator("#bn-tasks").tap();
      await page.locator("#tasks-view .qt-row", { hasText: "Water the plants" }).waitFor();
      await eventually(async () => assert.equal(await page.locator("#bn-tasks").getAttribute("aria-current"), "page"));
      assert.equal(await sideways(page), 0);
      await page.locator("#bn-today").tap();
    });
    then("each opens and is marked in the bar, and nothing scrolls sideways", async () => {
      await page.locator("#today-view h1").waitFor();
      await eventually(async () => assert.equal(await page.locator("#bn-today").getAttribute("aria-current"), "page"));
      assert.equal(await sideways(page), 0);
    });
    when("I tap Menu, then History in the drawer", async () => {
      await page.locator("#menu-btn").tap();
      await page.locator("body.drawer-open #sidebar").waitFor();
      // The drawer holds what the bar doesn't: no second Search, Today, Notes or Tasks.
      for (const id of ["search-btn", "today-btn", "notes-btn", "tasks-btn"]) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} is in the drawer`);
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).offsetParent !== null && !!document.activeElement!.closest("#sidebar")), true, "the focus is on something the drawer shows");
      await tappable(page, "#history-btn", "History");
      await page.locator("#history-btn").tap();
    });
    then("History opens and the drawer is gone", async () => {
      await page.locator("#history-view h1").waitFor();
      await page.locator("#scrim").waitFor({ state: "hidden" });
      assert.equal(await sideways(page), 0);
    });
    when("I open a note and tap More", async () => {
      await page.goto(`${app.origin}/#/Tips.md`);
      await page.locator("#editor-host .cm-content", { hasText: "Keep notes short" }).waitFor();
      await page.locator("#more-btn").tap();
    });
    then("the note's actions rise from the bottom, the screen's width", async () => {
      await page.locator("#more-menu").getByRole("menuitem", { name: "Move to another folder" }).waitFor();
      await eventually(async () => {
        const r = await box(page, "#more-menu");
        assert.deepEqual([r.x, r.width, Math.round(r.y + r.height)], [0, size.width, size.height]);
      });
    });
    and("a tap outside closes them, and presses nothing under them", async () => {
      await page.touchscreen.tap(150, 24); // on the tabs, behind the sheet
      await page.locator("#more-menu").waitFor({ state: "hidden" });
      await page.locator("#editor-host .cm-content", { hasText: "Keep notes short" }).waitFor();
    });
  }, { skip });

  journey(`${phone}: search for a note and open it`, ({ given, when, then }) => {
    let page: Page;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    when("I tap Search and type a word from Pocket", async () => {
      await page.locator("#search-top").tap();
      await keyboard(page, true);
      await page.locator("#palette-input").fill("train");
    });
    then("search has the whole screen above the keyboard, with a Cancel", async () => {
      const r = await box(page, ".palette-box");
      assert.deepEqual([r.x, r.y, r.width, Math.round(r.height)], [0, 0, size.width, size.height - KEYBOARD]);
      await tappable(page, "#palette-close", "Cancel");
      await tappable(page, "#palette-results .palette-item", "A result");
    });
    when("I tap the result", async () => {
      await page.locator("#palette-results .palette-item", { hasText: "Pocket" }).first().tap();
      await keyboard(page, false);
    });
    then("Pocket opens, with the bottom bar back", async () => {
      await page.locator("#editor-host .cm-content", { hasText: "Written on the train" }).waitFor();
      await page.waitForURL(/\/notes\/pocket-/);
      await page.locator("#bottom-nav").waitFor();
      assert.equal(await sideways(page), 0);
    });
    when("I tap Search again and then Cancel", async () => {
      await page.locator("#search-top").tap();
      await page.locator("#palette-close").tap();
    });
    then("search closes and Pocket is still there", async () => {
      await page.locator("#palette").waitFor({ state: "hidden" });
      await page.locator("#editor-host .cm-content", { hasText: "Written on the train" }).waitFor();
    });
    when("I tap Search, then Advanced search under the search box", async () => {
      await page.locator("#search-top").tap();
      await tappable(page, "#palette-advanced", "Advanced search");
      await page.locator("#palette-advanced").tap();
    });
    then("Notes opens with the Advanced search form over it, inside the screen", async () => {
      await page.locator("#palette").waitFor({ state: "hidden" });
      const form = page.getByRole("dialog", { name: "Advanced search" });
      await form.waitFor();
      await page.locator("#notes-view .feed-card").first().waitFor();
      const r = (await form.boundingBox())!;
      assert.ok(r.x >= 0 && r.x + r.width <= size.width, `the form spans ${r.x} to ${r.x + r.width}`);
    });
  }, { skip });

  journey(`${phone}: write and edit a note with the on-screen keyboard`, ({ given, when, then, and }) => {
    let page: Page;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    when("I tap the round +, then the new note's title, and the keyboard comes up", async () => {
      await tappable(page, "#fab-new", "New note");
      await page.locator("#fab-new").tap();
      // A new note opens with its cursor in the title; a tap on the title brings the keyboard up.
      await page.locator("#editor-host .cm-line").first().tap();
      await keyboard(page, true);
    });
    then("a toolbar stands on the keyboard in the bottom bar's place", async () => {
      await page.locator("#kb-bar").waitFor();
      await page.locator("#bottom-nav").waitFor({ state: "hidden" });
      const bar = await box(page, "#kb-bar");
      assert.equal(Math.round(bar.y + bar.height), size.height - KEYBOARD);
      for (const name of ["Task", "List item", "Link to a note", "Hide the keyboard"]) {
        const r = (await tool(page, name).boundingBox())!;
        assert.ok(r.width >= 44 && r.height >= 44, `${name} is ${r.width}x${r.height}`);
      }
    });
    when("I type a title, tap List item and type two things", async () => {
      await page.keyboard.type("Packing list");
      await enter(page);
      await enter(page);
      // The title names the note: once it has, the rest is typed into Packing list.
      await page.waitForURL(/\/notes\/packing-list-/);
      await eventually(() => app.exists("Packing list.md"));
      await tool(page, "List item").tap();
      await page.keyboard.type("Tent");
      await enter(page);
      await page.keyboard.type("Stove");
    });
    then("the note is saved as I typed it, the cursor never having left it", async () => {
      await eventually(() => assert.equal(app.read("Packing list.md"), "# Packing list\n\n- Tent\n- Stove\n"));
    });
    when("I tap Task, then [[ and pick Tips", async () => {
      await tool(page, "Task").tap();
      await tool(page, "Link to a note").tap();
      await page.locator(".cm-tooltip-autocomplete li", { hasText: "Tips" }).waitFor();
      const list = await box(page, ".cm-tooltip-autocomplete");
      const bar = await box(page, "#kb-bar");
      // The notes to link to are listed across the foot of the note, on the toolbar.
      assert.deepEqual([list.x, list.width, Math.round(list.y + list.height)], [0, size.width, Math.round(bar.y)]);
      await page.locator(".cm-tooltip-autocomplete li", { hasText: "Tips" }).tap();
    });
    then("the last line is a task that links to Tips", async () => {
      await eventually(() => assert.equal(app.read("Packing list.md"), "# Packing list\n\n- Tent\n- [ ] Stove [[Tips]]\n"));
    });
    when("I tap Task again, then hide the keyboard", async () => {
      await tool(page, "Task").tap();
      await tool(page, "Hide the keyboard").tap();
      await keyboard(page, false);
    });
    then("the line is plain text again, its link kept", async () => {
      await eventually(() => assert.equal(app.read("Packing list.md"), "# Packing list\n\n- Tent\nStove [[Tips]]\n"));
    });
    and("the bottom bar is back", async () => {
      await page.locator("#bottom-nav").waitFor();
      await page.locator("#kb-bar").waitFor({ state: "hidden" });
    });
  }, { skip });

  journey(`${phone}: open today's journal and add a task`, ({ given, when, then, and }) => {
    let page: Page;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    when("I tap Today, then the journal's button", async () => {
      await page.locator("#bn-today").tap();
      const journal = page.locator("#today-view .td-journal");
      await journal.waitFor();
      await tappable(page, "#today-view .td-journal", "Today's journal");
      await journal.tap();
    });
    then("today's journal opens as a note", async () => {
      await page.locator("#editor-host .cm-content").waitFor();
      await page.waitForURL(/\/notes\//);
    });
    when("I tap into it, tap Task and type", async () => {
      await tapIntoNote(page);
      await enter(page);
      await tool(page, "Task").tap();
      await page.keyboard.type("Call the vet");
      await tool(page, "Hide the keyboard").tap();
      await keyboard(page, false);
    });
    then("the task is in today's journal on disk", async () => {
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await eventually(() => {
        const file = fileWith("Call the vet");
        assert.ok(file, "no note has the task");
        assert.match(file.text, /^- \[ \] Call the vet$/m);
        assert.ok(file.path.includes(day), `${file.path} isn't today's journal`);
      });
    });
    and("it's among Tasks", async () => {
      await page.locator("#bn-tasks").tap();
      await page.locator("#tasks-view .qt-row", { hasText: "Call the vet" }).waitFor();
    });
  }, { skip });

  journey(`${phone}: check off a task and move it`, ({ given, when, then, and }) => {
    let page: Page;
    const row = (text: string) => page.locator("#tasks-view .qt-row", { hasText: text });
    given("Tasks, with Chores' two tasks", async () => {
      page = await onPhone(`${app.origin}/tasks`);
      await row("Water the plants").waitFor();
      await row("Take out the bins").waitFor();
    });
    then("a task's checkbox and buttons are big enough to tap", async () => {
      for (const b of await row("Take out the bins").locator(".qt-act").all()) {
        if (!(await b.isVisible())) continue;
        const r = (await b.boundingBox())!;
        assert.ok(r.height >= 44 && r.width >= 44, `${await b.getAttribute("aria-label")} is ${r.width}x${r.height}`);
      }
    });
    when("I tap Water the plants' checkbox", async () => {
      await row("Water the plants").locator(".cm-checkbox").tap();
    });
    then("it's ticked in Chores", async () => {
      await eventually(() => assert.match(app.read("Chores.md"), /^- \[x\] Water the plants/m));
    });
    when("I tap Take out the bins' fields, then Move to…", async () => {
      await row("Take out the bins").getByRole("button", { name: "Task fields" }).tap();
      const sheet = page.locator(".folder-picker");
      await sheet.getByText("Move to…").waitFor();
      // The task's fields rise from the bottom, the screen's width.
      await eventually(async () => {
        const r = (await sheet.boundingBox())!;
        assert.deepEqual([r.x, r.width, Math.round(r.y + r.height)], [0, size.width, size.height]);
      });
      await sheet.getByText("Move to…").tap();
    });
    and("pick Someday", async () => {
      const input = page.locator(".folder-picker .fp-input");
      await input.waitFor();
      await input.fill("Someday");
      await page.locator(".folder-picker .fp-item", { hasText: "Someday" }).tap();
    });
    then("the task is in Someday, and no longer in Chores", async () => {
      await eventually(() => {
        assert.match(app.read("Someday.md"), /^- \[ \] Take out the bins/m);
        assert.doesNotMatch(app.read("Chores.md"), /Take out the bins/);
      });
    });
    then(
      "its fields can send it to the backlog and bring it back",
      async () => {
        await row("Take out the bins").getByRole("button", { name: "Task fields" }).tap();
        await page.locator(".folder-picker").getByText(/backlog/i).first().waitFor({ timeout: 2000 });
      },
      { todo: "#374: the task backlog (PR #377) hasn't merged; add the to-and-from-backlog steps here once it has" },
    );
  }, { skip });

  journey(`${phone}: use the kanban by touch`, ({ given, when, then, and }) => {
    let page: Page;
    const column = (name: string) => page.locator(".kb-col", { hasText: name }).first();
    given("the Trip note, with its board", async () => {
      page = await onPhone(`${app.origin}/#/Trip.md`);
      await page.locator(".kb-card", { hasText: "Train to Porto" }).waitFor();
    });
    then("a column nearly fills the screen, and the board swipes sideways inside the page", async () => {
      const col = (await column("To book").boundingBox())!;
      assert.ok(col.width >= size.width * 0.65, `the column is ${Math.round(col.width)}px of ${size.width}`);
      const board = await page.locator(".kb").first().evaluate((n) => ({ scrolls: n.scrollWidth > n.clientWidth, snap: getComputedStyle(n).scrollSnapType }));
      assert.deepEqual(board, { scrolls: true, snap: "x mandatory" });
      assert.equal(await sideways(page), 0);
    });
    when("I swipe to the next column", async () => {
      await page.locator(".kb").first().evaluate((n) => n.scrollTo({ left: n.clientWidth * 0.8 }));
    });
    then("Booked is in view", async () => {
      await eventually(async () => {
        const r = (await column("Booked").boundingBox())!;
        assert.ok(r.x >= 0 && r.x < size.width / 2, `Booked starts at ${Math.round(r.x)}px`);
      });
      await page.locator(".kb").first().evaluate((n) => n.scrollTo({ left: 0 }));
    });
    when("I tap Add card under To book and type one", async () => {
      const add = column("To book").locator(".kb-add");
      const r = (await add.boundingBox())!;
      assert.ok(r.height >= 44, `Add card is ${r.height}px tall`);
      await add.tap();
      await keyboard(page, true);
      await page.keyboard.type("Dinner with Ana");
      await enter(page);
      await enter(page); // nothing typed: the field closes
      await keyboard(page, false);
    });
    then("the card is in the note, under To book", async () => {
      await eventually(() => assert.match(app.read("Trip.md"), /## To book\n(- \[ \] .*\n)*- \[ \] Dinner with Ana\n/));
      await page.locator(".kb-card", { hasText: "Dinner with Ana" }).waitFor();
    });
    when("I tap Train to Porto's Move button and pick Done", async () => {
      const move = page.locator(".kb-card", { hasText: "Train to Porto" }).getByRole("button", { name: "Move to another column" });
      const r = (await move.boundingBox())!;
      assert.ok(r.width >= 36 && r.height >= 36, `Move is ${r.width}x${r.height}`);
      await move.tap();
      const sheet = page.locator(".kb-menu");
      await sheet.getByRole("button", { name: "Done" }).waitFor();
      await eventually(async () => {
        const s = (await sheet.boundingBox())!;
        assert.deepEqual([s.x, s.width, Math.round(s.y + s.height)], [0, size.width, size.height]);
      });
      await sheet.getByRole("button", { name: "Done" }).tap();
    });
    then("the card is under Done in the note, ticked", async () => {
      await eventually(() => {
        const md = app.read("Trip.md");
        assert.match(md.slice(md.indexOf("## Done")), /^## Done\n- \[x\] Train to Porto/);
        assert.doesNotMatch(md.slice(0, md.indexOf("## Booked")), /Train to Porto/);
      });
    });
    and("the page still doesn't scroll sideways", async () => {
      assert.equal(await sideways(page), 0);
    });
  }, { skip });

  journey(`${phone}: open a contact`, ({ given, when, then, and }) => {
    let page: Page;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    when("I tap Menu, then Contacts", async () => {
      await page.locator("#menu-btn").tap();
      await page.locator("#contacts-btn").tap();
    });
    then("the people are listed, each row big enough to tap", async () => {
      await page.locator("#contacts-view .ct-row", { hasText: "Mina Okafor" }).waitFor();
      await tappable(page, "#contacts-view .ct-row", "A person's row");
      assert.equal(await sideways(page), 0);
    });
    when("I tap Mina Okafor", async () => {
      await page.locator("#contacts-view .ct-row", { hasText: "Mina Okafor" }).tap();
    });
    then("her page shows her name on one line, her email, and Edit note across the page", async () => {
      const name = page.locator("#contacts-view .ct-person h1");
      await name.waitFor();
      assert.equal(await name.textContent(), "Mina Okafor");
      const lines = await name.evaluate((n) => n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight));
      assert.ok(lines < 1.5, `her name takes ${lines.toFixed(1)} lines`);
      await page.locator("#contacts-view .ct-fields a", { hasText: "mina@example.com" }).waitFor();
      await tappable(page, "#contacts-view .ct-person .qw-btn", "Edit note");
      assert.equal(await sideways(page), 0);
    });
    and("the page scrolls inside the app, under the top bar", async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollTop), 0);
      assert.equal(await page.locator("#contacts-view").evaluate((n) => getComputedStyle(n).overflowY), "auto");
    });
    when("I tap Contacts at the top", async () => {
      await page.locator("#contacts-view .ct-back").tap();
    });
    then("the list is back", async () => {
      await page.locator("#contacts-view .ct-row", { hasText: "Jo Park" }).waitFor();
    });
  }, { skip });

  journey(`${phone}: filter and sort Notes`, ({ given, when, then, and }) => {
    let page: Page;
    const head = (page: Page) => page.locator("#notes-view .feed-head");
    /** How far the search box's top is below the top of the list's own screen (negative: it's off the top). */
    const searchTop = async (page: Page) => (await box(page, "#notes-view .feed-search")).y - (await box(page, "#notes-view")).y;
    given("the app open on Notes", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
    });
    then("the search box has the row: its sort, Advanced search and help wait behind one button", async () => {
      for (const sel of [".feed-sort", ".feed-advanced", ".query-help-link"]) assert.equal(await page.locator(`#notes-view .feed-search ${sel}`).isVisible(), false, `${sel} is in the search box`);
      await tappable(page, "#notes-view .feed-tools", "Sort and search options");
      const input = await box(page, "#notes-view .feed-search input");
      assert.ok(input.width >= size.width * 0.6, `the search box's field is ${Math.round(input.width)}px of ${size.width}`);
      assert.equal(await page.locator("#notes-view .feed-search input").evaluate((n: HTMLInputElement) => n.scrollWidth <= n.clientWidth), true, "the placeholder is cut short");
    });
    when("I tap that button", async () => {
      await page.locator("#notes-view .feed-tools").tap();
    });
    then("a sheet lists the sorts, with the one in use ticked, then Advanced search and Query syntax", async () => {
      const menu = page.getByRole("menu", { name: "Sort and search options" });
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Recently changed", "Recently created", "Newest", "Oldest", "Name", "Advanced search…", "Query syntax"]);
      assert.equal(await menu.getByRole("menuitem", { name: "Recently changed" }).locator("svg").count(), 1);
      await eventually(async () => {
        const r = (await menu.boundingBox())!;
        assert.deepEqual([r.x, r.width, Math.round(r.y + r.height)], [0, size.width, size.height]);
      });
    });
    when("I tap Name", async () => {
      await page.getByRole("menuitem", { name: "Name", exact: true }).tap();
    });
    then("the notes are in the order of their titles", async () => {
      await page.getByRole("menu").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#notes-view .feed-sort").inputValue(), "title");
      await eventually(async () => {
        const titles = await page.locator("#notes-view .feed-card .fc-title").allTextContents();
        assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })));
      });
    });
    when("I scroll down the list", async () => {
      await page.locator("#notes-view").evaluate((n) => n.scrollTo({ top: n.querySelector<HTMLElement>(".feed-list")!.offsetTop + 160 }));
    });
    then("the search and filters slide away, and the notes have the screen", async () => {
      await eventually(async () => {
        assert.match((await head(page).getAttribute("class")) ?? "", /is-tucked/);
        const r = (await head(page).boundingBox())!;
        assert.ok(r.y + r.height <= (await box(page, "#notes-view")).y + 1, `the filters end ${Math.round(r.y + r.height)}px down`);
        assert.equal(await head(page).isVisible(), false); // out of a screen reader's way too, once it has slid off
      });
    });
    when("I scroll back up a little", async () => {
      await page.locator("#notes-view").evaluate((n) => n.scrollBy({ top: -60 }));
    });
    then("the search box and the filters are back at the top, without the tab's line of help", async () => {
      await eventually(async () => {
        assert.doesNotMatch((await head(page).getAttribute("class")) ?? "", /is-tucked/);
        const top = await searchTop(page);
        assert.ok(top >= 0 && top <= 12, `the search box is ${Math.round(top)}px down`);
      });
      const about = await box(page, "#notes-view .feed-about");
      assert.ok(about.y + about.height <= (await box(page, "#notes-view")).y + 1, "the line of help is still showing");
    });
    and("nothing scrolls sideways", async () => {
      assert.equal(await sideways(page), 0);
    });
  }, { skip });

  journey(`${phone}: close a tab`, ({ given, when, then }) => {
    let page: Page;
    const tabs = (page: Page) => page.locator("#top-tabs .tab .tab-name").allTextContents();
    given("the app open on Notes, its only tab", async () => {
      page = await onPhone(`${app.origin}/notes`);
      await page.locator("#notes-view .feed-card").first().waitFor();
      assert.deepEqual(await tabs(page), ["Notes"]);
    });
    then("the tab has no ×: with nothing else open there's nothing to close it to", async () => {
      assert.equal(await page.locator("#top-tabs .tab-x").isVisible(), false);
    });
    when("I long-press Tips and tap Open in new tab", async () => {
      await page.locator("#notes-view .feed-card .fc-title", { hasText: "Tips" }).click({ button: "right" }); // a long press, as the phone reports it
      await page.getByRole("menuitem", { name: "Open in new tab" }).tap();
    });
    then("Tips opens in a second tab, which has a ×", async () => {
      await page.locator("#editor-host .cm-content", { hasText: "Keep notes short" }).waitFor();
      assert.deepEqual(await tabs(page), ["Notes", "Tips"]);
      const x = page.getByRole("button", { name: "Close Tips" });
      await x.waitFor();
      // A finger a little off its centre still lands on the ×, not on the tab under it.
      const r = (await x.boundingBox())!;
      const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".tab-x")?.getAttribute("aria-label"), [r.x + r.width / 2 + 10, r.y + r.height / 2 + 10]);
      assert.equal(hit, "Close Tips");
    });
    when("I tap the ×", async () => {
      await page.getByRole("button", { name: "Close Tips" }).tap();
    });
    then("Tips closes and Notes is back, the only tab again", async () => {
      await page.locator("#notes-view .feed-card").first().waitFor();
      await eventually(async () => assert.deepEqual(await tabs(page), ["Notes"]));
      assert.equal(await page.locator("#top-tabs .tab-x").isVisible(), false);
    });
  }, { skip });

  journey(`${phone}: see that an agent is at work`, ({ given, when, then, and }) => {
    let page: Page;
    const badge = (page: Page) => page.locator("#agents .agents-btn");
    given("Tips open, and nobody else at work", async () => {
      page = await onPhone(`${app.origin}/#/Tips.md`);
      await page.locator("#editor-host .cm-content", { hasText: "Keep notes short" }).waitFor();
      assert.equal(await badge(page).count(), 0);
    });
    when("an agent adds a line to Tips", async () => {
      commonink(app.vault, ["append", "Tips.md", "Number your lists.", "--agent", "Claude"]);
    });
    then("the top bar names it beside its robot, on a button that says what it's for", async () => {
      await badge(page).waitFor();
      assert.equal((await badge(page).locator(".agents-name").textContent())?.trim(), "Claude");
      assert.equal(await badge(page).locator(".agents-name").isVisible(), true);
      assert.match((await badge(page).getAttribute("aria-label")) ?? "", /^Active in the last 15 minutes: Claude.*See what changed$/);
      assert.equal(await sideways(page), 0);
    });
    and("the first time, a note at the foot of the screen explains it", async () => {
      await page.locator("#toasts .toast", { hasText: "Someone else is working in these notes" }).waitFor();
    });
    when("I tap it", async () => {
      await badge(page).tap();
    });
    then("History opens on what the agent changed: the line it added to Tips", async () => {
      await page.locator("#history-view .hist-main", { hasText: "Number your lists." }).waitFor();
      await page.locator("#history-view .hist-main", { hasText: "Tips.md" }).waitFor();
      assert.equal(await sideways(page), 0);
    });
  }, { skip });
}
