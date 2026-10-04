// The demo video's feature tour (scripts/demo-video.ts), scene by scene: what the cursor does and
// the caption over it. Each scene starts from wherever the app is and goes to its own page, so
// `--only` can record a few. The Google scenes run against the stand-in Google that Previews and
// local development have (cloud/src/google-mock.ts), and their captions say so: the real consent
// screen is recorded by a person (see docs/demo-video.md).
import type { Tour } from "./demo-video.ts";

/** Open the search palette, type, and take the first result. */
async function open(t: Tour, words: string) {
  await t.click(".search-pill");
  await t.type(words);
  await t.wait(700);
  await t.press("Enter");
  await t.page.locator("#editor-host .cm-content").waitFor();
  await t.wait(600);
}

/** The stand-in's consent page: say what was asked for, then allow it. */
async function consent(t: Tour, caption: string) {
  await t.page.waitForURL(/\/auth\/google\/calendar\/mock/);
  await t.say(caption, 2900);
  await t.click(t.page.getByRole("button", { name: "Allow" }));
  await t.page.waitForURL((u: URL) => !u.pathname.startsWith("/auth/"));
  await t.say("", 0); // back in the app, the caption about Google's page is over
  await t.wait(900);
}

export const SCENES: Array<{ name: string; run: (t: Tour) => Promise<void> }> = [
  {
    name: "sign-in",
    async run(t) {
      await t.card("Common Ink", "A shared notebook for you, your team, and your agents", 3200);
      await t.say("Common Ink: notes in markdown that you and your AI agents both work in", 3200);
      const start = t.page.getByRole("link", { name: /get started/i }).first();
      // Previews and local development sign you in as a developer here; production goes to Google.
      await start.evaluate((a: HTMLAnchorElement, href: string) => (a.href = href), t.signInUrl("/notes"));
      await t.say("Get started signs you in with Google (this recording uses a developer sign-in)", 2300);
      await t.click(start);
      await t.page.locator(".feed-card").first().waitFor();
      await t.wait(800);
    },
  },
  {
    name: "notes",
    async run(t) {
      await t.goto("/notes");
      await t.page.locator(".feed-card").first().waitFor();
      await t.say("Notes is home: every note as a card, newest first", 2700);
      await t.click("input[placeholder^='Filter notes']");
      await t.type("launch");
      await t.say("Type to search the full text of every note", 2500);
      await t.page.keyboard.press("ControlOrMeta+A");
      await t.press("Backspace");
    },
  },
  {
    name: "editor",
    async run(t) {
      await t.say("Ctrl+K jumps to any note", 1100);
      await open(t, "Website rel");
      await t.say("A note is markdown, shown as you write: properties, tags, links and tasks", 3200);
      await t.click(t.page.locator(".cm-line", { hasText: "Review the pricing page" }).locator("input[type=checkbox], .cm-checkbox").first());
      await t.say("Tasks live in the notes they belong to, with due dates", 2500);
      const last = t.page.locator(".cm-line", { hasText: "Record the demo video" });
      await t.click(last);
      await t.press("End");
      await t.press("Enter");
      await t.type("Tell the beta list tomorrow");
      await t.press("Enter");
      await t.press("Enter"); // an empty task ends the list
      await t.say("Write a date in plain words and it becomes the task's due date", 2700);
      await t.moveTo(t.page.locator(".cm-line", { hasText: "Tell the beta list" }));
      await t.page.mouse.wheel(0, 520);
      await t.say("Diagrams, tables, math and embeds draw in place", 3100);
      await t.moveTo(t.page.getByText("Backlinks").first());
      await t.say("The side panel has the outline, every note that links here, and who changed what", 3200);
    },
  },
  {
    name: "tasks",
    async run(t) {
      await t.click("#tasks-btn");
      await t.say("Tasks gathers every task from every note", 2900);
      await t.click("#today-btn");
      await t.say("Today: what's due, what's on your calendar, and a place to write", 3100);
    },
  },
  {
    name: "calendar",
    async run(t) {
      await t.goto("/calendar");
      await t.page.locator(".cal-new").waitFor();
      await t.say("Calendar: tasks by due date, the workspace's events, and your own calendars", 2900);
      await t.click(".cal-sources-btn");
      await t.say("Connect Google Calendar to see your events beside your notes", 2300);
      await t.click(".cal-g-connect");
      await consent(t, "Google asks to read your calendars (calendar.readonly). A stand-in plays Google in this part");
      await t.click("button[aria-label='Show Dev (demo Google) here']");
      await t.page.locator("button[aria-label^='Link meeting notes to Dev']").waitFor();
      await t.click("button[aria-label='Show Family (demo Google) here']");
      await t.say("Pick which Google calendars show here. Only you see them", 2500);
      await t.click("button[aria-label^='Link meeting notes to Dev']");
      await t.say("Linking meeting notes writes to events, so Google asks again (calendar.events)", 2700);
      await t.click(t.page.getByRole("button", { name: "Continue to Google" }));
      await consent(t, "calendar.events: Common Ink adds a link to your meeting note to the event, nothing else");
      await t.click(t.page.getByRole("dialog").getByRole("button", { name: "Close" })); // Calendars comes back open
      await t.page.getByRole("dialog").waitFor({ state: "hidden" });
      await t.click("button[aria-label^='Next']");
      await t.say("calendar.readonly: your Google Calendar events, read every 10 minutes", 2900);
      await t.click(t.page.locator(".cal-ev", { hasText: "Product sync" }).first());
      await t.say("An event shows its time, guests and description", 2300);
      await t.click(t.page.getByRole("button", { name: "Create meeting note" }));
      await t.page.locator("#editor-host .cm-content").waitFor();
      await t.say("calendar.events: the meeting note is made, and its link is added to the Google event", 3400);
      await t.goto("/calendar");
      await t.click(".cal-new");
      await t.type("Launch review");
      await t.page.locator("[role=dialog] select").first().selectOption({ label: "Dev (demo Google)" });
      await t.moveTo(t.page.locator("[role=dialog] select").first());
      await t.click(t.page.getByLabel("Also make a meeting note"));
      await t.say("calendar.events: a new event goes to your Google calendar, with its note", 2900);
      await t.click(t.page.getByRole("button", { name: "Add event" }));
      await t.wait(1800);
    },
  },
  {
    name: "contacts",
    async run(t) {
      await t.goto("/contacts");
      await t.page.locator(".ct-google").waitFor();
      await t.say("Contacts are notes too, in People/", 2200);
      await t.click(".ct-google button");
      await consent(t, "Google asks to see your contacts (contacts.readonly)");
      await t.click(t.page.locator(".ct-google button", { hasText: "Sync now" }));
      await t.page.locator(".ct-row", { hasText: "Priya Shah" }).waitFor();
      await t.say("contacts.readonly: each Google contact becomes a note you can link, tag and write in", 3200);
      await t.click(t.page.locator(".ct-row", { hasText: "Priya Shah" }));
      await t.say("A person's page: how to reach them, their tasks, and the notes that mention them", 3100);
      await t.click(".ct-back");
      await t.click(t.page.locator(".ct-google button", { hasText: "Manage" }));
      await t.say("Edits stay here until you allow editing", 2000);
      await t.click(t.page.getByRole("button", { name: "Allow editing" }));
      await consent(t, "Google asks to edit your contacts (contacts)");
      await t.press("Escape");
      await t.goto("/contacts");
      await t.click(t.page.locator(".ct-row", { hasText: "Priya Shah" }));
      await t.click(t.page.getByRole("button", { name: "Edit note" }));
      await t.page.locator("#editor-host .cm-content").waitFor();
      // The role's box in the properties table: the first input after the key's name.
      await t.click(t.page.locator(".prop-key-name", { hasText: /^role$/ }).locator("xpath=following::input[contains(@class,'prop-input')][1]"));
      await t.page.keyboard.press("ControlOrMeta+A");
      await t.type("Head of Engineering");
      await t.press("Enter");
      await t.say("Change her role in the note", 2200);
      await t.goto("/contacts");
      await t.click(t.page.locator(".ct-google button", { hasText: "Sync now" }));
      await t.wait(1500);
      await t.goto("/auth/google/contacts/mock");
      const role = t.page.locator("input[name=role][value='Head of Engineering']");
      if (!(await role.count())) throw new Error("The contact's new role didn't reach the stand-in Google");
      await role.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center" }));
      await t.moveTo(role);
      await t.say("contacts: the edit is written back to Google (this page is the stand-in's address book)", 3600);
    },
  },
  {
    name: "drive",
    async run(t) {
      await t.goto("/notes");
      await open(t, "Launch announ");
      await t.say("Any note can be saved to your Google Drive", 2000);
      await t.click("button[aria-label^='Share, print']");
      await t.click(t.page.getByText("Save to Google Drive"));
      await t.say("As a Google Doc, a PDF, or its markdown file", 2500);
      await t.click(t.page.getByRole("button", { name: "Continue to Google" }));
      await consent(t, "Google asks for drive.file: only the files Common Ink makes, nothing else in your Drive");
      await t.click(t.page.getByRole("button", { name: "Save", exact: true }));
      await t.page.locator(".toast-text", { hasText: "Saved to Google Drive" }).waitFor();
      await t.say("drive.file: saved as a Google Doc in a Common Ink folder", 3100);
    },
  },
  {
    name: "history",
    async run(t) {
      await t.goto("/notes");
      await t.click(t.page.locator(".nav-item", { hasText: "History" }));
      await t.say("History: every change, who made it, and a way back to before it", 3100);
      await open(t, "Getting started");
      await t.say("Agents work in the same notes as you. Here the built-in guide plays one", 2300);
      await t.click(t.page.getByRole("button", { name: "Show me" }));
      await t.say("Its edit shows up live, with its name on it, and you can take it back", 3800);
      await t.page.keyboard.press("ControlOrMeta+Shift+P");
      await t.wait(500);
      await t.type("Connect an agent");
      await t.wait(700);
      await t.press("Enter");
      await t.say("Claude, ChatGPT, Cursor or any MCP client connects with a sign-in, no API keys", 3600);
      await t.press("Escape");
      await t.card("Next: Google sign-in and consent", "Recorded with a real Google account", 3200);
    },
  },
];
