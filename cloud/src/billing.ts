// Paying for the hosted app, with Stripe: Checkout to subscribe, the Customer Portal to change a
// card, see invoices or cancel, and a webhook that tells us what changed. No card forms of ours.
//
// One plan: $8 a month, or $60 a year ($5 a month). Each person pays for themselves, and a
// workspace is paid for by its owner: everyone in it can edit while the owner's plan is good. Someone
// new gets a 14-day trial, no card needed. When a plan lapses (a trial ended, a subscription
// cancelled, or a payment failed for a week), the owner's workspaces turn read-only, never locked:
// everyone can still read, search and export every note.
//
// Billing is off, and everything stays free, until STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and both
// prices are set. The local app, the CLI and MCP against your own vault never need any of this.
import { json } from "../../src/core/api.ts";
import type { User } from "./directory.ts";
import type { Env } from "./env.ts";

export const PLANS = {
  month: { label: "$8 a month", price: 8 },
  year: { label: "$60 a year ($5 a month)", price: 60 },
} as const;
export type Interval = keyof typeof PLANS;

const DAY = 24 * 60 * 60 * 1000;
/** How long after a failed payment a workspace stays writable, while Stripe retries the card. */
export const GRACE_DAYS = 7;

/** Whether this deployment charges: a Stripe key, a webhook secret and both prices. */
export const billingOn = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_MONTH && env.STRIPE_PRICE_YEAR);

const trialDays = (env: Env) => {
  const n = Number(env.TRIAL_DAYS ?? 14);
  return Number.isFinite(n) && n >= 0 ? n : 14;
};

export interface Plan {
  /**
   * "free": billing is off here. "trial": the free trial, until `trialEnds`. "active": paying.
   * "past_due": a payment failed; still writable until `graceEnds`. "lapsed": read-only.
   */
  status: "free" | "trial" | "active" | "past_due" | "lapsed";
  canWrite: boolean;
  trialEnds?: number;
  interval?: Interval;
  /** When the paid period ends: it renews then, unless `cancelling`. */
  periodEnd?: number;
  cancelling?: boolean;
  graceEnds?: number;
  /** Whether there's a Stripe customer, so the Customer Portal has something to show. */
  customer?: boolean;
}

interface Row {
  trial_ends: number;
  customer_id: string | null;
  status: string | null;
  interval: Interval | null;
  period_end: number | null;
  cancel_at_period_end: number;
}

/** `userId`'s billing row, made (starting their trial) the first time it's asked for. */
async function rowOf(env: Env, userId: string, now = Date.now()): Promise<Row> {
  // Every workspace request asks, so it's one read, and a write only the first time.
  const read = () => env.DB.prepare("SELECT trial_ends, customer_id, status, interval, period_end, cancel_at_period_end FROM billing WHERE user_id = ?").bind(userId).first<Row>();
  const row = await read();
  if (row) return row;
  await env.DB.prepare("INSERT OR IGNORE INTO billing(user_id, trial_ends, updated_at) VALUES (?, ?, ?)").bind(userId, now + trialDays(env) * DAY, now).run();
  return (await read())!;
}

/** Where `userId` stands: what they pay for, and whether the workspaces they own can be changed. */
export async function planOf(env: Env, userId: string, now = Date.now()): Promise<Plan> {
  if (!billingOn(env)) return { status: "free", canWrite: true };
  const r = await rowOf(env, userId, now);
  const paid = { interval: r.interval ?? undefined, periodEnd: r.period_end ?? undefined, cancelling: !!r.cancel_at_period_end, customer: !!r.customer_id };
  if (r.status === "active" || r.status === "trialing") return { status: "active", canWrite: true, ...paid };
  if ((r.status === "past_due" || r.status === "unpaid") && r.period_end) {
    const graceEnds = r.period_end + GRACE_DAYS * DAY;
    return { status: graceEnds > now ? "past_due" : "lapsed", canWrite: graceEnds > now, graceEnds, ...paid };
  }
  if (r.trial_ends > now) return { status: "trial", canWrite: true, trialEnds: r.trial_ends, customer: !!r.customer_id };
  return { status: "lapsed", canWrite: false, trialEnds: r.trial_ends, ...paid };
}

