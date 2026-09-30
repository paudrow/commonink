// `commonink help` and `commonink help <command>`, made from the command table so they can't drift from it.
import { EXIT, GROUPS, toolName, type Command } from "../core/commands/index.ts";
import { ALIASES, cliArgs, flagOf, GLOBAL_FLAGS, GROUP_DEFAULTS, labelOf } from "./argv.ts";

/** Commands that are the CLI's own, not operations on notes. */
export const OWN_COMMANDS: Array<{ usage: string; summary: string }> = [
  { usage: "login [--server URL]", summary: "sign in to a hosted workspace in the browser (--no-browser to paste instead)" },
  { usage: "logout", summary: "sign out here, and end the sign-in on the server" },
  { usage: "workspaces [use <name>]", summary: "your hosted workspaces and your role in each; use picks the default" },
  { usage: "help [command]", summary: "this list, or one command's options and examples" },
  { usage: "completion bash|zsh|fish", summary: "a shell completion script: commonink completion zsh >> ~/.zshrc" },
  { usage: "mcp", summary: "run the stdio MCP server (the same commands, as tools)" },
  { usage: "version", summary: "the version of this CLI" },
];

/** A command's usage line: `task move <note> <line> --to <to> [--text <text>]`. */
export function usage(c: Command): string {
  const parts = [c.cli];
  const args = cliArgs(c);
  const pos = args.filter(([, a]) => a.pos !== undefined).sort(([, a], [, b]) => (a.pos === "rest" ? 1 : b.pos === "rest" ? -1 : (a.pos as number) - (b.pos as number)));
  for (const [name, a] of pos) {
    const label = `<${labelOf(name, a)}${a.pos === "rest" && a.kind !== "string" ? "…" : ""}>${a.stdin ? " | -" : ""}`;
    parts.push(a.required ? label : `[${label}]`);
  }
  // Required flags first, then the optional ones.
  for (const [name, a] of [...args].sort(([, a], [, b]) => Number(!!b.required) - Number(!!a.required))) {
    if (a.pos !== undefined) continue;
    const flag = `--${flagOf(name, a)}${a.kind === "boolean" ? "" : ` <${labelOf(name, a)}>`}`;
    parts.push(a.required ? flag : `[${flag}]`);
  }
  return parts.join(" ");
}

/** A column of names, `n` wide, after a two-space indent; a longer name gets a line of its own. */
const pad = (s: string, n: number) => (s.length >= n ? `${s}\n${" ".repeat(n + 2)}` : s.padEnd(n));

export function overview(): string {
  const lines = ["commonink — markdown notes for you and your agents", "", "Usage: commonink <command> [args] [--json] [--agent <name>]", ""];
  for (const g of GROUPS) {
    lines.push(`${g.title}:`);
    for (const c of g.commands) lines.push(`  ${pad(c.cli, 18)} ${c.summary}`);
    lines.push("");
  }
  lines.push("The CLI itself:");
  for (const o of OWN_COMMANDS) lines.push(`  ${pad(o.usage, 18)} ${o.summary}`);
  lines.push(
    "",
    "<note> can be a path, a path without .md, a [[wikilink]] name, a note ID or a note URL.",
    `Also: \`commonink starred\` lists your favorites, \`commonink task <note> <line> …\` is \`commonink task update\`.`,
    "Content (create, append, write, edit's --old and --new) can come from stdin: pass - or pipe it in.",
    "",
    "Writes are yours, unless an agent says it's the one writing: --agent <name> (or --as), or",
    '$COMMONINK_AGENT. Agents: set COMMONINK_AGENT, so History shows your changes as "<agent> for you".',
    "Where: after commonink login, your hosted workspace (--workspace <name> picks one; --workspace local,",
    "or $COMMONINK_VAULT, is this computer's vault). Otherwise $COMMONINK_VAULT (default: ./vault next to this tool).",
    "",
    `Exit codes: ${Object.entries(EXIT)
      .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
      .join(", ")}.`,
    "Run commonink help <command> for its options and examples.",
  );
  return lines.join("\n");
}

/** One command's help: usage, what it does, its options, examples, and its MCP twin. */
export function commandHelp(c: Command): string {
  const opts = cliArgs(c).flatMap(([name, a]) => {
    const flag = a.pos !== undefined ? `<${labelOf(name, a)}>` : `--${flagOf(name, a)}${a.kind === "boolean" ? "" : ` <${labelOf(name, a)}>`}`;
    const extra = [
      a.enum && `one of ${a.enum.join(", ")}`,
      a.nullable && '"none" clears it',
      a.kind === "strings" && a.pos === undefined && "comma-separated",
      a.kind === "pairs" && "Name=value, once for each",
      a.stdin && "- reads stdin",
      ...(a.presets ? Object.entries(a.presets).map(([f, v]) => `--${f} is ${v === false ? "false" : v}`) : []),
      ...(a.aliases ?? []).map((f) => `also --${f}`),
    ].filter(Boolean);
    return [`  ${pad(flag, 24)} ${[a.describe, ...extra].filter(Boolean).join("; ")}`];
  });
  const tool = toolName(c);
  const aliases = Object.entries(ALIASES).filter(([, x]) => x.to === c.cli).map(([w, x]) => `commonink ${w} is commonink ${c.cli} with ${Object.keys(x.set).map((k) => `--${k}`).join(" ")}.`);
  const fallback = Object.entries(GROUP_DEFAULTS).filter(([, to]) => to === c.cli).map(([w]) => `Also: commonink ${w} ${usage(c).slice(c.cli.length + 1)}`);
  return [
    `commonink ${usage(c)}`,
    "",
    c.description ?? c.summary,
    ...(opts.length ? ["", "Arguments and options:", ...opts] : []),
    "",
    "Every command also takes:",
    ...Object.entries(GLOBAL_FLAGS).filter(([k]) => k !== "as" && k !== "help").map(([k, f]) => `  ${pad(`--${k}${f.value ? " <name>" : ""}`, 24)} ${f.describe}`),
    ...(c.examples?.length ? ["", "Examples:", ...c.examples.map((e) => `  ${e}`)] : []),
    ...(aliases.length || fallback.length ? ["", ...aliases, ...fallback] : []),
    "",
    tool ? `The MCP tool ${tool} does the same.` : `No MCP tool: ${(c.mcp as { none: string }).none}.`,
  ].join("\n");
}
