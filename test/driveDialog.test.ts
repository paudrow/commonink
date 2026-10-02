// Save to Google Drive's dialog (web/src/export/drive.ts) in jsdom, against a stubbed server: a server
// without Google, the first time (off to Google with the format picked), saving the markdown file with
// its links made web addresses, Open in Drive, and coming back from Google.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { openSaveToDrive, leaveFor, driveOutcome } = await import("../web/src/export/drive.ts");

type Status = { mode: "real" | "mock" | "off"; connection: { account: string; calendar: boolean; canWrite: boolean; drive: boolean; connectedAt: number } | null };
const server = { google: { mode: "off", connection: null } as Status };
const sent: Array<{ path: string; search: string; type: string | null; body: string }> = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  if (url.pathname === "/api/google") return json(server.google);
  if (url.pathname === "/api/notes") return json([{ path: "Roadmap.md", title: "Roadmap", id: "abcd2345" }, { path: "Plan.md", title: "Plan", id: "efgh6789" }]);
  if (url.pathname === "/api/resolve") return json({ path: url.searchParams.get("target") === "Roadmap" ? "Roadmap.md" : null });
  if (url.pathname === "/api/google/drive") {
    sent.push({ path: url.pathname, search: url.search, type: new Headers(init?.headers).get("Content-Type"), body: await (init!.body as Blob).text() });
    return json({ id: "1", name: "Plan.md", url: "https://drive.example/1" });
  }
  return json({ error: `no stub for ${url.pathname}` }, 404);
}) as typeof fetch;

const left: string[] = [];
leaveFor.to = (url) => void left.push(url);
const opened: string[] = [];
window.open = ((url: string) => (opened.push(url), null)) as typeof window.open;
const settle = () => new Promise((r) => setTimeout(r, 30));
const toasts = () => [...document.querySelectorAll(".toast-text")].map((t) => t.textContent);
const dialog = () => document.querySelector<HTMLElement>(".ask")!;
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
const note = { path: "Plan.md", title: "Plan", content: "# Plan\n\nSee [[Roadmap]] and [[Nowhere]].\n" };

test("a server without Google says so, and nothing opens", async () => {
  await openSaveToDrive(note);
  await settle();
  assert.equal(dialog(), null);
  assert.ok(toasts().includes("Google isn't configured on this server"));
});

test("the first time, the dialog says Google will ask, and Continue goes there with the format picked", async () => {
  server.google = { mode: "real", connection: null };
  const done = openSaveToDrive(note);
  await settle();
  const formats = [...dialog().querySelectorAll<HTMLInputElement>("input[type=radio]")];
  assert.deepEqual(formats.map((r) => [r.value, r.checked]), [["doc", true], ["pdf", false], ["md", false]], "a Google Doc by default");
  assert.match(dialog().textContent!, /Google will ask you to let Common Ink add files to your Drive/);
  formats[1].click();
  button("Continue to Google", dialog()).click();
  await done;
  assert.equal(left.length, 1);
  const to = new URL(left[0], "http://localhost");
  assert.deepEqual([to.pathname, to.searchParams.get("as")], ["/auth/google/drive", "pdf"]);
  assert.deepEqual(sent, []);
});

test("connected: the markdown file goes with links to notes as web addresses, and Open in Drive opens it", async () => {
  server.google = { mode: "real", connection: { account: "me@example.com", calendar: false, canWrite: false, drive: true, connectedAt: 1 } };
  const done = openSaveToDrive(note, "md");
  await settle();
  assert.match(dialog().textContent!, /folder named Common Ink in your Google Drive \(me@example.com\)/);
  assert.equal(dialog().querySelector<HTMLInputElement>("input:checked")!.value, "md", "the format picked before going to Google");
  button("Save", dialog()).click();
  await done;
  assert.equal(sent.length, 1);
  assert.deepEqual([new URLSearchParams(sent[0].search).get("as"), new URLSearchParams(sent[0].search).get("title"), sent[0].type], ["md", "Plan", "text/markdown;charset=utf-8"]);
  assert.equal(sent[0].body, "# Plan\n\nSee [Roadmap](http://localhost/notes/roadmap-abcd2345) and [[Nowhere]].\n");
  assert.ok(toasts().includes("Saved to Google Drive: Plan.md"));
  button("Open in Drive", document.querySelector("#toasts")!).click();
  assert.deepEqual(opened, ["https://drive.example/1"]);
});

test("coming back from Google: the dialog again at the format picked, or why not", () => {
  assert.deepEqual(driveOutcome("connected", "pdf"), { again: "pdf" });
  assert.deepEqual(driveOutcome("connected", "exe"), { again: "doc" });
  assert.deepEqual(driveOutcome("denied", null), { text: "Nothing was saved to Google Drive: access wasn't allowed" });
  assert.equal(driveOutcome("whatever", null), null);
});
