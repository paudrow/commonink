// The Chrome extension (extensions/chrome, #380): what it sends, how it reads a page, and its manifest.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { account, captureBody, DEFAULT_SERVER, foldersOf, hostPattern, localDate, MAX_HTML, pageContent, save, serverOrigin, SignedOut } from "../extensions/chrome/lib.js";

const dir = path.resolve(import.meta.dirname, "../extensions/chrome");

test("the server setting is an https origin (http only on this computer), commonink.app when empty", () => {
  assert.equal(serverOrigin(""), DEFAULT_SERVER);
  assert.equal(serverOrigin(" https://pr-380-commonink.draftox.workers.dev/notes/x?y "), "https://pr-380-commonink.draftox.workers.dev");
  assert.equal(serverOrigin("commonink.app"), "https://commonink.app");
  assert.equal(serverOrigin("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(serverOrigin("http://example.com"), null, "a session cookie never goes over plain http");
  assert.equal(serverOrigin("javascript://x"), null);
  assert.equal(serverOrigin("not a url"), null);
  assert.equal(hostPattern("http://localhost:8787"), "http://localhost/*", "a match pattern has no port");
  assert.equal(hostPattern("https://commonink.app"), "https://commonink.app/*");
});

test("a capture's body: the person's day, a selection as text or a page as HTML, and a folder only when one's picked", () => {
  const now = new Date(2026, 9, 3, 23, 30);
  assert.equal(localDate(now), "2026-10-03");
  assert.deepEqual(captureBody({ title: " A page ", url: "https://example.com/a", html: "<p>Hi</p>" }, now), { today: "2026-10-03", title: "A page", url: "https://example.com/a", html: "<p>Hi</p>" });
  assert.deepEqual(captureBody({ title: "A page", url: "https://example.com/a", text: " Just this \n", folder: "/Clippings/" }, now), { today: "2026-10-03", title: "A page", url: "https://example.com/a", text: "Just this", folder: "Clippings" });
  assert.equal(captureBody({ html: "x".repeat(MAX_HTML + 5) }, now).html!.length, MAX_HTML);
  assert.throws(() => captureBody({ title: "Empty", html: "  " }, now), /nothing to save/);
});

test("the folder list is every folder notes are in, with the folders above them", () => {
  assert.deepEqual(foldersOf([{ path: "Inbox.md" }, { path: "Projects/Q3/Plan.md" }, { path: "Journal/2026-10-03.md" }, { path: "Projects/Idea.md" }]), ["Journal", "Projects", "Projects/Q3"]);
});

test("a page is read as its article, without navigation, forms, scripts or images, and with full links", () => {
  document.title = "How ink dries";
  document.body.innerHTML = `
    <header><nav><a href="/">Home</a></nav></header>
    <main><article>
      <h1>How ink dries</h1>
      <p>${"Ink dries by evaporation and absorption. ".repeat(8)}<a href="/more#x">More</a> <a href="javascript:alert(1)">bad</a></p>
      <img src="/ink.png" alt="Ink"><script>alert(1)</script>
      <aside>Related posts</aside><form><input name="email"><button>Subscribe</button></form>
    </article></main>
    <footer>© Example</footer>`;
  const page = pageContent();
  assert.equal(page.title, "How ink dries");
  assert.equal(page.url, "http://localhost/");
  assert.match(page.html, /<h1>How ink dries<\/h1>/);
  assert.match(page.html, /<a href="http:\/\/localhost\/more#x">More<\/a>/);
  assert.match(page.html, /<a>bad<\/a>/);
  assert.doesNotMatch(page.html, /Home|Related|Subscribe|alert|<img|Example/);
  assert.match(document.body.innerHTML, /Subscribe/, "the page itself is left as it was");

  // A page that marks no article is read whole, less its header and footer.
  document.body.innerHTML = `<header>Site name</header><div><p>Short page.</p></div><footer>Foot</footer>`;
  assert.equal(pageContent().html.trim(), "<div><p>Short page.</p></div>");
});

test("it calls the server as the signed-in person (their cookie), and says when no one's signed in", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, body: unknown) => async (url: string, init: RequestInit = {}) => (calls.push({ url, init }), new Response(JSON.stringify(body), { status }));

  const me = await account("https://commonink.app", answer(200, { user: { email: "a@example.com" }, workspaces: [{ id: "w1", name: "Mine", role: "owner" }, { id: "w2", name: "Theirs", role: "viewer" }] }));
  assert.deepEqual(me.workspaces.map((w) => w.id), ["w1"], "a viewer can't save to a workspace");
  assert.equal(calls[0].url, "https://commonink.app/api/me");
  assert.equal(calls[0].init.credentials, "include");

  const body = captureBody({ title: "A page", url: "https://example.com/a", text: "Quote" }, new Date(2026, 9, 3));
  const saved = await save("https://commonink.app", "w1", body, answer(200, { path: "Journal/2026-10-03.md", title: "2026-10-03", href: "/notes/2026-10-03-abcd2345" }));
  assert.deepEqual(saved, { path: "Journal/2026-10-03.md", title: "2026-10-03", url: "https://commonink.app/notes/2026-10-03-abcd2345" });
  const sent = calls[1];
  assert.equal(sent.url, "https://commonink.app/api/w/w1/capture");
  assert.deepEqual([sent.init.method, sent.init.credentials, sent.init.headers], ["POST", "include", { "Content-Type": "application/json", "X-Common-Ink-Capture": "1" }]);
  assert.deepEqual(JSON.parse(sent.init.body as string), body);

  await assert.rejects(account("https://commonink.app", answer(401, { error: "Sign in first" })), SignedOut);
  await assert.rejects(save("https://commonink.app", "w1", body, answer(403, { error: "You can view this workspace but not edit it" })), /view this workspace/);
  await assert.rejects(account("https://commonink.app", async () => Promise.reject(new TypeError("Failed to fetch"))), /Couldn't reach commonink.app/);
});

test("the manifest is MV3, reaches only commonink.app until another server is allowed, and names files that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://commonink.app/*"]);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "contextMenus", "scripting", "storage"]);
  const files = [manifest.action.default_popup, manifest.background.service_worker, manifest.options_ui.page, ...Object.values(manifest.icons as Record<string, string>), "popup.js", "popup.css", "options.js", "lib.js"];
  for (const f of files) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is missing`);
  // No build step and nothing kept: the scripts are plain modules, and only settings are stored.
  for (const f of ["popup.js", "background.js", "options.js", "lib.js"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /storage\.local|localStorage|indexedDB/, `${f} keeps nothing on this computer`);
  }
});
