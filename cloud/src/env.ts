import type { Workspace } from "./workspace.ts";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "1" in local development and pull request Previews only: signs people in without Google. */
  DEV_LOGIN?: string;
}
