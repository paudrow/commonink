// Billing with Stripe (cloud/src/billing.ts), against a stand-in for Stripe's API: off until it's
// configured; a trial for someone new; Checkout and the Customer Portal; signed webhooks; and a
// workspace whose owner's plan has ended turns read-only, never locked.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startCloud, team, type Cloud } from "./cloud.ts";

const WEBHOOK_SECRET = "whsec_test";
const DAY = 86400;

/** Stripe's API, as much of it as billing uses. Records what it was asked. */
const calls: Array<{ method: string; path: string; form: URLSearchParams }> = [];
const subscriptions = new Map<string, object>();
let stripe: http.Server;
let stripeUrl = "";

const billingVars = (extra: Record<string, string> = {}) => ({
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_MONTH: "price_month",
  STRIPE_PRICE_YEAR: "price_year",
  STRIPE_API: stripeUrl,
  ...extra,
});

let cloud: Cloud;
before(async () => {
  stripe = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://stripe");
      const form = new URLSearchParams(req.method === "GET" ? url.search : body);
      calls.push({ method: req.method!, path: url.pathname, form });
      const send = (status: number, data: object) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(data)));
      if (req.headers.authorization !== "Bearer sk_test_x") return send(401, { error: { message: "Invalid API key" } });
      if (url.pathname === "/v1/customers") return send(200, { id: `cus_${form.get("metadata[user]")}` });
      if (url.pathname === "/v1/checkout/sessions") return send(200, { url: `https://checkout.stripe.test/${form.get("customer")}` });
      if (url.pathname === "/v1/billing_portal/sessions") return send(200, { url: `https://billing.stripe.test/${form.get("customer")}` });
      const sub = url.pathname.match(/^\/v1\/subscriptions\/(.+)$/)?.[1];
      if (sub && subscriptions.has(sub)) return send(200, subscriptions.get(sub)!);
      send(404, { error: { message: "No such thing" } });
    });
  });
  await new Promise<void>((r) => stripe.listen(0, "127.0.0.1", r));
  stripeUrl = `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`;
  // A trial of no days: everyone's trial has already ended, so plans start lapsed.
  cloud = await startCloud(billingVars({ TRIAL_DAYS: "0" }));
});
after(() => (cloud.close(), stripe.close()));

/** A webhook event as Stripe signs it: HMAC-SHA256 of "t.body" with the endpoint's secret. */
function sendEvent(c: Cloud, type: string, object: object, { secret = WEBHOOK_SECRET, at = Date.now() } = {}) {
  const body = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type, data: { object } });
  const t = Math.floor(at / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return c.server.fetch(new URL("/api/stripe/webhook", c.origin), { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, body });
}

const subscription = (userId: string, o: { status: string; interval?: "month" | "year"; periodEnd?: number; cancel?: boolean }) => ({
  id: `sub_${userId}`,
  object: "subscription",
  customer: `cus_${userId}`,
  status: o.status,
  cancel_at_period_end: !!o.cancel,
  metadata: { user: userId },
  // Newer API versions keep the period on the item, as here.
  items: { data: [{ current_period_end: o.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * DAY, price: { recurring: { interval: o.interval ?? "month" } } }] },
});

const plan = async (cookie: string) => (await cloud.call(cookie, "GET", "/api/billing")).plan;
const write = (cookie: string, base: string, path: string) => cloud.request(cookie, "POST", `${base}/note`, { path, content: `# ${path}\n` });

test("without Stripe configured, billing is off and everything stays free", async () => {
  const free = await startCloud();
  try {
    const me = await free.signIn("free");
    const billing = await free.call(me, "GET", "/api/billing");
    assert.equal(billing.on, false);
    assert.deepEqual(billing.plan, { status: "free", canWrite: true });
    assert.equal((await free.request(me, "POST", "/api/billing/checkout", { interval: "month" })).status, 404);
    // Nor is the webhook an open door.
    assert.equal((await sendEvent(free, "customer.subscription.updated", {})).status, 404);
  } finally {
    free.close();
  }
});

