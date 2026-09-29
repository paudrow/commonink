// stdio MCP server: lets any MCP client (Claude Code, Claude Desktop, Cursor, Codex…) work in the vault.
// The tools live in core/tools.ts, shared with hosted workspaces' remote MCP endpoint.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LOCAL_USER, openVault } from "./core/local.ts";
import { agentSource } from "./core/actor.ts";
import { createMcpServer } from "./core/tools.ts";

const server = createMcpServer({
  quire: openVault(),
  user: LOCAL_USER,
  // Every write is the connected agent's, for the vault's person: QUIRE_AGENT, or the name the
  // client gave when it connected ("Claude Code").
  source: (client) => agentSource(process.env.QUIRE_AGENT || client || "Agent", LOCAL_USER),
});

await server.connect(new StdioServerTransport());
