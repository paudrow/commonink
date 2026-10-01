// The CLI, MCP and the app stay in step: one command table (src/core/commands) makes the CLI and the
// MCP tools, and each of the app's API routes has a command or a reason it doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_ONLY, COMMANDS, toolName } from "../src/core/commands/index.ts";
import { createMcpServer } from "../src/core/tools.ts";
import { Calendar } from "../src/core/calendar.ts";
import { GoogleContactsSync } from "../src/core/googleContacts.ts";
import { openTempVault } from "./helpers.ts";
import { WORKSPACE_ROUTES } from "../cloud/src/access.ts";
import { parse } from "../src/cli/argv.ts";
import { commandHelp } from "../src/cli/help.ts";
import fs from "node:fs";

test("every command is an MCP tool, or says why not; names are unique on both sides", () => {
  const tools = COMMANDS.flatMap((c) => (toolName(c) ? [toolName(c)!] : []));
  assert.equal(new Set(tools).size, tools.length, "an MCP tool name is used twice");
  assert.equal(new Set(COMMANDS.map((c) => c.cli)).size, COMMANDS.length, "a CLI command is defined twice");
  assert.deepEqual(COMMANDS.filter((c) => !toolName(c) && !(c.mcp as { none: string }).none?.trim()).map((c) => c.cli), [], "CLI-only commands need a reason");
  assert.deepEqual(
    COMMANDS.filter((c) => !toolName(c)).map((c) => c.cli),
    [
      "upload", "download", "label-rename", "label-rm", "calendars", "calendars add", "calendars refresh", "calendars remove",
      "members", "member role", "member remove", "leave", "invite", "invites", "invites revoke", "workspace rename", "workspace log",
    ],
    "the CLI-only commands changed: if that's meant, update this list",
  );
});

test("the MCP server offers exactly the table's tools", async () => {
  const { vault } = openTempVault();
  const calendar = new Calendar(vault.db, async () => ({ status: "unchanged" }));
  const server = createMcpServer({ vault, user: "you", source: () => "t", calendar, exporter: async () => ({ name: "x.md", mime: "text/markdown", data: new Uint8Array() }), sharing: { list: async () => "", share: async () => "", unshare: async () => "" }, googleContacts: new GoogleContactsSync(vault.db, vault, "you", async () => null, () => ({ changes: async () => ({ people: [], syncToken: "", full: true }), update: async (p) => p })) }) as unknown as { _registeredTools: Record<string, unknown> };
  assert.deepEqual(Object.keys(server._registeredTools).sort(), COMMANDS.flatMap((c) => (toolName(c) ? [toolName(c)!] : [])).sort());
});

test("every API route the app uses has a command, or a reason in APP_ONLY; each command's route has a role online", () => {
  const routes = Object.keys(WORKSPACE_ROUTES);
  const covered = new Set([...COMMANDS.map((c) => c.route), ...Object.keys(APP_ONLY)]);
  assert.deepEqual(routes.filter((r) => !covered.has(r)), [], "app routes with no command and no reason");
  assert.deepEqual(COMMANDS.filter((c) => !routes.includes(c.route)).map((c) => `${c.cli}: ${c.route}`), [], "commands whose route has no role");
  assert.deepEqual(Object.keys(APP_ONLY).filter((r) => !routes.includes(r)), [], "APP_ONLY names a route that isn't there");
});

test("the README lists every MCP tool", () => {
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const listed = readme.match(/^Tools: (.*)$/m)![1];
  assert.deepEqual(COMMANDS.flatMap((c) => (toolName(c) && !listed.includes(`\`${toolName(c)}\``) ? [toolName(c)] : [])), []);
});

test("every command has help with a summary and examples, and every example is a valid command line", () => {
  const io = { stdin: () => "piped", readFile: (name: string) => ({ name, bytes: new Uint8Array() }) };
  for (const c of COMMANDS) {
    assert.ok(c.summary && c.examples?.length, `${c.cli} needs a summary and an example`);
    assert.match(commandHelp(c), new RegExp(`^commonink ${c.cli}`));
    for (const e of c.examples!) {
      // Each `commonink …` in the example's pipeline must be a valid command line, and one of them this command.
      const found = e
        .split(/ \| /)
        .filter((part) => part.startsWith("commonink "))
        .map((part) => {
          const words = [...part.replace(/ [<>] \S+/g, "").matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
          const parsed = parse(words.slice(1), io);
          assert.ok(parsed && "command" in parsed, `"${part}" in ${c.cli}'s examples isn't a command line`);
          return parsed.command;
        });
      assert.ok(found.includes(c), `example "${e}" doesn't run ${c.cli}`);
    }
  }
});
