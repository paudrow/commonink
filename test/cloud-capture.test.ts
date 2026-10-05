// The browser extension's capture, online (#380): what it saves, and that the Worker takes a write
// from an extension's origin for that one route and from nowhere else.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

const EXTENSION = { origin: `chrome-extension://${"abcdefghijklmnop".repeat(2)}`, "x-common-ink-capture": "1" };
const page = { today: "2026-10-03", title: "How ink dries", url: "https://example.com/ink", html: `<h1>How ink dries</h1><p>By <a href="https://example.com/evaporation">evaporation</a>.</p><h2>Paper</h2><ul><li>Absorbs</li></ul>` };

test("the extension saves a selection and a page to today's journal note, or a page as a new note in a folder", async () => {
  const { editor, base } = await team(cloud);
  const capture = async (body: unknown) => {
    const res = await cloud.request(editor, "POST", `${base}/capture`, body, EXTENSION);
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()) as { path: string; title: string; href: string; line?: number };
  };
  const read = async (p: string) => (await cloud.call(editor, "GET", `${base}/note?path=${encodeURIComponent(p)}`)) as { id: string; content: string };

  const quoted = await capture({ today: page.today, title: page.title, url: page.url, text: "Ink dries by evaporation." });
  assert.equal(quoted.path, "Journal/2026-10-03.md");
  await capture(page);
  const journal = await read(quoted.path);
  assert.match(quoted.href, new RegExp(`^/notes/.*${journal.id}$`), "the link opens the note in the app");
  const captured = journal.content.slice(journal.content.indexOf("## Captured"));
  assert.equal(
    captured,
    "## Captured\n\n> Ink dries by evaporation.\n\n— [How ink dries](https://example.com/ink)\n\n[How ink dries](https://example.com/ink)\n\n**How ink dries**\n\nBy [evaporation](https://example.com/evaporation).\n\n**Paper**\n\n- Absorbs\n",
  );
  assert.equal(journal.content.split("\n")[quoted.line! - 1], "> Ink dries by evaporation.");

  const note = await capture({ ...page, folder: "Clippings" });
  assert.equal(note.path, "Clippings/How ink dries.md");
  assert.equal((await read(note.path)).content, "# How ink dries\n\n[How ink dries](https://example.com/ink)\n\n# How ink dries\n\nBy [evaporation](https://example.com/evaporation).\n\n## Paper\n\n- Absorbs\n");
  assert.equal((await capture({ ...page, folder: "Clippings" })).path, "Clippings/How ink dries 2.md", "the same page again is a second note, never an overwrite");

  const bad = async (body: unknown) => (await cloud.request(editor, "POST", `${base}/capture`, body, EXTENSION)).status;
  assert.equal(await bad({ today: page.today, title: "Nothing" }), 400);
  assert.equal(await bad({ ...page, today: "today" }), 400);
  assert.equal(await bad({ ...page, folder: "../elsewhere" }), 400);
  assert.equal(await bad({ ...page, html: "x".repeat(2_000_001) }), 400);
});

test("a write from another origin is taken only from an extension, only for capture, and only signed in", async () => {
  const { editor, viewer, stranger, base } = await team(cloud);
  const body = { today: "2026-10-03", title: "A page", url: "https://example.com/", text: "A quote" };
  const status = async (cookie: string | null, route: string, headers: Record<string, string>, send: unknown = body) => (await cloud.request(cookie, "POST", `${base}${route}`, send, headers)).status;

  assert.equal(await status(editor, "/capture", EXTENSION), 200);
  assert.equal(await status(editor, "/capture", {}), 200, "our own pages may use it too");
  assert.equal(await status(editor, "/capture", { origin: "https://evil.example", "x-common-ink-capture": "1" }), 403, "never a website");
  assert.equal(await status(editor, "/capture", { origin: EXTENSION.origin }), 403, "the header is required");
  assert.equal(await status(editor, "/capture", { ...EXTENSION, origin: "chrome-extension://evil.example" }), 403, "an extension's origin is its ID");
  assert.equal(await status(editor, "/capture", { ...EXTENSION, "content-type": "text/plain" }), 415, "JSON only, as everywhere");
  assert.equal(await status(editor, "/note", EXTENSION, { path: "From an extension.md", content: "# No\n" }), 403, "no other route");
  assert.equal(await status(editor, "/today/journal", EXTENSION, { today: "2026-10-04" }), 403);
  assert.equal(await status(viewer, "/capture", EXTENSION), 403, "a viewer can't write");
  assert.equal(await status(stranger, "/capture", EXTENSION), 404);
  assert.equal(await status(null, "/capture", EXTENSION), 401);
});
