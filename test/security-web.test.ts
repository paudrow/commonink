// Regression tests for the security audit: what hostile note text turns into in the web app.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuMs } from "./helpers.ts";

const { inline } = await import("../web/src/taskRow.ts");
const { renderMarkdown } = await import("../web/src/render.ts");

test("task text is sanitized after links and tags go in, so they can't break out of an attribute", () => {
  assert.equal(
    inline("Call [[Mom|mom]] about #plans"),
    'Call <span class="qt-link">mom</span> about <span class="tag" data-tag="plans" title="Tasks tagged #plans">#plans</span>',
  );
  const hostile = inline('<span title="[[<img src=x onerror=alert(1)>]]">t</span>');
  assert.equal(/<img|onerror/.test(hostile), false, hostile);
  assert.equal(inline("buy milk \u00039\u0004"), "buy milk 9", "placeholder characters in the text are dropped, not trusted");
});

test("a task can't carry a form, an input or a button", () => {
  assert.equal(inline('<form action="https://evil.example"><input type="password"><button>Sign in</button></form>'), "Sign in");
});

test("note HTML can't stand in for the app's elements or float over it", () => {
  assert.equal(renderMarkdown('<div id="backlinks" popover>x</div>', "a.md"), '<div id="user-content-backlinks">x</div>');
  assert.equal(renderMarkdown('<button popovertarget="p">b</button>', "a.md"), "<p><button>b</button></p>\n");
});

test("a link in note content opens in a new tab, never in place of the app", () => {
  const opened: string[] = [];
  const realOpen = window.open;
  window.open = ((url: string) => (opened.push(url), null)) as typeof window.open;
  const click = (href: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = "link";
    document.body.append(a);
    const e = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(e);
    a.remove();
    return e.defaultPrevented;
  };
  assert.deepEqual(
    [click("https://evil.example/login"), click("/notes/plan-k3x9q2mf"), click("mailto:a@b.example"), click("weird:thing")],
    [true, false, false, true],
  );
  assert.deepEqual(opened, ["https://evil.example/login"]);
  window.open = realOpen;
});

test("a Mastodon-style embed, which can be any host, gets no forms, clipboard or unsandboxed popups", async () => {
  const { resolveEmbed, providerFrame } = await import("../web/src/embeds/providers.ts");
  const frame = providerFrame((await resolveEmbed("https://evil.example/@a/123456"))!);
  assert.deepEqual([frame.getAttribute("sandbox"), frame.getAttribute("allow")], ["allow-scripts allow-same-origin allow-popups", "autoplay; picture-in-picture; fullscreen"]);
  const youtube = providerFrame((await resolveEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))!);
  assert.match(youtube.getAttribute("sandbox")!, /allow-forms/);
});

test("hostile markdown renders in linear time, and deep quotes don't overflow the stack", async () => {
  const { sectionOf } = await import("../web/src/render.ts");
  const { toNumber } = await import("../web/src/csv.ts");
  const cases: Array<[string, () => unknown]> = [
    ["33k ![[", () => renderMarkdown("![[".repeat(33_000), "a.md")],
    ["100k [", () => renderMarkdown("[".repeat(100_000), "a.md")],
    ["backtick runs that never close", () => renderMarkdown(Array.from({ length: 400 }, (_, i) => "`".repeat(i + 1)).join(" [[a]] "), "a.md")],
    ["a section heading with 100k spaces", () => sectionOf(`## a${" ".repeat(100_000)}b\n`, "x")],
    ["a CSV cell of 100k digits", () => toNumber(`${"1".repeat(100_000)}x`)],
  ];
  const slow = cases.flatMap(([name, run]) => {
    const ms = cpuMs(run);
    return ms > 1500 ? [`${name}: ${Math.round(ms)} ms`] : [];
  });
  assert.deepEqual(slow, []);
  assert.match(renderMarkdown("> ".repeat(5000) + "deep", "a.md"), /deep/);
  assert.deepEqual(["$1,200", "15%", "-3.5", ".5", "1,2x"].map(toNumber), [1200, 15, -3.5, 0.5, NaN]);
});

test("an image link that isn't valid percent-encoding renders instead of throwing", () => {
  assert.equal(renderMarkdown("![a](%E0%A4%A)", "a.md"), '<p><img src="/api/file-resolve?target=%25E0%25A4%25A&amp;from=a.md" alt="a"></p>\n');
});

/** Each link in rendered HTML, as its attributes. */
function linksIn(html: string) {
  const box = document.createElement("div");
  box.innerHTML = html;
  return [...box.querySelectorAll("a")].map((a) => Object.fromEntries([...a.attributes].map((at) => [at.name, at.value])));
}

test("the web-link marker runs after sanitizing: it can't bring back a bad href, and its title only names a parsed domain", () => {
  const hostile = [
    "[x](javascript:alert(1))",
    '<a href="javascript:alert(1)" title="Bank login">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<a href=" vbscript:msgbox(1)">x</a>',
  ];
  for (const md of hostile) assert.deepEqual(linksIn(renderMarkdown(md, "a.md")).map((a) => [a.href, a.class]), [[undefined, undefined]], md);
  // An allowed web link gets only the class and a title naming its domain; a note's own title and handlers don't survive.
  assert.deepEqual(linksIn(renderMarkdown('<a href="https://www.evil.example/login" title="Your bank" onclick="alert(1)" onmouseover="alert(2)">pay</a>', "a.md")), [
    { href: "https://www.evil.example/login", title: "evil.example · opens in your browser", class: "is-external" },
  ]);
  // A mailto names its address only when it parses as one, and a bad escape doesn't throw.
  assert.deepEqual(
    ["[m](mailto:sam@acme.test)", "[m](mailto:%E0%A4%A)", "[m](mailto:%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E@x.org)"].map((md) => linksIn(renderMarkdown(md, "a.md"))[0]?.title),
    ["sam@acme.test · opens in your browser", "Opens in your browser", "Opens in your browser"],
  );
  // Task text goes through the same sanitizer, so the same holds there.
  assert.deepEqual(linksIn(inline("see [x](https://evil.example) and [y](javascript:alert(1))")), [
    { href: "https://evil.example", class: "is-external", title: "evil.example · opens in your browser" },
    {},
  ]);
});
