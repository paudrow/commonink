// stdio MCP server: lets any MCP client (Claude Code, Claude Desktop, Cursor, Codex…) work in the vault.
// The tools live in core/tools.ts, shared with hosted workspaces' remote MCP endpoint.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LOCAL_USER, openVault } from "./core/local.ts";
import { agentSource } from "./core/actor.ts";
import { createMcpServer } from "./core/tools.ts";
import { localExporter } from "./server/export.ts";
import { Calendar, fetchFeed } from "./core/calendar.ts";
import { assertPublic } from "./server/unfurl.ts";

const quire = openVault();
const server = createMcpServer({
  quire,
  exporter: localExporter(quire),
  user: LOCAL_USER,
  // Every write is the connected agent's, for the vault's person: QUIRE_AGENT, or the name the
  // client gave when it connected ("Claude Code").
  source: (client) => agentSource(process.env.QUIRE_AGENT || client || "Agent", LOCAL_USER),
  calendar: new Calendar(quire.db, (url, last) => fetchFeed(url, last, assertPublic)),
});

await server.connect(new StdioServerTransport());
