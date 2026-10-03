// The journeys a person takes in the app, in a real browser against the local server. One server and
// vault for the file; each journey has its own notes and its own browser profile.
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { chromium, commonink, eventually, journey, mcpAgent, person, startLocalApp } from "./journey.ts";

const b = await chromium();
const skip = typeof b === "string" ? b : false;
const browser = typeof b === "string" ? undefined! : b;

/** A day from today, as YYYY-MM-DD in this machine's time zone (the browser's too). */
function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const app = skip ? undefined! : await startLocalApp({
  "Tips.md": "# Tips\n\nKeep notes short.\n",
  "Projects/Garden.md": "# Garden\n\nPlant the bulbs before the frost.\n",
  "Pancakes.md": "---\ntags: [recipe, breakfast]\n---\n# Pancakes\n\nFlour, eggs, milk.\n",
  "Soup.md": "# Soup\n\nLeeks and potatoes. #recipe\n",
  "Groceries.md": "# Groceries\n\nEggs and leeks.\n",
  "Shopping.md": "# Shopping\n\nThe list is in [[Groceries]].\n",
  "Errands.md": `# Errands\n\n- [ ] Buy stamps due:${day()}\n- [ ] Return library books due:${day(-1)}\n- [ ] Plan the party due:${day(8)}\n`,
});

/**
 * Type into the open note the way a Vim user does: into Insert mode, type, back to Normal. `{Key}`
 * presses a key, and `{pick}` waits for the suggestions and takes the first.
 */
async function typeInNote(page: Page, keys: string[]) {
  if ((await page.locator("#vim-mode").getAttribute("data-mode")) !== "insert") await page.keyboard.press("i");
  await page.locator('#vim-mode[data-mode="insert"]').waitFor();
  for (const k of keys) {
    if (k === "{pick}") {
      await pickReady(page);
      await page.keyboard.press("Enter");
    } else if (k.startsWith("{") && k.endsWith("}")) await page.keyboard.press(k.slice(1, -1));
    else await page.keyboard.type(k);
  }
  await page.keyboard.press("Escape");
}

/**
 * Waits until the suggestions have settled and can take a key. They fill in as results come back, and
 * CodeMirror ignores Enter for its interactionDelay (75 ms) after the list changes, so an Enter pressed
 * too soon types a new line instead of picking.
 */
async function pickReady(page: Page) {
  const list = page.locator(".cm-tooltip-autocomplete");
  await list.locator("[role=option]").first().waitFor();
  let last = "";
  for (let i = 0; i < 50; i++) {
    const now = await list.innerHTML();
    if (now === last) return;
    last = now;
    await page.waitForTimeout(150);
  }
}

