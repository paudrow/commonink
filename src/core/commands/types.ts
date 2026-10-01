// What a command is: one operation on a vault, defined once and offered twice, as a `commonink` CLI
// command and as an MCP tool (src/core/tools.ts), locally and in a hosted workspace alike. Each
// argument says how it's spelled in both. No Node imports: hosted workspaces run these too.
import type { Calendar } from "../calendar.ts";
import type { Vault } from "../vault.ts";
import type { MemberRef } from "../contacts.ts";
import type { Exporter } from "../export.ts";
import type { GoogleContactsSync } from "../googleContacts.ts";

export type ArgKind = "string" | "number" | "boolean" | "strings" | "files" | "pairs";

/** A file from the caller's computer: the CLI reads it before the command runs, wherever it runs. */
export interface LocalFile {
  name: string;
  bytes: Uint8Array;
}

export interface ArgSpec<K extends ArgKind = ArgKind> {
  kind: K;
  /** Required, for MCP and the CLI (see `mcpRequired` for MCP only). */
  required?: boolean;
  /** `null` over MCP (and "none" on the CLI) clears the value. */
  nullable?: boolean;
  describe?: string;
  /** Allowed values (a string argument). */
  enum?: readonly string[];
  /** Bounds for a number. */
  min?: number;
  max?: number;
  /** On the CLI, a positional argument: its place after the command's words, or "rest" for all the words left. */
  pos?: number | "rest";
  /** How the CLI shows it in usage: `<change-id>`. Default the name in kebab case. */
  label?: string;
  /** The CLI flag, when it isn't the name in kebab case. */
  flag?: string;
  /** Older CLI flags that still work (`--as`). */
  aliases?: readonly string[];
  /** Flags that set this argument to a value on their own: `--done` → status "done". */
  presets?: Readonly<Record<string, string | boolean>>;
  /** On the CLI, "-" (or leaving a required one out) reads it from stdin. */
  stdin?: boolean;
  /** Required over MCP, but optional on the CLI, which works it out when it's left out (a task's text, from its line). */
  mcpRequired?: boolean;
  /** Only one side has it: "cli" (a CLI convenience) or "mcp". */
  only?: "cli" | "mcp";
  /** A list that may be empty over MCP (a required list otherwise needs one item). */
  allowEmpty?: boolean;
  /** What the CLI says when a required one is left out, if not "<command> needs <label>". */
  missing?: string;
}

type ValueOf<K extends ArgKind> = K extends "string" ? string
  : K extends "number" ? number
  : K extends "boolean" ? boolean
  : K extends "files" ? LocalFile[]
  : K extends "pairs" ? Record<string, string>
  : string[];
export type Args = Record<string, ArgSpec>;
type Value<S> = S extends { kind: infer K extends ArgKind } ? ValueOf<K> : never;
/** What `run` gets: each argument's value, `undefined` unless it's required, `null` if it's nullable. */
export type InputOf<A extends Args> = {
  [P in keyof A]: (A[P] extends { required: true } ? Value<A[P]> : Value<A[P]> | undefined) | (A[P] extends { nullable: true } ? null : never);
};

/** What a command gives back: text for people and MCP, and the same result as data for `--json`. */
export interface Output {
  text: string;
  data: unknown;
  /** A file for the caller to keep (a download): the CLI saves it where --out says. */
  save?: { name: string; bytes: Uint8Array; mime?: string };
}

/** The bytes of files in the vault, for the commands that move whole files in and out. */
export interface VaultBytes {
  read(rel: string): Promise<Uint8Array | null>;
  /** Store a new file's bytes at `rel`, index it, and log `source` as having added it. */
  add(rel: string, bytes: Uint8Array, source: string): Promise<void>;
}

/** Where a command runs: the vault, and who's asking. */
export interface CommandHost {
  vault: Vault;
  /** Whose favorites and own smart folders these are. */
  user: string;
  /** Who writes are attributed to (see agentSource in actor.ts). */
  source: string;
  /** May they change what the whole workspace shares (shared smart folders)? */
  canEditShared: boolean;
  /** The bytes of vault files. Unset where a command can't move files (MCP, which carries text). */
  bytes?: VaultBytes;
  /** The workspace's calendars, for the calendar commands. */
  calendar?: Calendar;
  /** Where the app is, for links written back to a calendar (online). */
  origin?: string;
  /** The workspace's members (online), for who "me" and other people are on tasks. None locally. */
  members?(): Promise<MemberRef[]>;
  /** Notes as Markdown, a web page, Word or a .zip (core/export.ts), for export. */
  exporter?: Exporter;
  /** Online: sharing notes and folders outside the workspace (see Sharing). Unset locally. */
  sharing?: Sharing;
  /** Online, with Google configured: this person's Google Contacts, synced into People/. */
  googleContacts?: GoogleContactsSync;
}

/**
 * Sharing a note or folder with people outside the workspace, or by link. Only hosted workspaces
 * have it: locally there's no one else to share with.
 */
