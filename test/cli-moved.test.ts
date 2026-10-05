import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadCredentials } from "../src/cli/hosted.ts";

test("a sign-in saved for commonink.app goes to v1.commonink.app, where v1 moved; others stay as saved", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-config-"));
  const before = process.env.COMMONINK_CONFIG_DIR;
  process.env.COMMONINK_CONFIG_DIR = dir;
  try {
    const saved = { server: "https://commonink.app", clientId: "c", accessToken: "a", refreshToken: "r", expiresAt: 1 };
    fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify(saved));
    assert.deepEqual(loadCredentials(), { ...saved, server: "https://v1.commonink.app" });
    const preview = { ...saved, server: "https://pr-12-commonink.draftox.workers.dev" };
    fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify(preview));
    assert.deepEqual(loadCredentials(), preview);
  } finally {
    if (before === undefined) delete process.env.COMMONINK_CONFIG_DIR;
    else process.env.COMMONINK_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
