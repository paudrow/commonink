import { test } from "node:test";
import assert from "node:assert/strict";

// Loaded by a computed name, so this project's typecheck doesn't follow it into Workers types
// (cloud:typecheck checks auth.ts itself).
const AUTH = "../cloud/src/auth.ts";
type HandleAuth = (req: Request, env: unknown, onIn: () => Promise<void>, onOut: () => Promise<void>) => Promise<Response>;
const { handleAuth } = (await import(AUTH)) as { handleAuth: HandleAuth };

// Production runs without DEV_LOGIN; Previews set it (cloud/wrangler.jsonc), and their demo data signs
// in a second person with `?as=` to try sharing. None of that may be reachable without it. (Called
// directly: the test Worker would read a developer's local cloud/.dev.vars, which turns it on.)
test("without DEV_LOGIN, developer sign-in (as anyone) doesn't exist and touches nothing", async () => {
  const untouchable = new Proxy({}, { get: () => assert.fail("the directory was touched") });
  for (const flag of [undefined, "", "0", "true"]) {
    const env = { DEV_LOGIN: flag, DB: untouchable };
    for (const p of ["/auth/dev", "/auth/dev?as=sam", "/auth/dev?as=owner&next=/"]) {
      const res = await handleAuth(new Request(`https://commonink.app${p}`), env, async () => assert.fail("signed in"), async () => {});
      assert.deepEqual([flag, p, res.status, res.headers.getSetCookie().length], [flag, p, 404, 0]);
    }
  }
});
