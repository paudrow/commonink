// Moving in from other apps: HTML to markdown, Notion's export, Evernote's .enex and Apple Notes, read through readImport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { htmlToMarkdown } from "../src/core/html2md.ts";
import { detectFrom, md5, parseEnex, safeName } from "../src/core/convert.ts";
import { readImport, writeImport, fmtImport } from "../src/core/import.ts";
import { openTempVault } from "./helpers.ts";

const zipOf = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const note = (set: ReturnType<typeof readImport>, p: string) => set.notes.find((n) => n.path === p)?.content;

test("HTML reads as the markdown that looks like it", () => {
  assert.equal(htmlToMarkdown("<h2>Plan</h2><p>Ship <b>this</b> and <i>that</i>, <s>not</s> <a href='https://x.com/a b'>this link</a>.</p>"),
    "## Plan\n\nShip **this** and *that*, ~~not~~ [this link](https://x.com/a%20b).\n");
  assert.equal(htmlToMarkdown("<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><ol start='3'><li>Three</li></ol>"),
    "- One\n  - Nested\n- Two\n\n3. Three\n");
  assert.equal(htmlToMarkdown("<div><en-todo checked=\"true\"/>Done</div><div><en-todo/>Open</div>"), "- [x] Done\n\n- [ ] Open\n");
  assert.equal(htmlToMarkdown("<ul class='checklist'><li class='checked'>Milk</li><li>Eggs</li></ul>"), "- [x] Milk\n- [ ] Eggs\n");
  assert.equal(htmlToMarkdown("<blockquote><p>Quote</p></blockquote><pre><code>a &lt; b\n  c</code></pre><hr>"), "> Quote\n\n```\na < b\n  c\n```\n\n---\n");
  assert.equal(htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table>"), "| A | B |\n| --- | --- |\n| 1 | x\\|y |\n");
  assert.equal(htmlToMarkdown("<p>Line one<br>line two &amp; &#8212; &nbsp;done</p><script>alert(1)</script><style>p{}</style>"), "Line one\nline two & — done\n");
  assert.equal(htmlToMarkdown("<img src='data:image/png;base64,AAAA'><img alt='pic' src='a.png'>"), "![pic](a.png)\n", "a data: picture is left out");
  assert.equal(htmlToMarkdown("<div><span style='x'>Unclosed <b>bold"), "Unclosed **bold**\n", "unclosed tags close with the document");
  assert.equal(htmlToMarkdown(""), "");
});

test("htmlToMarkdown stays linear on hostile input", () => {
  const start = Date.now();
  htmlToMarkdown("<a ".repeat(20000) + "<".repeat(20000) + "&#".repeat(20000));
  assert.ok(Date.now() - start < 2000);
});

test("md5 matches Node's", () => {
  for (const s of ["", "a", "The quick brown fox", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)]) {
    assert.equal(md5(strToU8(s)), createHash("md5").update(s).digest("hex"), s.slice(0, 10));
  }
});

const ID = "0123456789abcdef0123456789abcdef";
const ID2 = "fedcba9876543210fedcba9876543210";

test("a Notion export loses its ids, in names, folders and links, and is told by its names", () => {
  const files = {
    [`Home ${ID}.md`]: `# Home\n\nSee [Plan](Home%20${ID}/Plan%20${ID2}.md) and [site](https://notion.so/x) and ![pic](Home%20${ID}/pic.png).\n`,
    [`Home ${ID}/Plan ${ID2}.md`]: `# Plan\n\nBack to [Home](../Home%20${ID}.md#top)\n`,
    [`Home ${ID}/pic.png`]: "png",
    [`Tasks ${ID2}.csv`]: "Name,Status\n",
  };
  assert.equal(detectFrom(Object.entries(files).map(([path, v]) => ({ path, bytes: strToU8(v) }))), "notion");
  const set = readImport([{ name: "Export.zip", bytes: zipSync({ "Export-Part-1.zip": zipOf(files) }) }]);
  assert.equal(set.from, "notion");
  assert.deepEqual(set.notes.map((n) => n.path).sort(), ["Home.md", "Home/Plan.md"]);
  assert.deepEqual(set.files.map((f) => f.path).sort(), ["Home/pic.png", "Tasks.csv"]);
  assert.equal(note(set, "Home.md"), "# Home\n\nSee [Plan](Home/Plan.md) and [site](https://notion.so/x) and ![pic](Home/pic.png).\n");
  assert.equal(note(set, "Home/Plan.md"), "# Plan\n\nBack to [Home](../Home.md#top)\n");

  // Two pages with one title are told apart, and a link reaches the right one.
  const twins = readImport([{ name: "n.zip", bytes: zipOf({ [`Untitled ${ID}.md`]: "a", [`Untitled ${ID2}.md`]: "b", [`Index ${ID}.md`]: `[b](Untitled%20${ID2}.md)` }) }]);
  assert.deepEqual(twins.notes.map((n) => n.path).sort(), ["Index.md", "Untitled 2.md", "Untitled.md"]);
  assert.equal(note(twins, "Index.md"), "[b](Untitled%202.md)");

  // An Obsidian vault isn't touched.
  const vault = readImport([{ name: "v.zip", bytes: zipOf({ "Plan.md": "[[Home]]", "Home.md": "x" }) }]);
  assert.equal(vault.from, "obsidian");
  assert.equal(note(vault, "Plan.md"), "[[Home]]");
});

