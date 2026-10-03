import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HIDDEN, hiddenBy, hiddenThere, withFolderHidden } from "../web/src/hiddenFolders.ts";
import { appFolderRefusal, isAppFolder } from "../src/core/appFolders.ts";

test("a workspace hides Config and Templates to start with", () => {
  assert.deepEqual(DEFAULT_HIDDEN, ["Config", "Templates"]);
});

test("a hidden folder hides the folders in it, and nothing that only starts with its name", () => {
  const hidden = ["Config", "Archive/Old/"];
  assert.equal(hiddenBy("Config", hidden), "Config");
  assert.equal(hiddenBy("Config/Users", hidden), "Config");
  assert.equal(hiddenBy("Configs", hidden), null);
  assert.equal(hiddenBy("Archive/Old/2024", hidden), "Archive/Old");
  assert.equal(hiddenBy("Archive", hidden), null);
  assert.equal(hiddenBy("Ideas", []), null);
});

test("Show hidden folders counts the listed folders that are there", () => {
  assert.deepEqual(hiddenThere(["Config", "Config/Users", "Ideas"], ["Config", "Templates"]), ["Config"]);
  assert.deepEqual(hiddenThere(["Ideas"], ["Config", "Templates"]), []);
});

test("hiding a folder adds it (dropping folders listed inside it); showing one takes it out", () => {
  assert.deepEqual(withFolderHidden(["Config", "Ideas/Old"], "Ideas", true), ["Config", "Ideas"]);
  assert.deepEqual(withFolderHidden(["Config", "Templates"], "Templates/", false), ["Config"]);
  assert.deepEqual(withFolderHidden(["Config"], "Config", true), ["Config"], "no twice");
});

test("the app's own folders are known by name, with why each keeps it", () => {
  assert.deepEqual(["Config", "Config/Users", "Templates", "People", "Events", "Journal", "Archive", "Ideas", "Templates/Mine"].map(isAppFolder), [true, true, true, true, true, true, true, false, false]);
  assert.equal(appFolderRefusal("Templates", "rename"), "Templates is where templates live, so it keeps its name; its notes can still be moved one by one");
  assert.equal(appFolderRefusal("Journal", "delete"), "Journal is where daily notes go, so it can't be deleted; its notes can still be deleted one by one");
  assert.equal(appFolderRefusal("Ideas", "delete"), null);
});
