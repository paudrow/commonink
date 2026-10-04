// The MCP tools, made from the command table (src/core/commands) that the CLI uses too, and shared
// by the local stdio server (src/mcp.ts) and hosted workspaces (the remote /mcp endpoint), so an
// agent gets the same tools either way.
import type { GoogleContactsSync } from "./googleContacts.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultError } from "./paths.ts";
import type { Vault } from "./vault.ts";
import type { Calendar } from "./calendar.ts";
import type { MemberRef } from "./contacts.ts";
import type { Exporter } from "./export.ts";
import { agentsText } from "./noteRoles.ts";
import { NOTE_SCHEMA, PERSON_SCHEMA, SETTINGS_NOTE, SETTINGS_SCHEMA, TEMPLATE_SCHEMA } from "./schema.ts";
import { COMMANDS, RENAMED_TOOLS, toolName, type Command, type SaveTarget, type Sharing } from "./commands/index.ts";
import { inputSchema } from "./commands/input.ts";

export interface ToolHost {
  vault: Vault;
  /** Whose favorites and own saved views the tools read and change. */
  user: string;
  /** Who writes are attributed to, given the name the client connected with. */
  source(client: string | undefined): string;
  /**
   * Whether the caller may use an API route (online: their role in the workspace). Tools whose
   * route they may not use aren't offered. Unset locally, where everything is allowed.
   */
  may?(route: string): boolean;
  /** Whether the caller may make or change shared views (online: editors and owners). Default yes. */
  canEditShared?: boolean;
  /** The workspace's members (online), for who "me" and other people are on tasks. None locally. */
  members?(): Promise<MemberRef[]>;
  /** export_note: notes as Markdown, a web page, Word or a .zip (core/export.ts). Without one, the tool isn't offered. */
  exporter?: Exporter;
  /** The workspace's calendars; with them, the event tools are offered. */
  calendar?: Calendar;
  /** Where the app is, for a meeting note's link written back to Google. */
  origin?: string;
  /** Online: sharing notes and folders outside the workspace. Unset locally, and then the sharing tools aren't offered. */
  sharing?: Sharing;
  /** Online, with Google configured: the caller's Google Contacts. Unset, sync_google_contacts isn't offered. */
  googleContacts?: GoogleContactsSync;
  /** Online, where Google is set up: save_to_drive. Unset locally, and then it isn't offered. */
  drive?: SaveTarget;
}

/**
 * The API route each tool is equivalent to. Online, a tool is offered only to someone whose role
 * allows that route (cloud/src/access.ts), so MCP can't do more than the app.
 */
export const TOOL_ROUTES: Record<string, string> = Object.fromEntries(COMMANDS.flatMap((c) => (toolName(c) ? [[toolName(c), c.route]] : [])));

/**
 * A tool's arguments. Unknown ones are refused, naming them and the ones it takes, rather than
 * dropped: an agent passing a guessed argument (add_task's `to`) would otherwise have it ignored.
 */
function strictInput(c: Command, name: string) {
  const shape = inputSchema(c, "mcp");
  const takes = Object.keys(shape).length ? `It takes: ${Object.keys(shape).join(", ")}.` : "It takes no arguments.";
  return z.strictObject(shape, {
    error: (iss) => (iss.code === "unrecognized_keys" ? `${name} has no argument ${iss.keys.map((k) => `\`${k}\``).join(", ")}. ${takes} (${c.summary})` : undefined),
  });
}

const annotations = (c: Command) =>
  c.readOnly ? { readOnlyHint: true, openWorldHint: false } : { readOnlyHint: false, destructiveHint: !!c.destructive, openWorldHint: !!c.openWorld };

type Content = { type: "text"; text: string } | { type: "resource"; resource: { uri: string; mimeType: string; text: string } | { uri: string; mimeType: string; blob: string } };
type Result = { content: Content[]; isError?: boolean };

/** The largest file a tool sends back (export_note: it goes as base64 in the reply). */
const MAX_MCP_FILE = 20 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A file a command hands back, as MCP carries it: a line saying what it is, then the file as a resource. */
function fileResult(file: { name: string; bytes: Uint8Array; mime?: string }): Result {
  const mime = file.mime ?? "application/octet-stream";
  const bare = mime.split(";")[0];
  if (file.bytes.byteLength > MAX_MCP_FILE) {
    const mb = Math.round(file.bytes.byteLength / 1024 / 1024);
    return { content: [{ type: "text", text: `${file.name} is ${mb} MB, too big to send here: export a folder at a time, or use the app's Share menu or \`commonink export\`.` }], isError: true };
  }
  const uri = `commonink-export:///${encodeURIComponent(file.name)}`;
  return {
    content: [
      { type: "text", text: `${file.name} (${bare}, ${file.bytes.byteLength} bytes)` },
      mime.startsWith("text/")
        ? { type: "resource", resource: { uri, mimeType: bare, text: new TextDecoder().decode(file.bytes) } }
        : { type: "resource", resource: { uri, mimeType: mime, blob: base64(file.bytes) } },
    ],
  };
}

