import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestSite } from "../web/src/store.ts";

test("Previews and local development are test sites; v1.commonink.app is not", () => {
  for (const host of ["pr-12-commonink.draftox.workers.dev", "localhost", "127.0.0.1", "[::1]"]) assert.ok(isTestSite(host), host);
  for (const host of ["v1.commonink.app", "commonink.app", "www.commonink.app", "pr-12-other.draftox.workers.dev", "evil-pr-1-commonink.example"]) assert.ok(!isTestSite(host), host);
});