/** Whether workspace `wsId` can be changed: its owner's plan is good (or billing is off). */
export async function workspaceWritable(env: Env, wsId: string): Promise<boolean> {
  if (!billingOn(env)) return true;
  const owner = await env.DB.prepare("SELECT owner_id FROM workspaces WHERE id = ?").bind(wsId).first<{ owner_id: string }>();
  return !owner || (await planOf(env, owner.owner_id)).canWrite;
}

export const READ_ONLY = "This workspace is read-only: its owner's Common Ink plan has ended. Everyone can still read and export its notes; the owner can subscribe in Settings, under Plan.";

// ------------------------------------------------------------------ Stripe's API

/** A call to Stripe's API, form-encoded as it wants. Throws Stripe's own message on an error. */
async function stripe<T>(env: Env, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}): Promise<T> {
  const base = env.STRIPE_API ?? "https://api.stripe.com";
  const form = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/v1${path}${method === "GET" && form ? `?${form}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? form : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe answered ${res.status}`);
  return data;
}

/** `user`'s Stripe customer, made the first time they subscribe. */
async function customerOf(env: Env, user: User): Promise<string> {
  const r = await rowOf(env, user.id);
  if (r.customer_id) return r.customer_id;
  const c = await stripe<{ id: string }>(env, "POST", "/customers", { email: user.email, name: user.name, "metadata[user]": user.id });
  await env.DB.prepare("UPDATE billing SET customer_id = ?, updated_at = ? WHERE user_id = ? AND customer_id IS NULL").bind(c.id, Date.now(), user.id).run();
  return (await rowOf(env, user.id)).customer_id ?? c.id;
}

/** A Stripe Checkout page for `interval`'s plan; Stripe sends them back to the app after. */
export async function checkout(env: Env, url: URL, user: User, interval: Interval): Promise<string> {
  const price = interval === "year" ? env.STRIPE_PRICE_YEAR! : env.STRIPE_PRICE_MONTH!;
  const s = await stripe<{ url: string }>(env, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer: await customerOf(env, user),
    client_reference_id: user.id,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][user]": user.id,
    allow_promotion_codes: "true",
    success_url: `${url.origin}/?billing=done`,
    cancel_url: `${url.origin}/?billing=cancelled`,
  });
  return s.url;
}

/** Stripe's Customer Portal for `user`: card, invoices, switching plans, cancelling. */
export async function portal(env: Env, url: URL, user: User): Promise<string | null> {
  const r = await rowOf(env, user.id);
  if (!r.customer_id) return null;
  const s = await stripe<{ url: string }>(env, "POST", "/billing_portal/sessions", { customer: r.customer_id, return_url: `${url.origin}/?billing=portal` });
  return s.url;
}

/**
 * Before an account is deleted (account.ts): cancel its subscription at once, so a deleted account is
 * never charged again, and forget its billing row. Throws CancelFailed if Stripe won't, so the account
 * isn't deleted while still paying.
 */
export class CancelFailed extends Error {}

export async function endBilling(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT subscription_id, status FROM billing WHERE user_id = ?").bind(userId).first<{ subscription_id: string | null; status: string | null }>();
  if (!row) return;
  if (row.subscription_id && row.status !== "canceled" && env.STRIPE_SECRET_KEY) {
    await stripe(env, "DELETE", `/subscriptions/${row.subscription_id}`).catch((e: Error) => {
      // Already gone at Stripe is fine.
      if (!/No such subscription/i.test(e.message)) throw new CancelFailed(e.message);
    });
  }
  await env.DB.prepare("DELETE FROM billing WHERE user_id = ?").bind(userId).run();
}

// ------------------------------------------------------------------ the webhook

/** Stripe's signature on a webhook (`t=…,v1=…`): HMAC-SHA256 of "t.body", within five minutes. */
export async function verifySignature(secret: string, header: string, body: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const want = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === want.length && timingSafe(s, want));
}

const timingSafe = (a: string, b: string) => {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

interface Subscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number; price?: { recurring?: { interval?: string } } }> };
  metadata?: { user?: string };
}