/**
 * For conventions (AGENTS.md) written before tools were renamed: the old names they use, with the
 * names now. Nothing when they use none, so it costs an agent no context then. (`backlinks` was a
 * tool's whole name, and is a word people write anyway, so it doesn't count.)
 */
export function renamedIn(text: string): string {
  const used = Object.keys(RENAMED_TOOLS).filter((old) => old.includes("_") && new RegExp(`(?<![\\w/])${old}(?!\\w)`).test(text));
  return used.length ? `Tools renamed since those were written: ${used.map((old) => `${old} is now ${RENAMED_TOOLS[old]}`).join(", ")}.` : "";
}

export function createMcpServer(host: ToolHost): McpServer {
  const { vault, user } = host;
  const agentsMd = agentsText((p) => vault.files.read(p));
  const mcp = new McpServer(
    { name: "commonink", version: "0.1.0" },
    {
      instructions: [
        "Common Ink is the user's markdown notes vault. Notes are plain .md files (some .html notes); paths are vault-relative.",
        "Find before you write: search_notes, then get_note. Change existing notes with edit_note (small exact replacements); create_note is for a new note, import_notes for many at once (moving notes in from elsewhere).",
        "Link notes with [[Note name]] and embed with ![[Note name]]. The user may be editing at the same time; if an edit fails, re-read and retry.",
        `Workspace settings are the frontmatter of ${SETTINGS_NOTE}; commonink://config/schema lists every property the app reads, and commonink://config/agents re-reads the conventions below.`,
        "Each property of a note has a type (text, number, checkbox, date, list, people): list_properties shows them, declared in the settings' properties: or guessed; write values to suit, and set_property_type declares one for every note.",
        agentsMd && `\nVault conventions (AGENTS.md):\n${agentsMd}`,
        agentsMd && renamedIn(agentsMd),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );

  // The vault's conventions and what its front matter means, to re-read mid-session (schema.ts).
  mcp.registerResource("agents", "commonink://config/agents", { title: "Agent instructions (AGENTS.md)", description: "How agents should work in this vault and how it's organized", mimeType: "text/markdown" }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: agentsText((p) => (vault.sync(), vault.files.read(p))) }],
  }));
  mcp.registerResource("schema", "commonink://config/schema", { title: "Front matter and settings schema", description: `The front matter properties Common Ink reads, and the workspace settings in ${SETTINGS_NOTE}, as JSON Schema`, mimeType: "application/json" }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ note: NOTE_SCHEMA, template: TEMPLATE_SCHEMA, person: PERSON_SCHEMA, settings: SETTINGS_SCHEMA }, null, 2) }],
  }));

  const registered = (mcp as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  for (const c of COMMANDS) {
    const name = toolName(c);
    // Only the tools this caller's role allows.
    if (!name || c.settings || (host.may && !host.may(c.route)) || (c.needs === "calendar" && !host.calendar) || (c.needs === "exporter" && !host.exporter) || (c.needs === "sharing" && !host.sharing) || (c.needs === "googleContacts" && !host.googleContacts) || (c.needs === "drive" && !host.drive)) continue;
    const tool = (mcp.registerTool as (n: string, config: unknown, cb: (input: Record<string, unknown>) => Promise<Result>) => unknown)(
      name,
      { title: c.title, description: c.description ?? c.summary, inputSchema: strictInput(c, name), annotations: annotations(c) },
      async (input) => {
        try {
          if (c.readOnly) vault.sync(); // files written straight to disk count too
          // Every write is attributed to the connected client, so the app can show who changed what.
          const source = host.source(mcp.server.getClientVersion()?.name);
          const out = await c.run(
            { vault, user, source, canEditShared: host.canEditShared ?? true, calendar: host.calendar, origin: host.origin, members: host.members, exporter: host.exporter, sharing: host.sharing, googleContacts: host.googleContacts, drive: host.drive },
            input as never,
          );
          if (out.save) return fileResult(out.save);
          return { content: [{ type: "text", text: out.text }] };
        } catch (e) {
          const text = e instanceof VaultError ? e.message : `Unexpected error: ${(e as Error).message}`;
          return { content: [{ type: "text", text }], isError: true };
        }
      },
    );
    // A name it had before still answers a call, for agents and scripts that know it, but isn't listed
    // (tools/list reads the enumerable names), so no agent's context carries a tool twice.
    for (const old of c.was?.mcp ?? []) Object.defineProperty(registered, old, { value: tool, enumerable: false });
  }
  return mcp;
}