export interface Sharing {
  list(target: { path?: string; folder?: string }): Promise<string>;
  share(o: { path?: string; folder?: string; email?: string; link?: boolean; role: "viewer" | "editor"; expiresInDays?: number }): Promise<string>;
  unshare(id: string): Promise<string>;
}

/**
 * A hosted workspace's own settings: its members, invite links and name. They live in the
 * directory beside its notes, so a local vault has none.
 */
export interface WorkspaceSettings {
  /** The workspace's name. */
  name: string;
  /** One of the settings routes (a command's `route`) with its body, and what it answers. Throws a VaultError when refused. */
  call(route: string, body?: Record<string, unknown>): Promise<unknown>;
}

/** Where a settings command runs: the workspace's settings, and who's asking. */
export interface SettingsHost {
  settings: WorkspaceSettings;
  /** The person's ID. */
  user: string;
}

interface CommandInfo<A extends Args> {
  /** The CLI command's words: "task add". */
  cli: string;
  /** The MCP tool's name, or null with the reason it has none. */
  mcp: string | { none: string };
  /** The API route it's equivalent to: online, only someone whose role allows that route may run it. */
  route: string;
  title: string;
  /** One line, for `commonink help` and the tool list. */
  summary: string;
  /** Everything an agent should know, for MCP and `commonink help <command>`. Default the summary. */
  description?: string;
  examples?: readonly string[];
  /** Reads only: it runs against the vault as it is on disk now (it syncs the index first). */
  readOnly?: boolean;
  /** It takes things away (to Trash): MCP clients may ask before running it. */
  destructive?: boolean;
  /** What the host must have for it: over MCP, it's offered only then. */
  needs?: "calendar" | "exporter" | "sharing" | "googleContacts";
  /** It reaches people outside the workspace (sharing): MCP clients may ask before running it. */
  openWorld?: boolean;
  args: A;
}

/** A command on a vault's notes and files. */
export interface VaultCommand<A extends Args = Args> extends CommandInfo<A> {
  settings?: false;
  run(host: CommandHost, input: InputOf<A>): Output | Promise<Output>;
}

/** A command on a hosted workspace's settings (see WorkspaceSettings). */
export interface SettingsCommand<A extends Args = Args> extends CommandInfo<A> {
  settings: true;
  run(host: SettingsHost, input: InputOf<A>): Output | Promise<Output>;
}

export type Command<A extends Args = Args> = VaultCommand<A> | SettingsCommand<A>;

/** Declare a command; the argument types flow into `run`. */
export const command = <A extends Args>(c: VaultCommand<A>): Command => c as unknown as Command;
/** Declare a command on a hosted workspace's settings. */
export const settingsCommand = <A extends Args>(c: Omit<SettingsCommand<A>, "settings">): Command => ({ ...c, settings: true }) as unknown as Command;

// Argument builders. Their options keep literal types (`required: true`), so `run`'s input is exact.
type Opts<K extends ArgKind> = Omit<ArgSpec<K>, "kind">;
export const str = <const O extends Opts<"string">>(o: O = {} as O) => ({ kind: "string" as const, ...o });
export const num = <const O extends Opts<"number">>(o: O = {} as O) => ({ kind: "number" as const, ...o });
export const bool = <const O extends Omit<Opts<"boolean">, "required" | "nullable">>(o: O = {} as O) => ({ kind: "boolean" as const, ...o });
export const list = <const O extends Omit<Opts<"strings">, "nullable">>(o: O = {} as O) => ({ kind: "strings" as const, ...o });
/** Named values: an object over MCP, `--flag Name=value` (again for each) on the CLI. */
export const pairs = <const O extends Omit<Opts<"pairs">, "nullable" | "pos" | "stdin">>(o: O = {} as O) => ({ kind: "pairs" as const, ...o });
export const localFiles = <const O extends Omit<Opts<"files">, "nullable" | "only">>(o: O = {} as O) => ({ kind: "files" as const, only: "cli" as const, ...o });

/**
 * How a CLI run ends, for scripts and agents to branch on. Stable: new codes may be added, these
 * don't change meaning.
 */
export const EXIT = {
  ok: 0,
  /** Refused or failed, for any reason not below (bad input the vault can't take, say). */
  error: 1,
  /** The command or its arguments are wrong: see `commonink help <command>`. */
  usage: 2,
  /** No such note, task, card, folder or change. */
  not_found: 3,
  /** The note changed since you read it (a stale --base, or a task's text moved): read again and retry. */
  conflict: 4,
  /** Something by that name is already there. */
  exists: 5,
  /** Your role in the workspace doesn't allow it. */
  forbidden: 6,
  /** Not signed in, or the sign-in expired: run `commonink login`. */
  auth: 7,
  /** The server couldn't be reached, or failed. */
  unavailable: 8,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A mistake in how a command was called: exit code 2, with a pointer to its help. */
export class UsageError extends Error {}
