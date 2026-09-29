// stdio MCP server: lets any MCP client (Claude Code, Claude Desktop, Cursor, Codex…) work in the vault.
// The tools live in core/tools.ts, shared with hosted workspaces' remote MCP endpoint.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LOCAL_USER, openVault } from "./core/local.ts";
import { createMcpServer } from "./core/tools.ts";

const server = createMcpServer({
  quire: openVault(),
  user: LOCAL_USER,
  source: (client) => process.env.QUIRE_AGENT || client || "mcp",
});

await server.connect(new StdioServerTransport());
