import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLine, parseFence, setFenceLang, setFenceWrap, toggleWrap, wraps } from "../src/core/fence.ts";

const plain = (info: string) => {
  const f = parseFence(info);
  return { ...f, highlight: [...f.highlight] };
};

test("an info string names a language, then settings other renderers ignore", () => {
  assert.deepEqual(plain(""), { lang: "", wrap: null, title: null, highlight: [], lineNumbers: false });
  assert.deepEqual(plain("ts"), { lang: "ts", wrap: null, title: null, highlight: [], lineNumbers: false });
  assert.deepEqual(plain('ts nowrap title="server side.ts" {1,3-5} showLineNumbers'), {
    lang: "ts",
    wrap: "nowrap",
    title: "server side.ts",
    highlight: [1, 3, 4, 5],
    lineNumbers: true,
  });
  assert.deepEqual(plain("nowrap"), { lang: "", wrap: "nowrap", title: null, highlight: [], lineNumbers: false }, "a setting alone isn't a language");
  assert.deepEqual(plain("python title=app.py WRAP {x,0,2}"), { lang: "python", wrap: "wrap", title: "app.py", highlight: [2], lineNumbers: false });
});

test("setting the language or the wrapping edits one word and keeps everything else as written", () => {
  assert.equal(setFenceLang('js nowrap title="a b"', "ts"), 'ts nowrap title="a b"');
  assert.equal(setFenceLang("nowrap", "sql"), "sql nowrap");
  assert.equal(setFenceLang("js extra", ""), "extra");
  assert.equal(setFenceWrap("ts {2}", "nowrap"), "ts nowrap {2}");
  assert.equal(setFenceWrap("ts nowrap {2}", null), "ts {2}");
  assert.equal(setFenceWrap("", "nowrap"), "nowrap");
});

test("toggling wrap writes a setting only where the block differs from the reader's default", () => {
  assert.equal(wraps(parseFence("ts"), true), true);
  assert.equal(wraps(parseFence("ts"), false), false);
  assert.equal(toggleWrap("ts", true), "ts nowrap");
  assert.equal(toggleWrap("ts nowrap", true), "ts");
  assert.equal(toggleWrap("ts", false), "ts wrap");
  assert.equal(toggleWrap("ts wrap", false), "ts");
  assert.equal(toggleWrap("ts nowrap", false), "ts wrap");
});

test("diff lines are added, removed, or neither, with file headers neither", () => {
  assert.deepEqual(["+x", "-y", " z", "+++ b/a.ts", "--- a/a.ts", "@@ -1 +1 @@", ""].map(diffLine), ["add", "del", null, null, null, null, null]);
});

test("a hostile info string parses in linear time and bounded space", () => {
  const t = performance.now();
  const f = parseFence(`ts ${'title="'.repeat(20_000)} {1-99999999} ${"{".repeat(50_000)}`);
  assert.ok(performance.now() - t < 200, "fast");
  assert.equal(f.highlight.size, 0, "settings past the first 500 characters are ignored");
  assert.equal(parseFence("ts {1-99999999}").highlight.size, 5000);
});
