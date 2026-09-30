// The MCP tools, made from the command table (src/core/commands) that the CLI uses too, and shared
// by the local stdio server (src/mcp.ts) and hosted workspaces (the remote /mcp endpoint), so an
// agent gets the same tools either way.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QuireError } from "./paths.ts";
import type { Quire } from "./quire.ts";
import type { Calendar } from "./calendar.ts";
import { AGENTS_NOTE } from "./noteRoles.ts";
import { COMMANDS, toolName, type ArgSpec, type Command } from "./commands/index.ts";

export interface ToolHost {
  quire: Quire;
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
  /** The workspace's calendars; with them, the event tools are offered. */
  calendar?: Calendar;
  /** Where the app is, for a meeting note's link written back to Google. */
  origin?: string;
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
  c.readOnly ? { readOnlyHint: true, openWorldHint: false } : { readOnlyHint: false, destructiveHint: !!c.destructive, openWorldHint: false };

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function createMcpServer(host: ToolHost): McpServer {
  const { quire, user } = host;
  const agentsMd = quire.files.read(AGENTS_NOTE) ?? "";
  const mcp = new McpServer(
    { name: "quire", version: "0.1.0" },
    {
      instructions: [
        "Quire is the user's markdown notes vault. Notes are plain .md files (some .html notes); paths are vault-relative.",
        "Find before you write: search_notes, then read_note. Change existing notes with edit_note (small exact replacements); create_note is for new notes.",
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
    if (!name || (host.may && !host.may(c.route)) || (c.needs === "calendar" && !host.calendar)) continue;
    (mcp.registerTool as (n: string, config: unknown, cb: (input: Record<string, unknown>) => Promise<Result>) => unknown)(
      name,
      { title: c.title, description: c.description ?? c.summary, inputSchema: inputSchema(c), annotations: annotations(c) },
      async (input) => {
        try {
          if (c.readOnly) quire.sync(); // files written straight to disk count too
          // Every write is attributed to the connected client, so the app can show who changed what.
          const source = host.source(mcp.server.getClientVersion()?.name);
          const out = await c.run({ quire, user, source, canEditShared: host.canEditShared ?? true, calendar: host.calendar, origin: host.origin }, input as never);
          return { content: [{ type: "text", text: out.text }] };
        } catch (e) {
          const text = e instanceof QuireError ? e.message : `Unexpected error: ${(e as Error).message}`;
          return { content: [{ type: "text", text }], isError: true };
        }
      },
    );
  }
  return mcp;
}
