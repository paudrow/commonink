// A command over HTTP: the CLI sends a command's name and input to a hosted workspace (POST /mcp/cli/run),
// and gets its output back. Bytes (files to upload, a download) travel as base64. No Node imports:
// the Worker reads and writes this too.
import type { Output } from "./types.ts";

/**
 * Where the CLI sends commands for a hosted workspace, with a bearer token from `commonink login`. It's
 * under /mcp, the resource agents sign in to, so one sign-in (and one OAuth resource) covers both.
 */
export const CLI_ROUTE = "/mcp/cli";

export interface RunRequest {
  command: string;
  input: Record<string, unknown>;
  /** A workspace's ID or name; the only one there is if left out. */
  workspace?: string;
  /** An agent writing for the signed-in person: History shows "<agent> for <person>". */
  agent?: string;
}

export type RunResponse = ({ ok: true } & Output) | { ok: false; error: string; code: string };

const B64 = "$bytes";
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A value as JSON can carry it: bytes become `{"$bytes": "<base64>"}`. */
export function toWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return { [B64]: toB64(v) };
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toWire(x)]));
  return v;
}

/** The value back, bytes and all. */
export function fromWire(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromWire);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o[B64] === "string" && Object.keys(o).length === 1) return fromB64(o[B64]);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fromWire(x)]));
  }
  return v;
}