test("someone new gets a trial and can write; the prices are $8 a month or $60 a year", async () => {
  const trial = await startCloud(billingVars());
  try {
    const me = await trial.signIn("newcomer");
    const billing = await trial.call(me, "GET", "/api/billing");
    assert.equal(billing.on, true);
    assert.deepEqual(billing.plans, { month: { label: "$8 a month", price: 8 }, year: { label: "$60 a year ($5 a month)", price: 60 } });
    assert.equal(billing.plan.status, "trial");
    assert.equal(billing.plan.canWrite, true);
    const days = (billing.plan.trialEnds - Date.now()) / 86400_000;
    assert.ok(days > 13.9 && days <= 14, `a 14-day trial (${days})`);
    // Asking again doesn't restart it.
    assert.equal((await trial.call(me, "GET", "/api/billing")).plan.trialEnds, billing.plan.trialEnds);
    const { workspaces } = await trial.call(me, "GET", "/api/me");
    assert.equal((await trial.request(me, "POST", `/api/w/${workspaces[0].id}/note`, { path: "a.md", content: "# A\n" })).status, 200);
  } finally {
    trial.close();
  }
});

test("a lapsed owner's workspace is read-only for everyone in it, and readable and exportable", async () => {
  const t = await team(cloud);
  assert.equal((await plan(t.owner)).status, "lapsed");
  for (const who of [t.owner, t.editor]) {
    const res = await write(who, t.base, "lapsed.md");
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.readOnly, true);
    assert.match(body.error, /read-only: its owner's Common Ink plan has ended/);
  }
  assert.equal((await cloud.request(t.viewer, "GET", `${t.base}/notes`)).status, 200);
  // Export isn't refused: it reaches the workspace, which (new and empty) has nothing to export.
  const exported = await cloud.request(t.editor, "GET", `${t.base}/export`);
  assert.deepEqual([exported.status, (await exported.json()).error], [400, "Nothing to export"]);
  // The owner can still manage the workspace's people.
  const invited = await cloud.request(t.owner, "POST", `${t.base}/invites`, { role: "viewer" });
  assert.equal(invited.status, 200, await invited.clone().text());
  // A lapse is the owner's: the editor's own plan doesn't matter, and vice versa.
});

