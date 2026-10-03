// The asset preview's keys: browsing with ←/→ leaves one key listener, and closing it leaves none.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoteMeta } from "../web/src/api.ts";

const W = window as unknown as typeof globalThis & Window;
document.body.append(Object.assign(document.createElement("div"), { id: "assets-view", hidden: true }));
globalThis.fetch = (async () => new Response("[]", { headers: { "content-type": "application/json" } })) as typeof fetch;
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
