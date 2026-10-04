// The asset preview's keys: browsing with ←/→ leaves one key listener, and closing it leaves none.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoteMeta } from "../web/src/api.ts";

const W = window as unknown as typeof globalThis & Window;
document.body.append(Object.assign(document.createElement("div"), { id: "assets-view", hidden: true }));
/** Whether the server takes a change to an asset's tags. */
let saves = true;
globalThis.fetch = (async (req: string, init?: RequestInit) => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (String(req).startsWith("/api/asset-tags") && init?.method === "PUT") return saves ? json({ tags: JSON.parse(String(init.body)).tags }) : json({ error: "Viewers can't tag files" }, 403);
  if (String(req).startsWith("/api/asset-tags")) return json({ "assets/a.png": ["brand"] });
  return json([]);
}) as typeof fetch;
const { Assets } = await import("../web/src/assets.ts");

const asset = (path: string): NoteMeta => ({ id: path, path, kind: "asset", title: path, version: "1", mtime: 0, size: 1 });
const key = (target: EventTarget, k: string) => target.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("after browsing with the arrows and closing, keys typed elsewhere don't delete, rename or reopen an asset", async () => {
  const deleted: string[][] = [];
  const renamed: string[] = [];
  const assets = new Assets({
    notes: () => [asset("assets/a.png"), asset("assets/b.png")],
    upload: async () => [],
    open: () => {},
    archive: async () => {},
    delete: async (paths) => (deleted.push(paths), paths),
    rename: async (path) => (renamed.push(path), null),
    readOnly: () => false,
    embedName: (p) => p,
    tags: () => [],
    refreshTags: async () => {},
    toast: () => {},
  });
  assets.show({ open: "assets/a.png" });
  key(document.body, "ArrowRight");
  key(document.body, "ArrowRight");
  assert.equal(assets.previewed, "assets/a.png");
  assert.equal(document.querySelectorAll("#asset-preview").length, 1);

  document.querySelector<HTMLElement>("#asset-preview .ap-close")!.click();
  assert.equal(assets.previewed, null);
  assert.equal(document.querySelector("#asset-preview"), null);

  // Keys typed later, outside any input (a note's editor is a contenteditable div).
  const editor = document.createElement("div");
  document.body.append(editor);
  for (const k of ["Backspace", "Delete", "F2", "ArrowLeft", "ArrowRight", "Escape"]) assert.equal(key(editor, k), true, `${k} reached the page`);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, []);
  assert.deepEqual(renamed, []);
  assert.equal(assets.previewed, null);
  assert.equal(document.querySelector("#asset-preview"), null);
});

test("taking a tag off an asset says so, and a refused change says why instead", async () => {
  const said: string[] = [];
  const assets = new Assets({
    notes: () => [asset("assets/a.png")],
    upload: async () => [],
    open: () => {},
    archive: async () => {},
    delete: async (paths) => paths,
    rename: async () => null,
    readOnly: () => false,
    embedName: (p) => p,
    tags: () => [],
    refreshTags: async () => {},
    toast: (t) => said.push(t.text),
  });
  assets.show({ open: "assets/a.png" });
  await new Promise((r) => setTimeout(r, 20));
  assets.preview("assets/a.png"); // drawn again, now its tags have loaded
  const remove = () => document.querySelector<HTMLElement>('#asset-preview [title="Remove #brand"]')!.click();

  saves = false;
  remove();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(said, ["Viewers can't tag files"]);
  assert.ok(document.querySelector('#asset-preview [title="Remove #brand"]'), "the tag stays");

  saves = true;
  remove();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(said.slice(1), ["Removed #brand from a.png"]);
  assert.equal(document.querySelector('#asset-preview [title="Remove #brand"]'), null);
  document.querySelector<HTMLElement>("#asset-preview .ap-close")!.click();
});
