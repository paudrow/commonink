// Types for lib.js, so the repo's tests can import it (the extension itself has no build step).
export const DEFAULT_SERVER: string;
export const MAX_HTML: number;
export function serverOrigin(input: unknown): string | null;
export function hostPattern(origin: string): string;
export function localDate(d?: Date): string;
export interface CaptureInput {
  title?: string;
  url?: string;
  html?: string;
  text?: string;
  folder?: string;
}
export interface CaptureBody {
  today: string;
  title: string;
  url: string;
  html?: string;
  text?: string;
  folder?: string;
}
export function captureBody(input: CaptureInput, now?: Date): CaptureBody;
export function foldersOf(notes: { path: string }[]): string[];
export class SignedOut extends Error {
  signedOut: true;
}
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export function api(server: string, path: string, init?: RequestInit, fetchFn?: Fetch): Promise<any>;
export function account(server: string, fetchFn?: Fetch): Promise<{ user: { name: string; email: string }; workspaces: { id: string; name: string; role: string }[] }>;
export function folders(server: string, workspace: string, fetchFn?: Fetch): Promise<string[]>;
export function save(server: string, workspace: string, body: CaptureBody, fetchFn?: Fetch): Promise<{ path: string; title: string; url: string }>;
export function loadSettings(storage?: unknown): Promise<{ server: string; workspace: string }>;
export function pageContent(): { title: string; url: string; html: string };
