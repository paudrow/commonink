// Regression tests for the security audit: what hostile note text turns into in the web app.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

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

test("an image link that isn't valid percent-encoding renders instead of throwing", () => {
  assert.equal(renderMarkdown("![a](%E0%A4%A)", "a.md"), '<p><img src="/api/file-resolve?target=%25E0%25A4%25A&amp;from=a.md" alt="a"></p>\n');
});
