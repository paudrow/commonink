import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { APP_HTML, startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

const withoutNonces = (html: string) => html.replace(/ nonce="[^"]+"/g, "");

test("signed out, / is the landing page: no script, a way in, the legal pages and link previews", async () => {
  const res = await cloud.request(null, "GET", "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>Notes any agent can work in\.<\/h1>/);
  assert.ok(!html.includes("<script"), "the landing page runs nothing");
  assert.match(html, /href="\/auth\/dev">Get started</); // developer sign-in here; Google in production
  for (const s of ['href="/privacy.html"', 'href="/terms.html"', `content="${cloud.origin}/social.png"`, 'property="og:title"']) assert.ok(html.includes(s), s);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(String(res.headers.get("content-security-policy")), /^default-src 'none'; style-src 'unsafe-inline'/);

  // Arriving with a query (an invite's workspace, say) comes back to it after signing in.
  const withQuery = await (await cloud.request(null, "GET", "/?w=abc")).text();
  assert.ok(withQuery.includes(`href="/auth/dev?next=${encodeURIComponent("/?w=abc")}"`));
});

test("signed in, / is the app as before; deep links are the app signed in or not", async () => {
  const me = await cloud.signIn("landing");
  const app = await cloud.request(me, "GET", "/");
  assert.equal(app.status, 200);
  assert.equal(withoutNonces(await app.text()), APP_HTML);
  // A session that isn't one is signed out.
  assert.match(await (await cloud.request("__Host-ci_session=nope", "GET", "/")).text(), /Notes any agent can work in/);
  for (const p of ["/notes/some-note-abcd2345", "/calendar"]) {
    assert.equal(withoutNonces(await (await cloud.request(null, "GET", p)).text()), APP_HTML, p);
  }
});