/** Opens a note by name from search (Ctrl+K), as a person does. */
async function openFromSearch(page: Page, query: string, title: string) {
  await page.keyboard.press("Control+k");
  await page.locator("#palette-input").fill(query);
  await page.locator("#palette-results [role=option]", { hasText: title }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator("#editor-host .cm-content", { hasText: title }).waitFor();
}

journey("Capture a thought and find it again", ({ given, when, then }) => {
  let page: Page;
  given("the app open on my notes", async () => {
    ({ page } = await person(browser, app.origin));
    await page.locator(".feed-card", { hasText: "Garden" }).waitFor();
  });
  when("I make a new note, title it and link it to [[Tips]]", async () => {
    await page.getByRole("button", { name: "New note", exact: true }).click();
    // A new note opens with its cursor in the title, ready to type.
    await page.locator('#vim-mode[data-mode="insert"]').waitFor();
    await typeInNote(page, ["Trip plan", "{Enter}", "{Enter}", "Pack light, see [[Tips", "{pick}", " first.", "{Enter}", "{Enter}", "Ask about the flights."]);
  });
  then("it's saved as Trip plan.md, holding the markdown I typed", async () => {
    await eventually(() => assert.equal(app.read("Trip plan.md"), "# Trip plan\n\nPack light, see [[Tips]] first.\n\nAsk about the flights.\n"));
    await page.waitForURL(/\/notes\/trip-plan-/);
  });
  when("I search for a word in it", async () => {
    await page.locator("#sidebar").getByRole("button", { name: "Notes", exact: true }).click();
    await openFromSearch(page, "flights", "Trip plan");
  });
  then("it's the note that opens", async () => {
    await page.waitForURL(/\/notes\/trip-plan-/);
  });
  when("I follow its link to Tips", async () => {
    await page.locator("#editor-host .cm-content").getByText("Tips", { exact: true }).click();
  });
  then("Tips opens, and lists Trip plan among its backlinks", async () => {
    await page.locator("#editor-host .cm-content", { hasText: "Keep notes short." }).waitFor();
    await page.locator("#backlinks", { hasText: "Trip plan" }).waitFor();
  });
});

journey("Plan the day from Today", ({ given, when, then, and }) => {
  let page: Page;
  const today = () => page.locator("#today-view");
  const task = (name: string) => today().getByRole("checkbox", { name });
  given("tasks with due dates in a note called Errands", async () => {
    ({ page } = await person(browser, app.origin));
    await page.locator(".feed-card", { hasText: "Errands" }).waitFor();
  });
  when("I open Today", async () => {
    // Its name goes on with the ring's progress ("Today, 0 of 2 done") once Today has tasks.
    await page.locator("#sidebar").getByRole("button", { name: /^Today\b/ }).click();
    await page.waitForURL(/\/today$/);
  });
  then("it shows what's overdue and what's due today, and nothing later", async () => {
    await today().locator(".td-section", { hasText: "Overdue" }).getByRole("checkbox", { name: "Return library books" }).waitFor();
    await today().locator(".td-section", { hasText: "Due today" }).getByRole("checkbox", { name: "Buy stamps" }).waitFor();
    assert.equal(await task("Plan the party").count(), 0);
  });
  when("I check off Buy stamps", async () => {
    await task("Buy stamps").click();
  });
  then("the note says it's done, and when", async () => {
    await eventually(() => assert.match(app.read("Errands.md"), new RegExp(`^- \\[x\\] Buy stamps due:${day()} done:${day()}$`, "m")));
  });
  and("it leaves Today", async () => {
    await task("Buy stamps").waitFor({ state: "detached" });
  });
  when("I add a task for tomorrow from the Add a task box", async () => {
    await today().getByRole("textbox", { name: "Add a task…" }).click();
    await page.keyboard.type("Call the plumber tomorrow");
    await page.keyboard.press("Enter");
  });
  then("it's written into today's journal note, due tomorrow", async () => {
    await eventually(() => assert.match(app.read(`Journal/${day()}.md`), new RegExp(`^- \\[ \\] Call the plumber due:${day(1)}$`, "m")));
  });
  and("Today doesn't list it, since it isn't due yet", async () => {
    await page.waitForTimeout(300);
    assert.equal(await task("Call the plumber").count(), 0);
  });
});

journey("Gather notes by tag into a view", ({ given, when, then, and }) => {
  let page: Page;
  const cards = () => page.locator("#notes-view .feed-card .fc-title");
  const recipes = () => page.locator("#smart-folders").getByRole("link", { name: /Recipes/ });
  given("two recipes, one tagged in its YAML front matter and one with an inline #recipe", async () => {
    ({ page } = await person(browser, app.origin));
    await page.locator(".feed-card", { hasText: "Pancakes" }).waitFor();
  });
  when("I pick #recipe under Tags in the sidebar", async () => {
    await page.locator("#tag-tree").getByText("recipe", { exact: true }).click();
  });
  then("Notes lists just those two", async () => {
    await eventually(async () => assert.deepEqual((await cards().allTextContents()).sort(), ["Pancakes", "Soup"]));
  });
  when("I save that as a view called Recipes", async () => {
    await page.getByRole("button", { name: "Save as view" }).click();
    await page.getByRole("dialog", { name: "Save as view" }).getByLabel("Name").fill("Recipes");
    await page.getByRole("dialog", { name: "Save as view" }).getByRole("button", { name: "Save" }).click();
  });
  then("Recipes is in the sidebar, holding 2 notes", async () => {
    await eventually(async () => assert.match((await recipes().textContent()) ?? "", /Recipes\s*2/));
  });
  and("an agent sees the same view from the command line", async () => {
    assert.match(commonink(app.vault, ["smart"]).stdout, /^- Recipes \(2 notes\b.*\): tag=recipe /m);
  });
  when("the agent writes a new note with tags: [recipe] in its front matter", async () => {
    const r = commonink(app.vault, ["create", "Shakshuka", "-", "--agent", "Cook"], "---\ntags: [recipe]\n---\n# Shakshuka\n\nEggs in tomato sauce.\n");
    assert.equal(r.status, 0, r.stderr);
  });
  then("Recipes counts it at once, with no reload", async () => {
    await eventually(async () => assert.match((await recipes().textContent()) ?? "", /Recipes\s*3/));
  });
  and("opening Recipes lists all three", async () => {
    await recipes().click();
    await eventually(async () => assert.deepEqual((await cards().allTextContents()).sort(), ["Pancakes", "Shakshuka", "Soup"]));
  });
});

journey("Work alongside an agent, and undo what it did", ({ given, when, then, and }) => {
  let page: Page;
  let agent: Awaited<ReturnType<typeof mcpAgent>>;
  const before = "# Garden\n\nPlant the bulbs before the frost.\n";
  const editor = () => page.locator("#editor-host .cm-content");
  given("Garden open in the app, and an agent called Gardener connected over MCP", async () => {
    assert.equal(app.read("Projects/Garden.md"), before);
    ({ page } = await person(browser, app.origin));
    await openFromSearch(page, "Garden", "Garden");
    agent = await mcpAgent(app.vault, "Gardener");
  });
  when("Gardener adds a task to Garden", async () => {
    const r = await agent("append_to_note", { path: "Projects/Garden", text: "- [ ] Order tulip bulbs" });
    assert.equal(r.isError, false, r.text);
  });
  then("the task shows up in my open note, with no reload", async () => {
    await editor().getByText("Order tulip bulbs").waitFor();
  });
  and("a notice says Gardener changed it, offering Undo", async () => {
    await page.locator("#toasts", { hasText: "Gardener" }).getByRole("button", { name: "Undo" }).waitFor();
  });
  and("the Activity panel credits Gardener", async () => {
    await page.locator("#activity", { hasText: "Gardener" }).waitFor();
  });
  when("I press Undo", async () => {
    await page.locator("#toasts", { hasText: "Gardener" }).getByRole("button", { name: "Undo" }).click();
  });
  then("Garden is back as it was, on disk and on screen", async () => {
    await eventually(() => assert.equal(app.read("Projects/Garden.md"), before));
    await editor().getByText("Order tulip bulbs").waitFor({ state: "detached" });
  });
  and("Gardener, reading it again, finds no tulips", async () => {
    const r = await agent("read_note", { path: "Projects/Garden" });
    assert.doesNotMatch(r.text, /tulip/);
  });
});

journey("Delete a note by mistake and get it back", ({ given, when, then, and }) => {
  let page: Page;
  const groceries = "# Groceries\n\nEggs and leeks.\n";
  given("Groceries open, with Shopping linking to it", async () => {
    assert.equal(app.read("Groceries.md"), groceries);
    ({ page } = await person(browser, app.origin));
    await openFromSearch(page, "Groceries", "Groceries");
    await page.locator("#backlinks", { hasText: "Shopping" }).waitFor();
  });
  when("I delete it from the note's More menu", async () => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete note" }).click();
  });
  then("I'm asked first, and told Shopping links to it", async () => {
    const ask = page.getByRole("alertdialog", { name: "Delete Groceries?" });
    await ask.getByText("Shopping").waitFor();
    await ask.getByRole("button", { name: "Delete" }).click();
  });
  and("it leaves the vault folder and Notes", async () => {
    await eventually(() => assert.equal(app.exists("Groceries.md"), false));
    await page.locator("#sidebar").getByRole("button", { name: "Notes", exact: true }).click();
    await page.locator(".feed-card", { hasText: "Shopping" }).waitFor();
    await page.locator("#notes-view .fc-title", { hasText: "Groceries" }).waitFor({ state: "detached" });
  });
  when("I open Trash and restore it", async () => {
    await page.locator("#notes-view").getByRole("button", { name: "Trash", exact: true }).click();
    await page.locator("#notes-view .feed-card", { hasText: "Groceries" }).getByRole("button", { name: "Restore (r)" }).click();
  });
  then("it's back in the vault folder, unchanged", async () => {
    await eventually(() => assert.equal(app.read("Groceries.md"), groceries));
  });
  and("Shopping's link finds it again", async () => {
    await openFromSearch(page, "Groceries", "Groceries");
    await page.locator("#backlinks", { hasText: "Shopping" }).waitFor();
  });
});