/** Record what a subscription is now, for the person it's theirs (by customer, else by its metadata). */
async function saveSubscription(env: Env, sub: Subscription) {
  const item = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval === "year" ? "year" : "month";
  // Newer API versions keep the period on the item.
  const periodEnd = (sub.current_period_end ?? item?.current_period_end ?? 0) * 1000 || null;
  const now = Date.now();
  if (sub.metadata?.user) {
    await env.DB.prepare("INSERT OR IGNORE INTO billing(user_id, trial_ends, updated_at) VALUES (?, ?, ?)").bind(sub.metadata.user, now, now).run();
    await env.DB.prepare("UPDATE billing SET customer_id = ? WHERE user_id = ? AND customer_id IS NULL").bind(sub.customer, sub.metadata.user).run();
  }
  await env.DB.prepare(
    "UPDATE billing SET subscription_id = ?, status = ?, interval = ?, period_end = ?, cancel_at_period_end = ?, updated_at = ? WHERE customer_id = ?",
  )
    .bind(sub.id, sub.status, interval, periodEnd, sub.cancel_at_period_end ? 1 : 0, now, sub.customer)
    .run();
}

/** POST /api/stripe/webhook: what Stripe says changed. Unsigned or stale events are refused. */
export async function webhook(req: Request, env: Env): Promise<Response> {
  if (!billingOn(env)) return json({ error: "Billing isn't on here" }, 404);
  const body = await req.text();
  if (!(await verifySignature(env.STRIPE_WEBHOOK_SECRET!, req.headers.get("Stripe-Signature") ?? "", body))) return json({ error: "Bad signature" }, 400);
  const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      // Ties the customer to the person, in case the subscription's events arrive first.
      const user = obj.client_reference_id as string | undefined;
      const customer = obj.customer as string | undefined;
      if (user && customer) {
        const now = Date.now();
        await env.DB.prepare("INSERT OR IGNORE INTO billing(user_id, trial_ends, updated_at) VALUES (?, ?, ?)").bind(user, now, now).run();
        await env.DB.prepare("UPDATE billing SET customer_id = ?, updated_at = ? WHERE user_id = ? AND customer_id IS NULL").bind(customer, now, user).run();
      }
      if (typeof obj.subscription === "string") await saveSubscription(env, await stripe<Subscription>(env, "GET", `/subscriptions/${obj.subscription}`));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await saveSubscription(env, obj as unknown as Subscription);
      break;
    // invoice.payment_failed needs nothing more: the subscription's own update says past_due.
  }
  return json({ received: true });
}

/** The account routes: where your plan stands, and the way to Checkout or the Portal. */
export const BILLING_ROUTES = {
  "GET /api/billing": async (env: Env, _req: Request, _url: URL, user: User) =>
    json({ on: billingOn(env), plans: PLANS, graceDays: GRACE_DAYS, plan: await planOf(env, user.id) }),
  "POST /api/billing/checkout": async (env: Env, req: Request, url: URL, user: User) => {
    if (!billingOn(env)) return json({ error: "Billing isn't on here: everything is free" }, 404);
    const { interval } = ((await req.json().catch(() => ({}))) ?? {}) as { interval?: unknown };
    if (interval !== "month" && interval !== "year") return json({ error: '"interval" must be "month" or "year"' }, 400);
    const plan = await planOf(env, user.id);
    if (plan.status === "active" || plan.status === "past_due") return json({ error: "You already subscribe: manage it from Settings, under Plan", portal: true }, 409);
    try {
      return json({ url: await checkout(env, url, user, interval) });
    } catch (e) {
      return json({ error: `Couldn't reach Stripe: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }
  },
  "POST /api/billing/portal": async (env: Env, _req: Request, url: URL, user: User) => {
    if (!billingOn(env)) return json({ error: "Billing isn't on here: everything is free" }, 404);
    try {
      const to = await portal(env, url, user);
      return to ? json({ url: to }) : json({ error: "You haven't subscribed yet" }, 409);
    } catch (e) {
      return json({ error: `Couldn't reach Stripe: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }
  },
};

/**
 * The role someone acts with in a workspace: their own, or viewer while the workspace is read-only.
 * Everything that writes (the app, MCP, the CLI, shares) asks this, so a lapse is read-only everywhere.
 */
export async function actingRole<R extends string>(env: Env, wsId: string, role: R): Promise<R | "viewer"> {
  return role === "viewer" || (await workspaceWritable(env, wsId)) ? role : "viewer";
}
