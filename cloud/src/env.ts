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
  /** "1" in local development and pull request Previews only: signs people in without Google. */
  DEV_LOGIN?: string;
}
