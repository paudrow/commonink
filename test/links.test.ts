import { test } from "node:test";
import assert from "node:assert/strict";
import { externalTitle, linkKind, missingNote } from "../web/src/links.ts";
import { openTempVault } from "./helpers.ts";
import { NOTE_ID } from "../src/core/ids.ts";

test("http, https and mailto links leave the app; anything else is a note", () => {
  assert.deepEqual(
    ["https://example.com/a", "HTTP://x.org", "mailto:sam@example.com", " https://a.b ", "commonink:Launch", "Projects/Launch.md", "Launch", "#heading", "ftp-notes.md", "javascript:alert(1)"].map(linkKind),
    ["external", "external", "external", "external", "internal", "internal", "internal", "internal", "internal", "internal"],
  );
});

test("an external link's tooltip names its domain, or the address a mailto writes to", () => {
  assert.deepEqual(
    ["https://www.github.com/paudrow/commonink", "http://docs.example.org:8080/x", "mailto:sam%40acme.test?subject=Hi", "https://", "mailto:%", "mailto:<img src=x onerror=alert(1)>@x.org", "https://%zz"].map(externalTitle),
    ["github.com · opens in your browser", "docs.example.org · opens in your browser", "sam@acme.test · opens in your browser", "Opens in your browser", "Opens in your browser", "Opens in your browser", "Opens in your browser"],
  );
});

test("a [[link]] is missing only when no note has its name; ids, URLs and ../ paths are left to the server", () => {
  const notes = [{ path: "Projects/Roadmap.md" }, { path: "Archive/Ideas/Old plan.md" }, { path: "assets/logo.png" }];
  const missing = ["Roadmap", "projects/roadmap", "Roadmap#Goals", "Roadmap|the plan", "Old plan", "Ideas/Old plan", "assets/logo.png", "#Goals", "ab3cd4ef", "../x", "/notes/x-ab3cd4ef", "Ghost", "Elsewhere/Roadmap"]
    .map((t) => missingNote(t, notes));
  assert.deepEqual(missing, [false, false, false, false, false, false, false, false, false, false, false, true, true]);
});

test("missingNote answers as matching every path would, for tricky names, and doesn't rekey the list per link", () => {
  // The rule missingNote implements, written out the slow way: some path's key is the link's key or ends in /key.
  const key = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\.(md|markdown)$/i, "").normalize("NFC").toLowerCase();
  const slow = (target: string, notes: { path: string }[]) => {
    const name = target.replace(/[#|].*$/, "").trim();
    if (!name || NOTE_ID.test(name) || /^[a-z][a-z0-9+.-]*:|^\/|\.\./i.test(name)) return false;
    return !notes.some((n) => key(n.path) === key(name) || key(n.path).endsWith(`/${key(name)}`));
  };
  const notes = [
    "Projects/Roadmap.md", "Archive/Ideas/Old plan.MD", "assets/logo.png", "Café.md", "Résumé.markdown", "Deep/a/b/c/Leaf.md",
    "Win\\Folder\\Note.md", "./Dot.md", "Trailing/", " Spaced .md", "notes.md.md", "ÅNGSTRÖM.md", "a//double.md", "x.markdown/y.md",
  ].map((path) => ({ path }));
  const targets = [
    "Roadmap", "ROADMAP.md", "projects/Roadmap.markdown", "oadmap", "jects/Roadmap", "Old plan", "ideas/old PLAN", "Archive/Ideas/Old plan.md",
    "logo.png", "logo", "Café", "café", "Résumé", "résumé.md", "c/Leaf", "b/c/leaf.md", "a/b", "Folder/Note", "Win/Folder/Note", "win\\folder\\note",
    "Dot", "./Dot", "Trailing", "./", ".md", "Spaced", " Spaced ", "notes.md", "notes", "ångström", "/double", "double", "a//double", "x/y", "y",
    "Roadmap#Goals", "Ghost|alias", "ab3cd4ef", "../x", "/abs", "https://x.org", "", "  ", "#Self", "Deep", "Deep/", "Leaf/",
  ];
  const fresh = () => notes.map((n) => ({ ...n }));
  for (const t of targets) assert.equal(missingNote(t, notes), slow(t, notes), JSON.stringify(t));
  for (const t of targets) assert.equal(missingNote(t, fresh()), slow(t, notes), `fresh list, ${JSON.stringify(t)}`);

  // The same list asked about many links keys each path once, not once per link.
  let reads = 0;
  const counted = notes.map((n) => ({ get path() { reads++; return n.path; } }));
  for (let i = 0; i < 50; i++) missingNote("Ghost", counted);
  assert.equal(reads, notes.length);
  // A new list (a refresh) sees its own notes.
  assert.equal(missingNote("Ghost", [...notes, { path: "ghost.md" }]), false);
  assert.equal(missingNote("Ghost", notes), true);
});

test("missingLinks groups links to notes that aren't here by target, skipping archived notes unless asked", () => {
  const { vault } = openTempVault({
    "Here.md": "# Here\n",
    "A.md": "# A\n\n[[Here]] and [[Gone]] and [[Here#Top]] and [[#Self]]\n![[Missing image.png]]\n",
    "Projects/B.md": "# B\n\nSee [[gone|the gone note]] and [the doc](Docs/Spec.md) and [cal](/calendar)\n",
    "Archive/C.md": "# C\n\n[[Gone]] [[Old]]\n",
  });
  const all = vault.missingLinks();
  assert.deepEqual(all.map((m) => [m.target, m.from.map((f) => `${f.path}:${f.line}`).sort()]), [
    ["Gone", ["A.md:3", "Projects/B.md:3"]],
    ["Docs/Spec.md", ["Projects/B.md:3"]],
    ["Missing image.png", ["A.md:4"]],
  ]);
  assert.deepEqual(vault.missingLinks({ folder: "Projects" }).map((m) => m.target), ["Docs/Spec.md", "gone"]);
  assert.deepEqual(vault.missingLinks({ scope: "all" }).map((m) => [m.target, m.from.length]), [["Gone", 3], ["Docs/Spec.md", 1], ["Missing image.png", 1], ["Old", 1]]);
  vault.create("Gone", "# Gone\n", "t");
  assert.deepEqual(vault.missingLinks().map((m) => m.target), ["Docs/Spec.md", "Missing image.png"]);
});
