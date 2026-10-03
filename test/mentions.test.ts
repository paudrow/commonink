import { test } from "node:test";
import assert from "node:assert/strict";
import { findMentions, linkMentionIn } from "../src/core/mentions.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault } from "./helpers.ts";

test("findMentions: whole words in prose, any case; not in code, links, URLs, tags or frontmatter", () => {
  const md = [
    "---",
    "title: Roadmap notes",
    "---",
    "The roadmap is out. Roadmaps aren't.",
    "See [[Roadmap]] and [the Roadmap](Roadmap.md) and `Roadmap` and #roadmap.",
    "https://example.com/roadmap",
    "```",
    "Roadmap in code",
    "```",
    "Q3 Roadmap, then the ROADMAP.",
  ].join("\n");
  assert.deepEqual(
    findMentions(md, ["Roadmap"]).map((m) => [m.line, m.from, m.text]),
    [
      [4, 4, "roadmap"],
      [10, 3, "Roadmap"],
      [10, 21, "ROADMAP"],
    ],
  );
  assert.deepEqual(findMentions("Acme Corp hired Acme.", ["Acme", "Acme Corp"]).map((m) => m.text), ["Acme Corp", "Acme"], "the longer name wins");
  assert.deepEqual(findMentions("an AI or a b", ["AI", ""]), [], "names under three letters are too common to suggest");
});

test("findMentions stays fast on a long run of scheme characters with no ://, and still skips URLs", () => {
  const md = "# T\n\nAcme " + "a".repeat(100_000) + "\n\nsee https://acme.example/Acme and <git+ssh://h/Acme> and Acme.";
  const t = performance.now();
  const found = findMentions(md, ["Acme"]);
  assert.ok(performance.now() - t < 200, `took ${Math.round(performance.now() - t)} ms`);
  assert.deepEqual(found.map((m) => [m.line, m.from]), [[3, 0], [5, 57]], "the URLs' Acme isn't a mention");
});

test("linkMentionIn writes [[Name]], or [[Name|as written]], and refuses when the text moved", () => {
  const md = "# Plan\n\nThe roadmap is out.\n";
  const [m] = findMentions(md, ["Roadmap"]);
  assert.equal(linkMentionIn(md, m, "Roadmap"), "# Plan\n\nThe [[Roadmap|roadmap]] is out.\n");
  assert.equal(linkMentionIn("# Plan\n\nThe Roadmap.\n", findMentions("# Plan\n\nThe Roadmap.\n", ["Roadmap"])[0], "Roadmap"), "# Plan\n\nThe [[Roadmap]].\n");
  assert.equal(linkMentionIn("# Plan\n\nA roadmap is out.\n", m, "Roadmap"), null);
  assert.equal(linkMentionIn("# Plan\n\nThe [[roadmap]] is out.\n", { ...m, from: 6, to: 13 }, "Roadmap"), null, "already a link");
});

test("unlinkedMentions finds a note's title, file name and aliases in other active notes, not itself or archived ones", () => {
  const { vault } = openTempVault({
    "Projects/Launch plan.md": "---\naliases: [Liftoff]\n---\n# Launch plan\n\nThe launch plan itself.\n",
    "A.md": "# A\n\nWe follow the launch plan. Also [[Launch plan]].\n",
    "B.md": "# B\n\nLiftoff is Friday.\n\n```\nlaunch plan\n```\n",
    "C.md": "# C\n\nNothing here about launches.\n",
    "Archive/D.md": "# D\n\nThe old launch plan.\n",
  });
  const found = vault.unlinkedMentions("Launch plan");
  assert.deepEqual(found.map((m) => [m.path, m.line, m.text]).sort(), [
    ["A.md", 3, "launch plan"],
    ["B.md", 3, "Liftoff"],
  ]);
  assert.equal(found.find((m) => m.path === "A.md")!.context, "We follow the launch plan. Also [[Launch plan]].");
});

test("linkMention links one mention as one change; the note then has a backlink and one fewer mention", () => {
  const { vault } = openTempVault({
    "Projects/Launch plan.md": "# Launch plan\n",
    "A.md": "# A\n\nThe launch plan, and the launch plan again.\n",
  });
  const [first, second] = vault.unlinkedMentions("Launch plan");
  const r = vault.linkMention("Launch plan", first, "tester");
  assert.equal(vault.read("A.md").content, "# A\n\nThe [[Launch plan|launch plan]], and the launch plan again.\n");
  assert.equal(r.change?.source, "tester");
  assert.deepEqual(vault.backlinks("Launch plan").map((b) => b.path), ["A.md"]);
  assert.equal(vault.unlinkedMentions("Launch plan").length, 1);
  // The second mention's columns moved: linking it as it was read is a conflict, not a wrong edit.
  assert.throws(() => vault.linkMention("Launch plan", second, "tester"), /changed/);
  assert.throws(() => vault.linkMention("Launch plan", { ...first, text: "something else" }, "tester"), /isn't a name/);
});

test("GET /mentions and POST /mentions/link", async () => {
  const { vault } = openTempVault({ "Roadmap.md": "# Roadmap\n", "A.md": "# A\n\nThe roadmap.\n" });
  const events: string[] = [];
  const host: ApiHost = {
    vault,
    actor: "tester",
    user: "tester",
    canEditShared: true,
    info: () => ({}),
    written: (rel) => events.push(`written ${rel}`),
    moved: () => {},
    removed: () => {},
    tree: () => {},
  };
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await handleApi(host, new Request(`http://localhost/api${route}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), route.split("?")[0]);
    return { status: res!.status, body: await res!.json() };
  };
  const list = await call("GET", "/mentions?path=Roadmap.md");
  assert.deepEqual(list.body.map((m: { path: string; text: string }) => [m.path, m.text]), [["A.md", "roadmap"]]);
  const linked = await call("POST", "/mentions/link", { target: "Roadmap.md", ...list.body[0] });
  assert.equal(linked.status, 200);
  assert.equal(typeof linked.body.change, "number");
  assert.deepEqual(events, ["written A.md"]);
  assert.equal(vault.read("A.md").content, "# A\n\nThe [[Roadmap|roadmap]].\n");
  const again = await call("POST", "/mentions/link", { target: "Roadmap.md", ...list.body[0] });
  assert.equal(again.status, 409);
});