/** Goes to a page by its command (Ctrl+Shift+P, "Go to Tags"), as a person at the keyboard does. */
async function goTo(page: Page, name: string) {
  await page.keyboard.press("Control+Shift+p");
  await page.locator("#palette-input").fill(`>Go to ${name}`);
  await page.locator("#palette-results [role=option]", { hasText: `Go to ${name}` }).first().waitFor();
  await page.keyboard.press("Enter");
}

journey("Move through every list with the same keys", ({ given, when, then, and }) => {
  let page: Page;
  const notes = () => page.locator("#notes-view");
  /** What has the keyboard: its text, or its label. */
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "");
  given("the app open on my notes", async () => {
    ({ page } = await person(browser, app.origin));
    await page.locator("#sidebar").getByRole("button", { name: "Notes", exact: true }).click();
    await notes().locator(".feed-card", { hasText: "Soup" }).waitFor();
  });
  when("I press / and type a note's name", async () => {
    await page.keyboard.press("/");
    await page.keyboard.type("Soup");
    await eventually(async () => assert.deepEqual(await notes().locator(".feed-card .fc-title").allTextContents(), ["Soup"]));
  });
  and("go down to it and press Space", async () => {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
  });
  then("its preview opens in place, and Space folds it again", async () => {
    await notes().locator(".feed-card.is-expanded", { hasText: "Leeks and potatoes." }).waitFor();
    await page.keyboard.press("Space");
    await notes().locator(".feed-card.is-expanded").waitFor({ state: "detached" });
  });
  when("I press Enter", async () => {
    await page.keyboard.press("Enter");
  });
  then("the note opens", async () => {
    await page.waitForURL(/\/notes\/soup-/);
    await page.locator("#editor-host .cm-content", { hasText: "Leeks and potatoes." }).waitFor();
  });
  when("I go to Tags, down from the filter, and on with j", async () => {
    await goTo(page, "Tags");
    await page.locator("#tags-view .tags-row", { hasText: "recipe" }).waitFor();
    await page.keyboard.press("ArrowDown");
    await eventually(async () => assert.match(await focused(), /^#breakfast/));
    await page.keyboard.press("j");
  });
  then("the keyboard is on #recipe, and Enter shows its notes", async () => {
    await eventually(async () => assert.match(await focused(), /^#recipe/));
    await page.keyboard.press("Enter");
    // Earlier journeys may have tagged more recipes; Garden isn't one.
    await eventually(async () => {
      const titles = await notes().locator(".feed-card .fc-title").allTextContents();
      assert.deepEqual([titles.includes("Pancakes"), titles.includes("Soup"), titles.includes("Garden")], [true, true, false]);
    });
  });
  when("I go to Tags again, jump to the ends with G and g, then press /", async () => {
    await goTo(page, "Tags");
    await page.locator("#tags-view .tags-row", { hasText: "recipe" }).waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("G");
    await page.keyboard.press("g");
    await eventually(async () => assert.match(await focused(), /^#breakfast/));
    await page.keyboard.press("/");
    await page.keyboard.type("jk");
  });
  then("I'm typing in the filter, where j and k are letters", async () => {
    assert.equal(await page.locator("#tags-view input").inputValue(), "jk");
  });
  /** Presses j until the keyboard is on the task called `name`. */
  const downTo = async (name: string) => {
    for (let i = 0; i < 20 && (await focused()) !== name; i++) await page.keyboard.press("j");
    assert.equal(await focused(), name);
  };
  when("I go to Tasks, move down to a task with j and press o", async () => {
    await goTo(page, "Tasks");
    await page.locator("#tasks-view").getByRole("checkbox", { name: "Return library books" }).waitFor();
    await downTo("Return library books");
    await page.keyboard.press("o");
  });
  then("the note the task is in opens", async () => {
    await page.waitForURL(/\/notes\/errands-/);
  });
  when("I go back to Tasks, move to another and press Space", async () => {
    await goTo(page, "Tasks");
    await page.locator("#tasks-view").getByRole("checkbox", { name: "Plan the party" }).waitFor();
    await downTo("Plan the party");
    await page.keyboard.press("Space");
  });
  then("it's ticked in its note, as before", async () => {
    await eventually(() => assert.match(app.read("Errands.md"), /^- \[x\] Plan the party /m));
  });
  when("I go to History, move with j and k, and press Enter on the latest change", async () => {
    await goTo(page, "History");
    await page.locator("#history-view .hist-row", { hasText: "Errands" }).first().waitFor();
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.locator("#history-view .hist-row.is-focused", { hasText: "Errands" }).waitFor();
    await page.keyboard.press("Enter");
  });
  then("the note that changed opens", async () => {
    await page.waitForURL(/\/notes\/errands-/);
  });
});
