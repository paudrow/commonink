// A hosted workspace's settings from the CLI: who's in it and their roles, invite links, its name
// and its log. The server runs these itself (cloud/src/admin.ts), with the same checks as the app's
// Settings; a local vault has no settings. They're not MCP tools: see NOT_FOR_AGENTS.
import { VaultError } from "../paths.ts";
import { UsageError, settingsCommand, str, type WorkspaceSettings } from "./types.ts";

export type Role = "owner" | "editor" | "viewer";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export interface InviteRow {
  /** The stored hash of its token: enough to revoke it, useless for joining. */
  id: string;
  role: "editor" | "viewer";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

export interface LogEntry {
  at: number;
  actor: string | null;
  action: "rename" | "role" | "remove" | "leave" | "invite" | "revoke-invite" | "settings";
  target: string | null;
  detail: string | null;
}

const NOT_FOR_AGENTS = { none: "a workspace's settings: an agent's MCP access is to one workspace's notes, and changing who's in it is for its people" };
const ROLES = ["owner", "editor", "viewer"] as const;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const members = async (s: WorkspaceSettings) => (await s.call("GET /members")) as Member[];

/** A member, by their name, email or ID (any case). */
async function member(s: WorkspaceSettings, who: string): Promise<Member> {
  const all = await members(s);
  const t = who.trim().toLowerCase();
  const found = all.filter((m) => m.id === who || m.email.toLowerCase() === t || m.name.toLowerCase() === t);
  if (found.length === 1) return found[0];
  if (found.length) throw new UsageError(`More than one person in ${s.name} is called ${who}: use their email`);
  throw new VaultError(`No one called ${who} is in ${s.name}. Its members: ${all.map((m) => m.name).join(", ")}`, "not_found");
}

/** An invite link, by its ID or the start of it (as `commonink invites` shows it). */
async function invite(s: WorkspaceSettings, id: string): Promise<InviteRow> {
  const found = ((await s.call("GET /invites")) as InviteRow[]).filter((i) => i.id.startsWith(id.trim()));
  if (found.length === 1) return found[0];
  if (found.length) throw new UsageError(`More than one invite link starts with ${id}: give more of its ID`);
  throw new VaultError(`No invite link ${id} in ${s.name}: see commonink invites`, "not_found");
}

const inviteState = (i: InviteRow, now: number) => (i.usedAt ? `used by ${i.usedBy ?? "someone"} on ${day(i.usedAt)}` : i.expiresAt < now ? "expired" : `active until ${day(i.expiresAt)}`);

export const settings = [
  settingsCommand({
    cli: "members",
    mcp: NOT_FOR_AGENTS,
    route: "GET /members",
    title: "Members",
    summary: "Who's in the workspace, and their roles",
    examples: ["commonink members --workspace Team", "commonink members --json"],
    readOnly: true,
    args: {},
    run: async ({ settings: s }) => {
      const all = await members(s);
      return { text: all.map((m) => `- ${m.name} <${m.email}> (${m.role})`).join("\n"), data: all };
    },
  }),
  settingsCommand({
    cli: "member role",
    mcp: NOT_FOR_AGENTS,
    route: "POST /members/role",
    title: "Change a member's role",
    summary: "Make someone an owner, editor or viewer (owners only)",
    description: "Change someone's role in the workspace. Their agents connected with the old role, so they're disconnected and connect again. A workspace keeps at least one owner.",
    examples: ["commonink member role sam@example.com viewer --workspace Team"],
    args: {
      person: str({ required: true, pos: 0, describe: "Their name, email or ID (see commonink members)" }),
      role: str({ required: true, pos: 1, enum: ROLES, describe: "owner, editor or viewer" }),
    },
    run: async ({ settings: s }, a) => {
      const m = await member(s, a.person);
      await s.call("POST /members/role", { user: m.id, role: a.role });
      return { text: `${m.name} is ${a.role === "owner" ? "an owner" : a.role === "editor" ? "an editor" : "a viewer"} of ${s.name} now.`, data: { ...m, role: a.role } };
    },
  }),
  settingsCommand({
    cli: "member remove",
    mcp: NOT_FOR_AGENTS,
    route: "POST /members/remove",
    title: "Remove a member",
    summary: "Take someone out of the workspace (owners only)",
    description: "Take someone out of the workspace: they, and their agents, lose access to it at once. To leave yourself, use commonink leave.",
    examples: ["commonink member remove Sam --workspace Team"],
    destructive: true,
    args: { person: str({ required: true, pos: 0, describe: "Their name, email or ID (see commonink members)" }) },
    run: async ({ settings: s }, a) => {
      const m = await member(s, a.person);
      await s.call("POST /members/remove", { user: m.id });
      return { text: `Removed ${m.name} from ${s.name}.`, data: { removed: m } };
    },
  }),
  settingsCommand({
    cli: "leave",
    mcp: NOT_FOR_AGENTS,
    route: "POST /leave",
    title: "Leave the workspace",
    summary: "Leave a team workspace; its notes stay with its other members",
    examples: ["commonink leave --workspace Team"],
    destructive: true,
    args: {},
    run: async ({ settings: s }) => {
      await s.call("POST /leave");
      return { text: `You left ${s.name}.`, data: { left: s.name } };
    },
  }),
  settingsCommand({
    cli: "invite",
    mcp: NOT_FOR_AGENTS,
    route: "POST /invites",
    title: "Invite someone",
    summary: "A link that lets one person join the team workspace (owners only)",
    description: "Make an invite link to the team workspace. Whoever opens it first, signed in, joins as an editor (or --role viewer). Send it yourself; `commonink invites revoke` takes it back.",
    examples: ["commonink invite --workspace Team", "commonink invite --role viewer --json"],
    args: { role: str({ enum: ["editor", "viewer"], describe: "What they may do once they join: editor (default) or viewer" }) },
    run: async ({ settings: s }, a) => {
      const { url } = (await s.call("POST /invites", { role: a.role ?? "editor" })) as { url: string };
      return { text: `An invite to ${s.name}, as ${a.role === "viewer" ? "a viewer" : "an editor"}, for one person: ${url}`, data: { url, role: a.role ?? "editor" } };
    },
  }),
  settingsCommand({
    cli: "invites",
    mcp: NOT_FOR_AGENTS,
    route: "GET /invites",
    title: "Invite links",
    summary: "The workspace's invite links: who made them, and which are still open (owners only)",
    examples: ["commonink invites --workspace Team"],
    readOnly: true,
    args: {},
    run: async ({ settings: s }) => {
      const all = (await s.call("GET /invites")) as InviteRow[];
      const now = Date.now();
      const text = all.length ? all.map((i) => `- ${i.id.slice(0, 12)} ${i.role}, made by ${i.createdBy ?? "someone"} on ${day(i.createdAt)}: ${inviteState(i, now)}`).join("\n") : `No invite links for ${s.name}.`;
      return { text, data: all };
    },
  }),
  settingsCommand({
    cli: "invites revoke",
    mcp: NOT_FOR_AGENTS,
    route: "POST /invites/revoke",
    title: "Revoke an invite link",
    summary: "Take back an invite link no one has used yet (owners only)",
    examples: ["commonink invites revoke 3f9a2c41 --workspace Team"],
    args: { id: str({ required: true, pos: 0, label: "invite-id", describe: "Its ID, or the start of it (see commonink invites)" }) },
    run: async ({ settings: s }, a) => {
      const i = await invite(s, a.id);
      await s.call("POST /invites/revoke", { id: i.id });
      return { text: `Revoked the ${i.role} invite link ${i.id.slice(0, 12)}.`, data: { revoked: i.id } };
    },
  }),
  settingsCommand({
    cli: "workspace rename",
    mcp: NOT_FOR_AGENTS,
    route: "POST /workspace/rename",
    title: "Rename the workspace",
    summary: "Give the workspace a new name, for everyone in it (owners only)",
    examples: ['commonink workspace rename "Launch team" --workspace Team'],
    args: { name: str({ required: true, pos: "rest", describe: "The new name (up to 80 characters)" }) },
    run: async ({ settings: s }, a) => {
      const { name } = (await s.call("POST /workspace/rename", { name: a.name })) as { name: string };
      return { text: `Renamed ${s.name} to ${name}.`, data: { from: s.name, name } };
    },
  }),
  settingsCommand({
    cli: "workspace log",
    mcp: NOT_FOR_AGENTS,
    route: "GET /workspace/log",
    title: "Workspace log",
    summary: "Who joined, left, changed roles or renamed the workspace, newest first (owners only)",
    examples: ["commonink workspace log --workspace Team"],
    readOnly: true,
    args: {},
    run: async ({ settings: s }) => {
      const log = (await s.call("GET /workspace/log")) as LogEntry[];
      const line = (e: LogEntry) => `- ${new Date(e.at).toISOString().slice(0, 16).replace("T", " ")} ${e.actor ?? "someone"}: ${e.action}${e.target ? ` ${e.target}` : ""}${e.detail ? ` (${e.detail})` : ""}`;
      return { text: log.length ? log.map(line).join("\n") : `Nothing in ${s.name}'s log yet.`, data: log };
    },
  }),
];
