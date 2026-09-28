import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

const page = async (p: string, headers: Record<string, string> = {}) => {
  const res = await cloud.server.fetch(new URL(p, cloud.origin), { headers });
  return { status: res.status, headers: res.headers, body: await res.text() };
};

test("app pages get a strict CSP whose nonce is on every script, fresh each time", async () => {
  const a = await page("/");
  const nonce = a.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
  assert.equal(
    a.headers.get("content-security-policy"),
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; ` +
      `media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' ws://${new URL(cloud.origin).host} https://public.api.bsky.app; ` +
      `frame-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );
  assert.equal(
    a.body,
    `<!doctype html><title>Common Ink</title><script nonce="${nonce}">document.title += "!"</script><script type="module" src="/assets/app.js" nonce="${nonce}"></script>`,
  );
  assert.equal(a.headers.get("cache-control"), "no-store");
  assert.equal(a.headers.get("etag"), null);

  const b = await page("/notes/some-note-abcd2345", { "if-none-match": "*" });
  assert.equal(b.status, 200, "never a 304 that would pair a cached page with a new nonce");
  assert.notEqual(b.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1], nonce);
});

test("every response carries the common security headers", async () => {
  for (const p of ["/", "/api/me", "/favicon.svg", "/sandbox"]) {
    const { headers } = await page(p);
    assert.deepEqual(
      ["x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"].map((h) => headers.get(h)),
      [
        "nosniff",
        "strict-origin-when-cross-origin",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), browsing-topics=()",
        "same-origin",
      ],
      p,
    );
  }
  assert.equal((await page("/api/me")).headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
});

test("HTML notes run in /sandbox: its own policy, an opaque origin, framed only by the app", async () => {
  const res = await page("/sandbox");
  assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts; frame-ancestors 'self'");
  assert.match(res.body, /document\.write\(e\.data\.quireHtml\)/);
});

test("uploaded files are sandboxed and only the app may frame them", async () => {
  const cookie = await cloud.signIn("files");
  const { workspaces } = await cloud.call(cookie, "GET", "/api/me");
  const res = await cloud.request(cookie, "GET", `/api/w/${workspaces[0].id}/files/assets/margin.svg`);
  assert.equal(
    res.headers.get("content-security-policy"),
    "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; frame-ancestors 'self'",
  );
});