const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const b64 = Buffer.from(pngBytes).toString("base64");
const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20260101T000000Z" application="Evernote">
  <note>
    <title>Trip: Lisbon / Porto</title>
    <created>20240115T093000Z</created>
    <updated>20240116T101500Z</updated>
    <tag>travel</tag><tag>to do</tag>
    <note-attributes><source-url>https://example.com/trip</source-url></note-attributes>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div><b>Pack</b> list</div><div><en-todo checked="true"/>Passport</div><div><en-media hash="${md5(pngBytes)}" type="image/png"/></div></en-note>]]></content>
    <resource><data encoding="base64">
${b64}
</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name><source-url>x</source-url></resource-attributes></resource>
  </note>
  <note><title>Trip: Lisbon / Porto</title><content><![CDATA[<en-note>Second &amp; same title</en-note>]]></content></note>
</en-export>`;

test("an .enex opens as notes with their dates, tags, source and pictures", () => {
  const [first] = parseEnex(ENEX);
  assert.equal(first.title, "Trip: Lisbon / Porto");
  assert.deepEqual(first.tags, ["travel", "to do"]);
  assert.equal(first.source, "https://example.com/trip", "the note's source, not its picture's");
  assert.deepEqual([...first.resources[0].data], [...pngBytes]);

  const set = readImport([{ name: "Travel.enex", bytes: strToU8(ENEX) }]);
  assert.equal(set.from, "evernote");
  assert.deepEqual(set.notes.map((n) => n.path), ["Travel/Trip- Lisbon - Porto.md", "Travel/Trip- Lisbon - Porto 2.md"]);
  assert.deepEqual(set.files.map((f) => f.path), ["Travel/attachments/map.png"]);
  assert.equal(
    note(set, "Travel/Trip- Lisbon - Porto.md"),
    '---\ntitle: "Trip: Lisbon / Porto"\ncreated: 2024-01-15T09:30:00Z\nupdated: 2024-01-16T10:15:00Z\ntags: [travel, to-do]\nsource: https://example.com/trip\n---\n\n' +
      "**Pack** list\n\n- [x] Passport\n\n![[attachments/map.png]]\n",
  );
  assert.match(note(set, "Travel/Trip- Lisbon - Porto 2.md")!, /Second & same title/);
  assert.equal(safeName("..hidden/x"), "hidden-x");
});

test("Apple Notes' HTML and text become markdown notes, only when asked", () => {
  const files = [{ name: "Notes.zip", bytes: zipOf({ "Work/Standup.html": "<div><h1>Standup</h1></div><div>Notes <b>here</b></div>", "Recipes/Bread.txt": "Flour\nWater\n" }) }];
  const set = readImport(files, "Apple Notes", "apple-notes");
  assert.deepEqual(set.notes.map((n) => n.path).sort(), ["Apple Notes/Recipes/Bread.md", "Apple Notes/Work/Standup.md"]);
  assert.equal(note(set, "Apple Notes/Work/Standup.md"), "# Standup\n\nNotes **here**\n");
  assert.equal(note(set, "Apple Notes/Recipes/Bread.md"), "Flour\nWater\n");
  // Without it, HTML stays an HTML note and text a file, as before.
  const plain = readImport(files);
  assert.deepEqual(plain.notes.map((n) => n.path), ["Work/Standup.html"]);
  assert.deepEqual(plain.files.map((f) => f.path), ["Recipes/Bread.txt"]);
});

test("an Evernote import is written, links and tags working, and says where it came from", async () => {
  const { vault } = openTempVault();
  {
    const set = readImport([{ name: "Travel.enex", bytes: strToU8(ENEX) }]);
    const added: string[] = [];
    const r = await writeImport(vault, set, { source: "test", bytes: { add: async (p: string) => void added.push(p) } as never });
    assert.equal(r.from, "evernote");
    assert.deepEqual(added, ["Travel/attachments/map.png"]);
    assert.match(fmtImport(r), /^From Evernote: imported 2 new notes, added 1 file\./);
    assert.ok(vault.files.read("Travel/Trip- Lisbon - Porto.md")!.includes("tags: [travel, to-do]"));
  }
});
