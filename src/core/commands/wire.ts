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
// Both ways go a slice at a time, never through one string or array the size of the whole file: a
// Worker has 128 MB, and a file's bytes, its base64 and the JSON around it are all in memory at once.
const SLICE = 3 * 0x2000; // bytes; a multiple of 3, so each slice's base64 has no padding in the middle
const toB64 = (b: Uint8Array) => {
  const parts: string[] = [];
  for (let i = 0; i < b.length; i += SLICE) parts.push(btoa(String.fromCharCode(...b.subarray(i, i + SLICE))));
  return parts.join("");
};
const fromB64 = (s: string) => {
  const end = s.endsWith("==") ? s.length - 2 : s.endsWith("=") ? s.length - 1 : s.length;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let n = 0;
  for (let i = 0; i < s.length; i += (SLICE / 3) * 4) {
    const bin = atob(s.slice(i, i + (SLICE / 3) * 4));
    for (let j = 0; j < bin.length; j++) out[n++] = bin.charCodeAt(j);
  }
  return out;
};

/**
 * The most a hosted workspace reads of a command (`POST /mcp/cli/run`): its JSON, files' base64 and all.
 * Decoding takes a few times the body's size, so this keeps a Worker well inside its 128 MB. Bigger
 * files go up through the app, which takes them as they are (up to 50 MB).
 */
export const MAX_RUN_BODY = 20 * 1024 * 1024;

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