test("Checkout makes a Stripe customer once and sends them to the plan they picked", async () => {
  const me = await cloud.signIn("buyer");
  const { user } = await cloud.call(me, "GET", "/api/me");
  assert.equal((await cloud.request(me, "POST", "/api/billing/checkout", { interval: "week" })).status, 400);
  calls.length = 0;
  const month = await cloud.call(me, "POST", "/api/billing/checkout", { interval: "month" });
  assert.equal(month.url, `https://checkout.stripe.test/cus_${user.id}`);
  const year = await cloud.call(me, "POST", "/api/billing/checkout", { interval: "year" });
  assert.equal(year.url, `https://checkout.stripe.test/cus_${user.id}`);
  assert.deepEqual(calls.map((c) => c.path), ["/v1/customers", "/v1/checkout/sessions", "/v1/checkout/sessions"], "one customer, reused");
  const [, m, y] = calls;
  assert.equal(m.form.get("mode"), "subscription");
  assert.equal(m.form.get("line_items[0][price]"), "price_month");
  assert.equal(y.form.get("line_items[0][price]"), "price_year");
  assert.equal(m.form.get("client_reference_id"), user.id);
  assert.equal(m.form.get("success_url"), `${cloud.origin}/?billing=done`);
  // Only our own pages can start one.
  const res = await cloud.request(me, "POST", "/api/billing/checkout", { interval: "month" }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("a subscription from Stripe's webhook makes the workspace writable; the Portal manages it", async () => {
  const t = await team(cloud);
  const { user } = await cloud.call(t.owner, "GET", "/api/me");
  assert.equal((await cloud.request(t.owner, "POST", "/api/billing/portal", {})).status, 409, "no customer yet");
  await cloud.call(t.owner, "POST", "/api/billing/checkout", { interval: "year" });

  subscriptions.set(`sub_${user.id}`, subscription(user.id, { status: "active", interval: "year" }));
  const done = await sendEvent(cloud, "checkout.session.completed", { client_reference_id: user.id, customer: `cus_${user.id}`, subscription: `sub_${user.id}` });
  assert.equal(done.status, 200);
  const p = await plan(t.owner);
  assert.deepEqual([p.status, p.canWrite, p.interval, p.cancelling, p.customer], ["active", true, "year", false, true]);
  assert.equal((await write(t.editor, t.base, "paid.md")).status, 200, "the owner pays, so the team can edit");
  // Someone who isn't paying still can't write in their own workspace.
  const { workspaces } = await cloud.call(t.editor, "GET", "/api/me");
  const own = workspaces.find((w: { kind: string }) => w.kind === "personal");
  assert.equal((await write(t.editor, `/api/w/${own.id}`, "mine.md")).status, 402);

  assert.equal((await cloud.call(t.owner, "POST", "/api/billing/portal", {})).url, `https://billing.stripe.test/cus_${user.id}`);
  assert.equal((await cloud.request(t.owner, "POST", "/api/billing/checkout", { interval: "month" })).status, 409, "already subscribed");

  // Cancelling keeps it until the period's end, then it's read-only.
  await sendEvent(cloud, "customer.subscription.updated", subscription(user.id, { status: "active", interval: "year", cancel: true }));
  assert.equal((await plan(t.owner)).cancelling, true);
  await sendEvent(cloud, "customer.subscription.deleted", subscription(user.id, { status: "canceled", interval: "year" }));
  assert.deepEqual([(await plan(t.owner)).status, (await write(t.owner, t.base, "after.md")).status], ["lapsed", 402]);
});

test("a failed payment leaves a week's grace before the workspace turns read-only", async () => {
  const t = await team(cloud);
  const { user } = await cloud.call(t.owner, "GET", "/api/me");
  await cloud.call(t.owner, "POST", "/api/billing/checkout", { interval: "month" });
  const now = Math.floor(Date.now() / 1000);
  await sendEvent(cloud, "customer.subscription.updated", subscription(user.id, { status: "past_due", periodEnd: now - 2 * DAY }));
  const grace = await plan(t.owner);
  assert.deepEqual([grace.status, grace.canWrite], ["past_due", true]);
  assert.ok(Math.abs(grace.graceEnds - (now + 5 * DAY) * 1000) < 5000, "grace ends a week after the period");
  assert.equal((await write(t.owner, t.base, "grace.md")).status, 200);
  await sendEvent(cloud, "customer.subscription.updated", subscription(user.id, { status: "past_due", periodEnd: now - 8 * DAY }));
  assert.deepEqual([(await plan(t.owner)).status, (await write(t.owner, t.base, "late.md")).status], ["lapsed", 402]);
  // Paying again puts it right.
  await sendEvent(cloud, "customer.subscription.updated", subscription(user.id, { status: "active" }));
  assert.equal((await write(t.owner, t.base, "paid-again.md")).status, 200);
});

test("the webhook refuses events that aren't signed with the secret, or are stale", async () => {
  const me = await cloud.signIn("forger");
  const { user } = await cloud.call(me, "GET", "/api/me");
  await cloud.call(me, "POST", "/api/billing/checkout", { interval: "month" });
  const forged = subscription(user.id, { status: "active" });
  assert.equal((await sendEvent(cloud, "customer.subscription.updated", forged, { secret: "whsec_wrong" })).status, 400);
  assert.equal((await sendEvent(cloud, "customer.subscription.updated", forged, { at: Date.now() - 10 * 60_000 })).status, 400);
  const unsigned = await cloud.server.fetch(new URL("/api/stripe/webhook", cloud.origin), { method: "POST", body: JSON.stringify({ type: "customer.subscription.updated", data: { object: forged } }) });
  assert.equal(unsigned.status, 400);
  assert.equal((await plan(me)).status, "lapsed", "nothing changed");
});
