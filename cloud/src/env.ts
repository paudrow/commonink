import type { Workspace } from "./workspace.ts";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Seals connected accounts' tokens (Google, GitHub) at rest: 32 random bytes, base64
   * (`openssl rand -base64 32 | wrangler secret put INTEGRATIONS_KEY`). Unset, neither can be connected.
   */
  INTEGRATIONS_KEY?: string;
  /**
   * What someone new must enter to make an account (a secret: `wrangler secret put SIGNUP_CODE`). Unset,
   * no one new can join except through an invite link. Developer sign-in skips it.
   */
  SIGNUP_CODE?: string;
  /**
   * Optional, for GitHub issue and PR cards: a token sent only to api.github.com, which raises
   * GitHub's limit past 60 requests an hour and reaches the private repos it can read
   * (`wrangler secret put GITHUB_TOKEN`). Anyone signed in can see what it reads, so on a shared
   * deployment give it no private repos. Unset, cards read public repos only.
   */
  GITHUB_TOKEN?: string;
  /**
   * Optional, for each person connecting their own GitHub account (cloud/src/github.ts), so cards
   * show the private repos they can see: a GitHub OAuth app's client ID and secret
   * (`wrangler secret put GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), whose callback URL is
   * https://<host>/auth/github/callback. It needs INTEGRATIONS_KEY too, which seals their tokens.
   * Unset, Settings says GitHub isn't set up, and cards read with GITHUB_TOKEN alone.
   */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Tests only: a stand-in for both github.com and api.github.com. */
  GITHUB_BASE?: string;
  /**
   * "1" lets anyone with a Google account make one, no code needed (a var: `wrangler.jsonc` or the
   * dashboard). They still confirm on a page that names the Terms and Privacy Policy first.
   */
  OPEN_SIGNUP?: string;
  /**
   * Billing (cloud/src/billing.ts) is on only when all four are set; otherwise everything is free.
   * Secrets: `wrangler secret put STRIPE_SECRET_KEY` (a restricted key works: Customers, Checkout
   * Sessions, Customer Portal and Subscriptions) and `STRIPE_WEBHOOK_SECRET` (the endpoint's signing
   * secret, for https://<host>/api/stripe/webhook). Vars: the Price IDs of the $8 monthly and $60 yearly prices.
   */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTH?: string;
  STRIPE_PRICE_YEAR?: string;
  /** Days of free trial for someone new once billing is on (default 14). */
  TRIAL_DAYS?: string;
  /** Tests only: where Stripe's API is (default https://api.stripe.com). */
  STRIPE_API?: string;
  /** "1" in local development and pull request Previews only: signs people in without Google. */
  DEV_LOGIN?: string;
}
