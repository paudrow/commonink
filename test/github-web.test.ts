// GitHub cards in rendered notes: a link alone on its line becomes its card; others stay links.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { renderMarkdown } = await import("../web/src/render.ts");
const { hydrateGithubLinks } = await import("../web/src/github.ts");

test("a GitHub issue link alone on its line becomes a card, its text drawn as text", async () => {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    asked.push(input);
    const url = new URL(input, "http://app").searchParams.get("url")!;
    if (!url.endsWith("/1")) return new Response("{}", { status: 429 });
    const github = {
      url, repo: "a/b", number: 1, kind: "pull", title: "<img src=x onerror=alert(1)>", state: "merged", reason: null,
      labels: [{ name: "bug", color: "d73a4a" }], author: "audrow", comments: 2, updatedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify({ url, title: github.title, github }));
  }) as typeof fetch;
  try {
    const md = "https://github.com/a/b/pull/1\n\nSee https://github.com/a/b/issues/2 inline.\n\nhttps://github.com/a/b/issues/3\n\nhttps://example.com/a/b/issues/1\n";
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(md, "n.md");
    hydrateGithubLinks(root);
    await new Promise((r) => setTimeout(r, 20));
    const cards = root.querySelectorAll("a.gh-card");
    assert.equal(cards.length, 1);
    assert.equal(cards[0].getAttribute("href"), "https://github.com/a/b/pull/1");
    assert.equal(cards[0].querySelector(".gh-title-text")!.textContent, "<img src=x onerror=alert(1)>");
    assert.equal(cards[0].querySelector("img"), null);
    assert.equal(cards[0].querySelector(".gh-pill")!.textContent, "Merged");
    // The inline one isn't asked about; the one GitHub won't answer for stays a plain link.
    assert.equal(asked.length, 2);
    assert.ok(root.querySelector('p > a[href="https://github.com/a/b/issues/3"]'));
  } finally {
    globalThis.fetch = real;
  }
});
