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
   * Seals connected accounts' tokens (Google Calendar) at rest: 32 random bytes, base64
   * (`openssl rand -base64 32 | wrangler secret put INTEGRATIONS_KEY`). Unset, Google Calendar is off.
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
  /** "1" in local development and pull request Previews only: signs people in without Google. */
  DEV_LOGIN?: string;
}
