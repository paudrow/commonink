// `commonink export` and MCP export_note, run as agents run them: the CLI and the stdio server.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");
const VAULT = {
  "Welcome.md": "# Welcome\n\nStart with [[Roadmap]]. Math: $x^2$.\n\n![[chart.svg]]\n\n- [ ] Try exporting\n\n```mermaid\nflowchart LR\n  A --> B\n```\n",
  "Projects/Roadmap.md": "# Roadmap\n\nBack to [[Welcome]].\n\n![[chart.svg]]\n",
  "Dashboards/Stats.html": "<title>Stats</title><h1>Reading stats</h1>",
  "assets/chart.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
};
const out = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-export-out-"));
after(() => fs.rmSync(out, { recursive: true, force: true }));

function commonink(vault: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault, COMMONINK_URL: "https://ink.test" };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(BIN, args, { env, encoding: "buffer" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString() };
}

test("commonink export writes a note as markdown, a web page or Word, and notes as a .zip", () => {
  const vault = tempVault(VAULT);
  const md = commonink(vault, ["export", "Welcome", "--format", "md", "--out", "-"]);
  assert.equal(md.stdout.toString(), VAULT["Welcome.md"], "markdown is the file as it is");

  const html = path.join(out, "Welcome.html");
  assert.match(commonink(vault, ["export", "Welcome", "--format", "html", "--out", html]).stdout.toString(), /^Exported Welcome\.html \(\d+ bytes\) → .*Welcome\.html\n$/);
  const page = fs.readFileSync(html, "utf8");
  assert.ok(page.startsWith("<!doctype html>") && page.includes("<title>Welcome</title>"));
  assert.ok(page.includes('src="data:image/svg+xml;base64,'), "the picture is inside the page");
  assert.ok(page.includes("<math"), "math is MathML");
  assert.ok(page.includes('href="https://ink.test/notes/roadmap-'), "a link to a note goes to its web address");
  assert.ok(page.includes('data-lang="mermaid"'), "without a browser, a diagram is its code");
  assert.ok(!/<script/i.test(page));

  const docx = path.join(out, "Welcome.docx");
  assert.equal(commonink(vault, ["export", "Welcome", "--format", "docx", "--out", docx]).status, 0);
  const doc = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(docx)))["word/document.xml"]);
  assert.ok(doc.includes(">Welcome<") && doc.includes("☐ ") && doc.includes("x^2"), "a Word document with the note in it");

  const zip = path.join(out, "Projects.zip");
  assert.equal(commonink(vault, ["export", "Projects", "--format", "zip", "--out", zip]).status, 0);
  const files = unzipSync(new Uint8Array(fs.readFileSync(zip)));
  assert.deepEqual(Object.keys(files).sort(), ["Projects/Roadmap.md", "assets/chart.svg"]);
  assert.match(strFromU8(files["Projects/Roadmap.md"]), /Back to \[Welcome\]\(https:\/\/ink\.test\/notes\/welcome-[a-z2-9]{8}\)\./);

  const bad = commonink(vault, ["export", "Projects", "--format", "md"]);
  assert.equal(bad.status, 3, "not found");
  assert.match(bad.stderr, /No note matches "Projects"\. A folder, or "\/" for everything, exports as a zip/);
  assert.match(commonink(vault, ["export", "Welcome", "--format", "pdf"]).stderr, /--format must be md, html, docx or zip, not "pdf"/);
});

let client: Client;
before(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "COMMONINK_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, COMMONINK_VAULT: tempVault(VAULT), COMMONINK_URL: "https://ink.test" } }));
});
after(() => client?.close());

type Part = { type: string; text?: string; resource?: { uri: string; mimeType: string; text?: string; blob?: string } };
const exportNote = async (args: Record<string, unknown>) => (await client.callTool({ name: "export_note", arguments: args })) as { content: Part[]; isError?: boolean };

test("MCP export_note returns the file: markdown and HTML as text, Word and zip as base64", async () => {
  const md = await exportNote({ target: "Welcome", format: "md" });
  assert.equal(md.content[0].text, `Welcome.md (text/markdown, ${Buffer.byteLength(VAULT["Welcome.md"])} bytes)`);
  assert.deepEqual(md.content[1].resource, { uri: "commonink-export:///Welcome.md", mimeType: "text/markdown", text: VAULT["Welcome.md"] });
  const zip = await exportNote({ target: "/", format: "zip" });
  assert.equal(zip.content[1].resource?.mimeType, "application/zip");
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(Buffer.from(zip.content[1].resource!.blob!, "base64")))).sort(), ["Dashboards/Stats.html", "Projects/Roadmap.md", "Welcome.md", "assets/chart.svg"]);
  const docx = await exportNote({ target: "Roadmap", format: "docx" });
  assert.ok(unzipSync(new Uint8Array(Buffer.from(docx.content[1].resource!.blob!, "base64")))["word/document.xml"]);
  const html = await exportNote({ target: "Dashboards/Stats.html", format: "html" });
  assert.equal(html.content[1].resource?.text, VAULT["Dashboards/Stats.html"], "an HTML note exports as itself");
  const missing = await exportNote({ target: "Nope", format: "docx" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text!, /No note matches "Nope"/);
});
