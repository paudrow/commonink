// Save to Google Drive (#47): the Drive client against a fake Google, what's saved for each format,
// the markdown agents send, and the command that saves for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPath, DriveClient, driveProblem, fileTitle, MIME, saveToDrive } from "../cloud/src/drive.ts";
import { GoogleError } from "../cloud/src/google.ts";
import { webMarkdown } from "../src/core/export.ts";
import { COMMANDS, type CommandHost } from "../src/core/commands/index.ts";
import { openTempVault } from "./helpers.ts";

const ENDPOINTS = { api: "https://drive.test/drive/v3", upload: "https://drive.test/upload/drive/v3" };

/** A fake Drive: what it was asked, in order, and a folder that's there once it's been made. */
function fakeDrive() {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  let folder: string | null = null;
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = init.headers as Record<string, string>;
    const body = typeof init.body === "string" ? init.body : init.body ? `<${(init.body as Uint8Array).byteLength} bytes>` : undefined;
    calls.push({ method: init.method ?? "GET", url: url.pathname + url.search, headers, body });
    const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });
    if (headers.Authorization !== "Bearer tok") return json({ error: { message: "Invalid Credentials" } }, 401);
    if (url.pathname === "/drive/v3/files" && init.method === undefined) return json({ files: folder ? [{ id: folder }] : [] });
    if (url.pathname === "/drive/v3/files" && init.method === "POST") return json({ id: (folder = "f1") });
    if (url.pathname === "/upload/drive/v3/files") return new Response(null, { status: 200, headers: { Location: `https://drive.test/session/${calls.length}` } });
    if (url.pathname.startsWith("/session/")) {
      const meta = JSON.parse(calls.at(-2)!.body!) as { name: string };
      return json({ id: `file${calls.length}`, name: meta.name, webViewLink: `https://docs.test/${calls.length}` });
    }
    if (url.pathname.endsWith("/export")) return new Response("%PDF-1.4", { status: 200 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return json({ error: { message: "Not found" } }, 404);
  }) as typeof fetch;
  return { calls, fetcher, client: new DriveClient(async () => "tok", ENDPOINTS, fetcher) };
}

const note = { title: "Q3 plan", type: "docx" as const, data: new Uint8Array([80, 75, 3, 4]) };

