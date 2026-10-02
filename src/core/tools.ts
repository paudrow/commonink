// The MCP tools, made from the command table (src/core/commands) that the CLI uses too, and shared
// by the local stdio server (src/mcp.ts) and hosted workspaces (the remote /mcp endpoint), so an
// agent gets the same tools either way.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultError } from "./paths.ts";
import type { Vault } from "./vault.ts";
import type { Calendar } from "./calendar.ts";
import type { MemberRef } from "./contacts.ts";
import type { Exporter } from "./export.ts";
import { AGENTS_NOTE } from "./noteRoles.ts";
import { COMMANDS, toolName, type ArgSpec, type Command, type SaveTarget, type Sharing } from "./commands/index.ts";

export interface ToolHost {
  vault: Vault;
  /** Whose favorites and own smart folders the tools read and change. */
  user: string;
  /** Who writes are attributed to, given the name the client connected with. */
  source(client: string | undefined): string;
  /**
   * Whether the caller may use an API route (online: their role in the workspace). Tools whose
   * route they may not use aren't offered. Unset locally, where everything is allowed.
   */
  may?(route: string): boolean;
  /** Whether the caller may make or change shared smart folders (online: editors and owners). Default yes. */
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
  /** Online, where Google is set up: save_to_drive. Unset locally, and then it isn't offered. */
  drive?: SaveTarget;
}

/**
 * The API route each tool is equivalent to. Online, a tool is offered only to someone whose role
 * allows that route (cloud/src/access.ts), so MCP can't do more than the app.
 */
export const TOOL_ROUTES: Record<string, string> = Object.fromEntries(COMMANDS.flatMap((c) => (toolName(c) ? [[toolName(c), c.route]] : [])));

/** An argument as MCP's input schema has it. */
function schemaOf(a: ArgSpec): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  if (a.kind === "number") t = z.number().int().min(a.min ?? Number.MIN_SAFE_INTEGER).max(a.max ?? Number.MAX_SAFE_INTEGER);
  else if (a.kind === "boolean") t = z.boolean();
  else if (a.kind === "strings") t = a.required && !a.allowEmpty ? z.array(z.string()).min(1) : z.array(z.string());
  else if (a.kind === "string") t = a.enum ? z.enum(a.enum as [string, ...string[]]) : z.string();
  else if (a.kind === "pairs") t = z.record(z.string(), z.string());
  else throw new Error(`An MCP tool can't take a ${a.kind} argument`);
  if (a.nullable) t = t.nullable();
  if (!a.required && !a.mcpRequired) t = t.optional();
  return a.describe ? t.describe(a.describe) : t;
}

const inputSchema = (c: Command) => Object.fromEntries(Object.entries(c.args).flatMap(([name, a]) => (a.only === "cli" ? [] : [[name, schemaOf(a)]])));

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

export function createMcpServer(host: ToolHost): McpServer {
  const { vault, user } = host;
  const agentsMd = vault.files.read(AGENTS_NOTE) ?? "";
  const mcp = new McpServer(
    { name: "commonink", version: "0.1.0" },
    {
      instructions: [
        "Common Ink is the user's markdown notes vault. Notes are plain .md files (some .html notes); paths are vault-relative.",
        "Find before you write: search_notes, then read_note. Change existing notes with edit_note (small exact replacements); create_note is for a new note, import_notes for many at once (moving notes in from elsewhere).",
        "Link notes with [[Note name]] and embed with ![[Note name]]. The user may be editing at the same time; if an edit fails, re-read and retry.",
        agentsMd && `\nVault conventions (AGENTS.md):\n${agentsMd}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );

  for (const c of COMMANDS) {
    const name = toolName(c);
    // Only the tools this caller's role allows.
    if (!name || c.settings || (host.may && !host.may(c.route)) || (c.needs === "calendar" && !host.calendar) || (c.needs === "exporter" && !host.exporter) || (c.needs === "sharing" && !host.sharing) || (c.needs === "drive" && !host.drive)) continue;
    (mcp.registerTool as (n: string, config: unknown, cb: (input: Record<string, unknown>) => Promise<Result>) => unknown)(
      name,
      { title: c.title, description: c.description ?? c.summary, inputSchema: inputSchema(c), annotations: annotations(c) },
      async (input) => {
        try {
          if (c.readOnly) vault.sync(); // files written straight to disk count too
          // Every write is attributed to the connected client, so the app can show who changed what.
          const source = host.source(mcp.server.getClientVersion()?.name);
          const out = await c.run(
            { vault, user, source, canEditShared: host.canEditShared ?? true, calendar: host.calendar, origin: host.origin, members: host.members, exporter: host.exporter, sharing: host.sharing, drive: host.drive },
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
  }
  return mcp;
}
