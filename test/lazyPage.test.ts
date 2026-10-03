import { test } from "node:test";
import assert from "node:assert/strict";
import { lazyPage, type LazyEnv } from "../web/src/lazyPage.ts";

function env(start = 1_000_000) {
  const kept = new Map<string, string>();
  const went: string[] = [];
  let now = start;
  const e: LazyEnv = { assign: (u) => void went.push(u), storage: () => ({ getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) }), now: () => now };
  return { e, went, later: (ms: number) => (now += ms) };
}
const settled = <T>(p: Promise<T>) => Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
const gone = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/queryHelpPage-0ld.js"));

test("a page's code is fetched once, and the same page comes back after", async () => {
  let loads = 0;
  const { e } = env();
  const load = lazyPage("/query-help", async () => ({ n: ++loads }), () => assert.fail("not failed"), e);
  assert.equal(await load(), await load());
  assert.equal(loads, 1);
});

test("code gone since a deploy loads the app afresh at that page, instead of drawing nothing", async () => {
  const { e, went } = env();
  const failed: unknown[] = [];
  const load = lazyPage("/query-help", gone, (err) => failed.push(err), e);
  assert.equal(await settled(load()), "pending", "nothing half-drawn while the page loads again");
  assert.deepEqual(went, ["/query-help"]);
  assert.deepEqual(failed, []);
});

test("when the fresh load can't fetch it either, it says so instead of loading again and again", async () => {
  const { e, went, later } = env();
  const failed: unknown[] = [];
  const load = lazyPage("/query-help", gone, (err) => failed.push(err), e);
  void load();
  // The fresh page, a moment later: same session, same failure.
  const again = lazyPage("/query-help", gone, (err) => failed.push(err), e);
  assert.equal(await settled(again()), "pending");
  assert.deepEqual(went, ["/query-help"]);
  assert.equal(failed.length, 1);
  // Much later (another deploy), it may load afresh again; and a different page is its own try.
  later(60_000);
  void lazyPage("/query-help", gone, () => {}, e)();
  void lazyPage("/tags", gone, () => {}, e)();
  await settled(Promise.resolve());
  assert.deepEqual(went, ["/query-help", "/query-help", "/tags"]);
});

test("a failed fetch is tried again next time, not remembered as the page", async () => {
  const { e } = env();
  let tries = 0;
  const load = lazyPage("/tags", () => (++tries === 1 ? gone() : Promise.resolve("tags")), () => {}, e);
  void load();
  await settled(Promise.resolve());
  assert.equal(await load(), "tags");
});

test("without session storage it never loads afresh (it couldn't tell a loop from a deploy)", async () => {
  const went: string[] = [];
  const failed: unknown[] = [];
  const load = lazyPage("/tags", gone, (err) => failed.push(err), { assign: (u) => void went.push(u), storage: () => null, now: () => 0 });
  void load();
  await settled(Promise.resolve());
  assert.deepEqual(went, []);
  assert.equal(failed.length, 1);
});
