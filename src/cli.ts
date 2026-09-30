// `quire` CLI — the same commands as the MCP server (src/core/commands), for agents that prefer a
// shell, and for you. `--json` prints any result as JSON; the exit code says how it went (EXIT).
import fs from "node:fs";
import path from "node:path";
import { LOCAL_USER, openVault, type LocalVault } from "./core/local.ts";
import { QuireError } from "./core/paths.ts";
import { agentSource } from "./core/actor.ts";
import { Calendar, fetchFeed } from "./core/calendar.ts";
import { assertPublic } from "./server/unfurl.ts";
import { EXIT, UsageError, type CommandHost, type Output } from "./core/commands/index.ts";
import { findCommand, noSuchSubcommand, parse, type Io } from "./cli/argv.ts";
import { commandHelp, overview } from "./cli/help.ts";
import { SHELLS } from "./cli/completion.ts";
import { CliError, DEFAULT_SERVER, loadCredentials, login, logout, runRemote, saveCredentials, workspaces, type Credentials } from "./cli/hosted.ts";

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
    // Feeds come from public addresses only, as link previews do.
    calendar: new Calendar(q.db, (url, last) => fetchFeed(url, last, assertPublic)),
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

/**
 * Where a command runs: a hosted workspace once you've signed in, unless --workspace (or
 * $QUIRE_WORKSPACE) says local, or $QUIRE_VAULT names a vault and no workspace is asked for.
 */
function where(asked: string | undefined): { local: true } | { creds: Credentials; workspace?: string } {
  const want = asked ?? process.env.QUIRE_WORKSPACE;
  if (want === "local" || (!want && process.env.QUIRE_VAULT)) return { local: true };
  const creds = loadCredentials();
  if (!creds) {
    if (want) throw new CliError(`--workspace ${want} is a hosted workspace: run quire login first (or --workspace local)`, "auth", EXIT.auth);
    return { local: true };
  }
  return { creds, workspace: want ?? creds.workspace };
}

/** The CLI's own flags for login and workspaces: `--server URL`, `--no-browser`. */
const flagValue = (name: string) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};

async function own(first: string, more: string[]): Promise<boolean> {
  const say = (line: string) => console.error(line);
  if (first === "login") {
    const server = (flagValue("server") ?? process.env.QUIRE_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, "");
    const c = await login(server, { browser: !argv.includes("--no-browser"), say });
    const { user, workspaces: list } = await workspaces(c);
    saveCredentials({ ...c, user: user.name, workspace: list.length === 1 ? list[0].name : undefined });
    const text = `Signed in to ${server} as ${user.name}. Workspaces: ${list.map((w) => `${w.name} (${w.role})`).join(", ") || "none"}.${list.length > 1 ? " Pick one with quire workspaces use <name>, or --workspace." : ""}`;
    console.log(json ? JSON.stringify({ server, user: user.name, workspaces: list }, null, 2) : text);
    return true;
  }
  if (first === "logout") {
    const server = await logout();
    console.log(json ? JSON.stringify({ signedOut: server }) : server ? `Signed out of ${server}.` : "You weren't signed in.");
    return true;
  }
  if (first === "workspaces") {
    const creds = loadCredentials();
    if (!creds) throw new CliError("You aren't signed in to a hosted workspace: run quire login. Commands use this computer's vault meanwhile.", "auth", EXIT.auth);
    const { user, workspaces: list } = await workspaces(creds);
    const words = more.filter((w) => !w.startsWith("-"));
    if (words[0] === "use") {
      const pick = list.find((w) => w.id === words[1] || w.name.toLowerCase() === (words[1] ?? "").toLowerCase());
      if (!pick) throw new UsageError(`workspaces use needs one of: ${list.map((w) => w.name).join(", ")}`);
      saveCredentials({ ...creds, workspace: pick.name });
      console.log(json ? JSON.stringify(pick, null, 2) : `Commands go to ${pick.name} now.`);
      return true;
    }
    if (words.length) throw new UsageError(`workspaces takes use <name>, not "${words[0]}"`);
    const rows = list.map((w) => `${w.name === creds.workspace ? "*" : "-"} ${w.name} (${w.role}${w.kind === "personal" ? ", personal" : ""}) [${w.id}]`);
    console.log(json ? JSON.stringify({ server: creds.server, user: user.name, default: creds.workspace ?? null, workspaces: list }, null, 2) : [`${creds.server}, signed in as ${user.name}:`, ...rows].join("\n"));
    return true;
  }
  return false;
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
  if (await own(first, more)) return;
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
  const agent = globals.agent ?? process.env.QUIRE_AGENT;
  const at = where(globals.workspace);
  if ("creds" in at) return print(await runRemote(at.creds, { command: command.cli, input, workspace: at.workspace, agent }), input);
  if (command.settings) {
    throw loadCredentials()
      ? new UsageError(`${command.cli} is for a hosted workspace, not this computer's vault: name one with --workspace`)
      : new CliError(`${command.cli} is for a hosted workspace: run quire login first`, "auth", EXIT.auth);
  }
  const q = openVault();
  if (command.readOnly) q.sync();
  print(await command.run(localHost(q, agent), input as never), input);
}

main().catch((e) => {
  if (e instanceof UsageError) fail(e.message, "usage", EXIT.usage);
  if (e instanceof QuireError) fail(e.message, e.code, EXIT[e.code === "invalid" ? "error" : e.code]);
  if (e instanceof CliError) fail(e.message, e.code, e.exit);
  console.error(e);
  process.exit(EXIT.error);
});
