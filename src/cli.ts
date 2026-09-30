// `quire` CLI — the same commands as the MCP server (src/core/commands), for agents that prefer a
// shell, and for you. `--json` prints any result as JSON; the exit code says how it went (EXIT).
import fs from "node:fs";
import path from "node:path";
import { LOCAL_USER, openVault, type LocalVault } from "./core/local.ts";
import { QuireError } from "./core/paths.ts";
import { agentSource } from "./core/actor.ts";
import { EXIT, UsageError, type CommandHost, type Output } from "./core/commands/index.ts";
import { findCommand, noSuchSubcommand, parse, type Io } from "./cli/argv.ts";
import { commandHelp, overview } from "./cli/help.ts";
import { SHELLS } from "./cli/completion.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");

const io: Io = {
  stdin() {
    if (process.stdin.isTTY) return null;
    const text = fs.readFileSync(0, "utf8");
    return text === "" ? null : text;
  },
  readFile(p) {
    try {
      return { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
    } catch {
      throw new QuireError(`There's no file at ${p}`, "not_found");
    }
  },
};

/** The local vault, and who's writing. */
function localHost(q: LocalVault, agent: string | undefined): CommandHost {
  return {
    quire: q,
    user: LOCAL_USER,
    source: agent ? agentSource(agent, LOCAL_USER) : LOCAL_USER,
    canEditShared: true,
    bytes: {
      read: async (rel) => {
        try {
          return new Uint8Array(fs.readFileSync(q.files.abs(rel)));
        } catch {
          return null;
        }
      },
      add: async (rel, bytes, source) => {
        q.files.write(rel, bytes);
        q.recordUpload(rel, false, source);
      },
    },
  };
}

/** Print a result, and save a file it hands back (a download) where --out says. */
function print(out: Output, input: Record<string, unknown>) {
  let data = out.data;
  if (out.save) {
    const dest = typeof input.out === "string" ? input.out : out.save.name;
    if (dest === "-") return void process.stdout.write(out.save.bytes);
    fs.writeFileSync(dest, out.save.bytes);
    data = { ...(out.data as object), saved: dest };
    out = { ...out, text: `${out.text} → ${dest}` };
  }
  console.log(json ? JSON.stringify(data, null, 2) : out.text);
}

function fail(message: string, code: string, exit: number): never {
  if (json) console.log(JSON.stringify({ error: message, code, exit }, null, 2));
  else console.error(message);
  process.exit(exit);
}

async function main() {
  // The CLI's own commands come first on the line; a note command's words can be anywhere among its flags.
  const [first, ...more] = argv;
  if (first === "mcp") return void (await import("./mcp.ts"));
  if (first === "version" || first === "--version") return console.log(process.env.QUIRE_CLI_VERSION ?? JSON.parse(fs.readFileSync(new URL("../cli/package.json", import.meta.url), "utf8")).version);
  if (first === "completion") {
    const shell = SHELLS[more[0] as keyof typeof SHELLS];
    if (!shell) throw new UsageError(`completion takes bash, zsh or fish, not "${more[0] ?? ""}"`);
    return console.log(shell());
  }
  const words = argv.filter((w) => !w.startsWith("-"));
  if (!argv.filter((w) => w !== "--json").length || first === "help" || first === "--help" || first === "-h") {
    const asked = more.filter((w) => !w.startsWith("-"));
    if (!asked.length) return console.log(overview());
    const found = findCommand(asked);
    if (!found) throw new UsageError(`No command "${asked.join(" ")}": see quire help`);
    return console.log(commandHelp(found.command));
  }
  const parsed = parse(argv, io);
  if (!parsed) {
    const sub = noSuchSubcommand(words);
    if (sub) throw new UsageError(sub);
    if (json) fail(`Unknown command: ${words[0]}`, "usage", EXIT.usage);
    console.error(`Unknown command: ${words[0]}\n\n${overview()}`);
    process.exit(EXIT.usage);
  }
  if ("help" in parsed) return console.log(commandHelp(findCommand(parsed.help)!.command));
  const { command, input, globals } = parsed;
  const q = openVault();
  if (command.readOnly) q.sync();
  print(await command.run(localHost(q, globals.agent ?? process.env.QUIRE_AGENT), input as never), input);
}

main().catch((e) => {
  if (e instanceof UsageError) fail(e.message, "usage", EXIT.usage);
  if (e instanceof QuireError) fail(e.message, e.code, EXIT[e.code === "invalid" ? "error" : e.code]);
  console.error(e);
  process.exit(EXIT.error);
});
