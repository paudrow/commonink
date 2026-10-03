// A shared note's page checks its links once each, however often live updates re-render it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkResolver } from "../web/src/linkResolver.ts";

const counting = (answer = (k: string) => Promise.resolve(k.toUpperCase())) => {
  const asked: string[] = [];
  return { asked, ask: (k: string) => (asked.push(k), answer(k)) };
};

test("re-rendering asks about each link once, sharing a check still in flight", async () => {
  const { asked, ask } = counting();
  const begin = linkResolver(ask);
  const first = begin();
  const [a, b] = [first.resolve("a"), first.resolve("a")];
  assert.equal(await a, "A");
  assert.equal(await b, "A");
  const second = begin();
  assert.equal(await second.resolve("a"), "A");
  assert.equal(await second.resolve("b"), "B");
  assert.deepEqual(asked, ["a", "b"]);
});

test("a newer render stops the older one", () => {
  const begin = linkResolver(counting().ask);
  const first = begin();
  assert.ok(first.current());
  const second = begin();
  assert.ok(!first.current());
  assert.ok(second.current());
});

test("a failed check is asked again next time", async () => {
  let fail = true;
  const { asked, ask } = counting((k) => (fail ? Promise.reject(new Error("busy")) : Promise.resolve(k)));
  const begin = linkResolver(ask);
  await assert.rejects(begin().resolve("a")!);
  fail = false;
  assert.equal(await begin().resolve("a"), "a");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a render checks at most the limit of distinct links; repeats don't count", async () => {
  const { asked, ask } = counting();
  const run = linkResolver(ask, 2)();
  assert.ok(run.resolve("a"));
  assert.ok(run.resolve("b"));
  assert.ok(run.resolve("a"));
  assert.equal(run.resolve("c"), null);
  assert.deepEqual(asked, ["a", "b"]);
});
