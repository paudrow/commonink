// Quick capture (#18): what a share puts in a note, where it goes, the service worker that receives
// it, the manifest that offers Common Ink in the share sheet, and the headers the worker is served with.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { captureBlock, withCaptured } from "../src/core/capture.ts";

const root = path.resolve(import.meta.dirname, "..");

test("a share becomes lines in a note: its title and text, the link alone on a line (a link card), and images", () => {
  assert.deepEqual(captureBlock({ title: "Rust 2027", text: "Worth a read", url: "https://example.com/rust" }), ["Rust 2027", "", "Worth a read", "", "https://example.com/rust"]);
  // Phones often send the link inside the text, and a title that's just the link again.
  assert.deepEqual(captureBlock({ title: "https://example.com/a", text: "Look at this https://example.com/a" }), ["Look at this", "", "https://example.com/a"]);
  assert.deepEqual(captureBlock({ text: "https://example.com/only" }), ["https://example.com/only"]);
  assert.deepEqual(captureBlock({ text: "Milk\nEggs" }, ["photo.jpg"]), ["Milk", "Eggs", "", "![[photo.jpg]]"]);
  assert.deepEqual(captureBlock({ url: "javascript:alert(1)", text: "hi" }), ["hi", "", "javascript:alert(1)"], "a non-web link stays text: it's never a link card");
  assert.deepEqual(captureBlock({}), []);
});

test("it goes at the end of the note's Captured section, made at the end of the note if there isn't one", () => {
  const block = ["Idea", "", "https://example.com"];
  assert.deepEqual(withCaptured("# 2026-10-01\n\n## Tasks\n\n## Log\n", block), { content: "# 2026-10-01\n\n## Tasks\n\n## Log\n\n## Captured\n\nIdea\n\nhttps://example.com\n", line: 9 });
  const again = withCaptured("# Day\n\n## Captured\n\nFirst\n\n## Log\n\n- 09:00 x\n", ["Second"]);
  assert.equal(again.content, "# Day\n\n## Captured\n\nFirst\n\nSecond\n\n## Log\n\n- 09:00 x\n");
  assert.equal(again.line, 7);
  assert.equal(withCaptured("# Day\n\n### captured\n", ["x"]).content, "# Day\n\n### captured\n\nx\n", "any level, any case");
  assert.equal(withCaptured("```\n## Captured\n```\n", ["x"]).content, "```\n## Captured\n```\n\n## Captured\n\nx\n", "a heading in code isn't one");
  assert.equal(withCaptured("", ["x"]).content, "## Captured\n\nx\n");
});

// ------------------------------------------------------------------ the service worker, run in a fake worker

/** web/public/sw.js with fake caches and fetch; `dispatch` sends it an event. */
function worker(origin = "https://commonink.app") {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === "string" ? new URL(r, origin).href : r.url);
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name)!;
      return {
        match: async (r: Request | string) => s.get(key(r))?.clone(),
        put: async (r: Request | string, res: Response) => void s.set(key(r), res),
        delete: async (r: Request | string) => s.delete(key(r)),
        keys: async () => [...s.keys()].map((u) => new Request(u)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const fetched: string[] = [];
  const listeners: Record<string, (e: any) => void> = {};
  const self = {
    location: new URL(origin),
    addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({ self, caches, fetch: async (r: Request) => (fetched.push(r.url), new Response("body", { status: 200 })), Response, Request, URL, FormData, File, Blob, Date, Math, JSON, Promise, console });
  vm.runInContext(fs.readFileSync(path.join(root, "web/public/sw.js"), "utf8"), context);
  const dispatch = async (request: Request) => {
    let answer: Promise<Response> | undefined;
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => (answer = p) });
    return answer ? await answer : null;
  };
  return { dispatch, stores, fetched };
}

test("a share from the phone is kept for the app, then the capture screen opens", async () => {
  const w = worker();
  const form = new FormData();
  form.set("title", "A page");
  form.set("text", "Read later");
  form.set("url", "https://example.com/p");
  form.append("files", new File(["png bytes"], "shot.png", { type: "image/png" }));
  const res = (await w.dispatch(new Request("https://commonink.app/share", { method: "POST", body: form })))!;
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get("Location")!);
  assert.equal(to.pathname, "/capture");
  const id = to.searchParams.get("share")!;
  assert.match(id, /^[a-z0-9]+$/);
  const kept = w.stores.get("commonink-shares")!;
  assert.deepEqual(await kept.get(`https://commonink.app/shares/${id}`)!.clone().json(), { title: "A page", text: "Read later", url: "https://example.com/p", files: [{ name: "shot.png", type: "image/png" }] });
  assert.equal(await kept.get(`https://commonink.app/shares/${id}/0`)!.clone().text(), "png bytes");
});

test("the worker keeps only the app's built files: never pages, notes or API answers, and nothing from other sites", async () => {
  const w = worker();
  for (const url of ["https://commonink.app/", "https://commonink.app/notes/plan-abcd1234", "https://commonink.app/api/w/x/notes", "https://commonink.app/api/files/a.png", "https://evil.example/assets/x.js"]) {
    assert.equal(await w.dispatch(new Request(url)), null, `${url} goes straight to the network`);
  }
  assert.equal(await w.dispatch(new Request("https://commonink.app/api/w/x/note", { method: "PUT", body: "{}" })), null);
  await w.dispatch(new Request("https://commonink.app/assets/index-abc123.js"));
  await w.dispatch(new Request("https://commonink.app/assets/index-abc123.js"));
  assert.deepEqual(w.fetched, ["https://commonink.app/assets/index-abc123.js"], "a built file is fetched once, then kept");
  assert.deepEqual([...w.stores.keys()], ["commonink-assets-v1"]);
});

test("the manifest offers Common Ink in the share sheet: links, text and images, posted to /share", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "web/public/site.webmanifest"), "utf8"));
  assert.equal(m.name, "Common Ink");
  assert.equal(m.display, "standalone");
  assert.deepEqual([m.id, m.scope, m.start_url], ["/", "/", "/"]);
  assert.deepEqual(m.share_target, {
    action: "/share",
    method: "POST",
    enctype: "multipart/form-data",
    params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["image/*"] }] },
  });
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(root, "web/public", icon.src)), icon.src);
});
