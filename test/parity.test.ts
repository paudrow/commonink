// The CLI, MCP and the app stay in step: one command table (src/core/commands) makes the CLI and the
// MCP tools, and each of the app's API routes has a command or a reason it doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_ONLY, COMMANDS, commandByCli, NOUNS, RENAMED_TOOLS, toolName, VERBS } from "../src/core/commands/index.ts";
import { createMcpServer } from "../src/core/tools.ts";
import { Calendar } from "../src/core/calendar.ts";
import { GoogleContactsSync } from "../src/core/googleContacts.ts";
import { openTempVault } from "./helpers.ts";
import { WORKSPACE_ROUTES } from "../cloud/src/access.ts";
import { parse } from "../src/cli/argv.ts";
import { UsageError } from "../src/core/commands/index.ts";
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
      "asset upload", "asset download", "decision answer", "version rename", "version delete", "calendar list", "calendar subscribe", "calendar refresh", "calendar unsubscribe",
      "member list", "member-role set", "member remove", "workspace leave", "invite create", "invite list", "invite revoke", "workspace rename", "log list",
    ],
    "the CLI-only commands changed: if that's meant, update this list",
  );
});

test("names follow one grammar: <noun> <verb> on the CLI, <verb>_<noun> over MCP, with the same words", () => {
  const plural = (noun: string) => (noun.endsWith("s") || noun === "trash" || noun === "today" || noun === "starred" ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`);
  for (const c of COMMANDS) {
    const words = c.cli.split(" ");
    // A verb alone is the note's: `edit` is `note edit`.
    const [noun, verb] = words.length === 1 ? ["note", words[0]] : words;
    assert.ok(words.length <= 2 && NOUNS.includes(noun) && VERBS.includes(verb), `"${c.cli}" isn't <noun> <verb>, with a noun from NOUNS and a verb from VERBS`);
    assert.ok(words.length === 2 || noun === "note", `"${c.cli}" needs its noun`);
    const tool = toolName(c);
    if (!tool) continue;
    // The tool says the same two words, the other way round: one thing or several (list_tasks), and where it goes if it needs saying (append_to_note).
    const things = [noun, plural(noun)].map((n) => n.replaceAll("-", "_"));
    const allowed = things.flatMap((n) => [`${verb}_${n}`, `${verb}_to_${n}`, `${verb}_from_${n}`, `${verb}_in_${n}`]);
    assert.ok(allowed.includes(tool), `"${c.cli}" is the tool ${tool}, which should be one of ${allowed.join(", ")}`);
  }
});

test("a renamed command keeps its old names: the CLI takes them, MCP takes a call to one but lists only the name now", async () => {
  const names = COMMANDS.map((c) => c.cli);
  const old = COMMANDS.flatMap((c) => c.was?.cli ?? []);
  assert.deepEqual(old.filter((w, i) => names.includes(w) || old.indexOf(w) !== i), [], "an old CLI name is taken by another command");
  const tools = COMMANDS.flatMap((c) => (toolName(c) ? [toolName(c)!] : []));
  const oldTools = COMMANDS.flatMap((c) => c.was?.mcp ?? []);
  assert.deepEqual(oldTools.filter((t, i) => tools.includes(t) || oldTools.indexOf(t) !== i), [], "an old tool name is taken by another tool");
  assert.deepEqual(COMMANDS.filter((c) => c.was?.mcp?.length && !toolName(c)).map((c) => c.cli), [], "an old tool name on a command that isn't a tool");
  const io = { stdin: () => null, readFile: (name: string) => ({ name, bytes: new Uint8Array() }) };
  for (const c of COMMANDS) {
    for (const words of c.was?.cli ?? []) {
      assert.equal(commandByCli(words), c);
      // With nothing after it, an old name reads as its command (or asks for what the command needs), never as "unknown".
      let found: unknown;
      try {
        const parsed = parse(words.split(" "), io);
        found = parsed && "command" in parsed ? parsed.command : parsed;
      } catch (e) {
        assert.ok(e instanceof UsageError, `commonink ${words}: ${e}`);
        found = c;
      }
      assert.equal(found, c, `commonink ${words} should still be ${c.cli}`);
    }
  }
  // The names from before this grammar, so a later rename can't drop one.
  for (const words of ["read", "ls", "mv", "tasks", "task remove", "contacts", "contact", "contact add", "smart", "smart-save", "smart-rm", "star-tag", "label", "labels", "label-diff", "label-rm", "calendars add", "calendars remove", "invites revoke", "new", "diff", "changes", "today", "upload"]) {
    assert.ok(commandByCli(words), `commonink ${words} no longer works`);
  }
  assert.deepEqual(
    { read_note: RENAMED_TOOLS.read_note, remove_task: RENAMED_TOOLS.remove_task, label_version: RENAMED_TOOLS.label_version, list_smart_folders: RENAMED_TOOLS.list_smart_folders, order_favorites: RENAMED_TOOLS.order_favorites },
    { read_note: "get_note", remove_task: "delete_task", label_version: "name_version", list_smart_folders: "list_views", order_favorites: "order_starred" },
  );
});

test("the MCP server offers exactly the table's tools", async () => {
  const { vault } = openTempVault();
  const calendar = new Calendar(vault.db, async () => ({ status: "unchanged" }), { vault });
  const server = createMcpServer({ vault, user: "you", source: () => "t", calendar, exporter: async () => ({ name: "x.md", mime: "text/markdown", data: new Uint8Array() }), sharing: { list: async () => "", share: async () => "", unshare: async () => "" }, googleContacts: new GoogleContactsSync(vault.db, vault, "you", async () => null, () => ({ changes: async () => ({ people: [], syncToken: "", full: true }), update: async (p) => p })), drive: { name: "Google Drive", save: async () => ({ name: "x", url: "https://x" }) } }) as unknown as { _registeredTools: Record<string, unknown> };
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