test("a Google Doc: the Common Ink folder is found or made once, and the note is uploaded for Drive to convert", async () => {
  const { calls, client } = fakeDrive();
  const doc = await saveToDrive(client, note, "doc");
  assert.deepEqual(doc, { id: "file4", name: "Q3 plan", url: "https://docs.test/4" });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.split("?")[0]}`),
    ["GET /drive/v3/files", "POST /drive/v3/files", "POST /upload/drive/v3/files", "PUT /session/3"],
  );
  assert.match(new URLSearchParams(calls[0].url.split("?")[1]).get("q")!, /^name = 'Common Ink' and mimeType = 'application\/vnd.google-apps.folder' and trashed = false/);
  assert.deepEqual(JSON.parse(calls[2].body!), { name: "Q3 plan", mimeType: MIME.doc, parents: ["f1"] });
  assert.equal(calls[2].headers["X-Upload-Content-Type"], MIME.docx);
  assert.deepEqual([calls[3].headers["Content-Type"], calls[3].body], [MIME.docx, "<4 bytes>"]);
  // The second time the folder is found.
  await saveToDrive(client, note, "doc");
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.startsWith("/drive/v3/files")).length, 1);
});

test("a PDF is the Doc exported by Drive, and the Doc on the way is deleted; markdown goes as it is", async () => {
  const { calls, client } = fakeDrive();
  const pdf = await saveToDrive(client, note, "pdf");
  assert.equal(pdf.name, "Q3 plan.pdf");
  const steps = calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
  assert.deepEqual(steps.slice(2), ["POST /upload/drive/v3/files", "PUT /session/3", "GET /drive/v3/files/file4/export", "POST /upload/drive/v3/files", "PUT /session/6", "DELETE /drive/v3/files/file4"]);
  assert.deepEqual(JSON.parse(calls[5].body!), { name: "Q3 plan.pdf", mimeType: MIME.pdf, parents: ["f1"] });

  const md = await saveToDrive(client, { title: "Q3 plan", type: "md", data: new TextEncoder().encode("# Q3") }, "md");
  assert.equal(md.name, "Q3 plan.md");
  assert.deepEqual(JSON.parse(calls.at(-2)!.body!), { name: "Q3 plan.md", mimeType: MIME.md, parents: ["f1"] });
  await assert.rejects(saveToDrive(client, note, "md"), /needs the note's markdown/);
});

test("what Drive's errors say, and file names from titles", async () => {
  const bad = new DriveClient(async () => "nope", ENDPOINTS, fakeDrive().fetcher);
  const e = await saveToDrive(bad, note, "doc").catch((x) => x);
  assert.deepEqual([e instanceof GoogleError, driveProblem(e)], [true, "Google Drive needs connecting again"]);
  assert.equal(driveProblem(new GoogleError("Request had insufficient authentication scopes.", 403)), "Allow Common Ink to save to your Google Drive first");
  assert.equal(driveProblem(new GoogleError("Google Drive API has not been used in project 1 before or it is disabled.", 403)), "Google Drive: Google Drive API has not been used in project 1 before or it is disabled.");
  assert.equal(driveProblem(new Error("feed:Google Drive isn't connected any more.")), "Google Drive isn't connected any more.");
  assert.deepEqual([fileTitle("a/b\\c\n d"), fileTitle("  "), fileTitle("x".repeat(300)).length], ["a b c d", "Untitled", 200]);
});

test("connecting for Drive comes back only to a path in this app", () => {
  assert.deepEqual(["/notes/x-abcd2345?w=1", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "notes", null].map(appPath), ["/notes/x-abcd2345?w=1", "/", "/", "/", "/", "/", "/", "/"]);
});

test("the markdown agents send: links to notes (itself too) become web addresses; pictures and code stay", () => {
  const { vault } = openTempVault({
    "Plan.md": "# Plan\n\nSee [[Roadmap]], [[Roadmap|the map]], [this](Plan.md) and ![[pic.png]].\n\n`[[Roadmap]]`\n",
    "Roadmap.md": "# Roadmap\n",
  });
  const id = (p: string) => vault.meta(p)!.id;
  const out = webMarkdown({ vault, origin: "https://ci.test" }, "Plan.md");
  assert.equal(
    out,
    `# Plan\n\nSee [Roadmap](https://ci.test/notes/roadmap-${id("Roadmap.md")}), [the map](https://ci.test/notes/roadmap-${id("Roadmap.md")}), ` +
      `[this](https://ci.test/notes/plan-${id("Plan.md")}) and ![[pic.png]].\n\n\`[[Roadmap]]\`\n`,
  );
});

test("save-to-drive: saves through the host's Drive, says where; refuses without one, and for a note that isn't markdown", async () => {
  const { vault } = openTempVault({ "Plan.md": "# Plan\n", "Page.html": "<p>hi</p>" });
  const command = COMMANDS.find((c) => c.cli === "save-to-drive")!;
  const asked: Array<[string, string]> = [];
  const drive = { name: "Google Drive", save: async (rel: string, format: string) => (asked.push([rel, format]), { name: "Plan", url: "https://docs.test/1" }) };
  const host = { vault, user: "you", source: "t", canEditShared: true, drive } as CommandHost;
  const run = (h: CommandHost, input: Record<string, unknown>) => (command.run as (h: CommandHost, i: unknown) => Promise<{ text: string; data: unknown }>)(h, input);
  assert.equal((await run(host, { note: "Plan" })).text, "Saved Plan.md to Google Drive as Plan: https://docs.test/1");
  await run(host, { note: "Plan", format: "pdf" });
  assert.deepEqual(asked, [["Plan.md", "doc"], ["Plan.md", "pdf"]]);
  await assert.rejects(run({ ...host, drive: undefined }, { note: "Plan" }), /works in a hosted workspace/);
  await assert.rejects(run(host, { note: "Page.html" }), /is an HTML note/);
  await assert.rejects(run(host, { note: "Nope" }), /No note matches "Nope"/);
});

test("on the CLI, export <note> --to drive is save-to-drive", async () => {
  const { parse } = await import("../src/cli/argv.ts");
  const io = { stdin: () => null, readFile: (name: string) => ({ name, bytes: new Uint8Array() }) };
  const p = parse(["export", "Plan", "--to", "drive", "--format", "pdf"], io) as { command: { cli: string }; input: Record<string, unknown> };
  assert.deepEqual([p.command.cli, p.input.note, p.input.format, p.input.to], ["save-to-drive", "Plan", "pdf", "drive"]);
  assert.equal((parse(["export", "Plan", "--format", "html"], io) as { command: { cli: string } }).command.cli, "export");
});
