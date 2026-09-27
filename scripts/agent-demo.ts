// Pretend to be an agent: connect to the real stdio MCP server and make a few edits.
// Keep the app open on Projects/Quire roadmap.md to watch them land.
//   npm run agent-demo            # as "claude-code"
//   npm run agent-demo -- cursor  # as any client name
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "claude-code";
const client = new Client({ name, version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: path.join(root, "bin", "quire"), args: ["mcp"] }));

const call = async (tool: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name: tool, arguments: args });
  const text = r.content.map((c: any) => c.text).join("\n");
  console.log(`\n→ ${tool}${r.isError ? " (error)" : ""}\n${text}`);
  return text as string;
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

await call("search_notes", { query: "roadmap semantic search", limit: 3 });
const note = await call("read_note", { path: "Quire roadmap" });
const version = note.match(/version: (\w+)/)![1];
const done = note.includes("- [x] Semantic search");
await pause(1200);
await call("edit_note", {
  path: "Quire roadmap",
  old_string: done ? "- [x] Semantic search" : "- [ ] Semantic search",
  new_string: done ? "- [ ] Semantic search" : "- [x] Semantic search",
  base_version: version,
});
await pause(1200);
const time = new Date().toTimeString().slice(0, 5);
await call("edit_note", {
  path: "Quire roadmap",
  old_string: "## Later",
  new_string: `> ${name}, ${time}: sketched the embedding index; see [[Outside-in agents]] for the constraints.\n\n## Later`,
});
await pause(1200);
const today = new Date().toISOString().slice(0, 10);
const log = `- ${time} — ${done ? "reopened" : "ticked off"} semantic search in [[Quire roadmap]]`;
const appended = await call("append_to_note", { path: `Journal/${today}`, text: log });
if (appended.startsWith("No note")) await call("create_note", { path: `Journal/${today}`, content: `# ${today}\n\n## Log\n\n${log}\n` });
await call("recent_changes", { limit: 5 });
await client.close();
