// Reading a command line against the command table: which command, and its input, typed. Flags and
// positional arguments come from each argument's spec (src/core/commands/types.ts). No I/O here:
// stdin and local files are read by the caller through `io`.
import { COMMANDS, UsageError, type ArgSpec, type Command, type LocalFile } from "../core/commands/index.ts";

/** Flags every command takes. `value` ones take the next word. */
export const GLOBAL_FLAGS = {
  json: { value: false, describe: "Print the result (or the error) as JSON on stdout" },
  agent: { value: true, describe: 'Who is writing, if an agent: History shows "<agent> for you" (or $COMMONINK_AGENT)' },
  as: { value: true, describe: "Same as --agent (older spelling)" },
  workspace: { value: true, describe: "A hosted workspace (its name or ID) after commonink login, or local for this computer's vault (or $COMMONINK_WORKSPACE)" },
  help: { value: false, describe: "This command's help" },
} as const;

/** CLI spellings that stand for a command with some of its arguments set. */
export const ALIASES: Record<string, { to: string; set: Record<string, unknown> }> = {
  starred: { to: "ls", set: { starred: true } },
};
/** A group's words followed by something that isn't one of its commands: `commonink task Roadmap 8 --done`. */
export const GROUP_DEFAULTS: Record<string, string> = { task: "task update" };
/**
 * A command that stands for another when it's given one of that one's own flags:
 * `contact Jane --role CTO` is `contact update`, `diff Spec --from v1` is `label-diff`,
 * `restore Spec --to v1` is `label-restore`, and `export Spec --to drive` is `save-to-drive`.
 */
export const WITH_FLAGS: Record<string, string> = { contact: "contact update", diff: "label-diff", restore: "label-restore", export: "save-to-drive" };

export const kebab = (name: string) => name.replaceAll("_", "-");
export const flagOf = (name: string, a: ArgSpec) => a.flag ?? kebab(name);
export const labelOf = (name: string, a: ArgSpec) => a.label ?? kebab(name);
export const cliArgs = (c: Command) => Object.entries(c.args).filter(([, a]) => a.only !== "mcp");
/** Required on the command line (MCP-only requirements aside). */
export const cliRequired = (a: ArgSpec) => !!a.required;

const BY_WORDS = new Map(COMMANDS.map((c) => [c.cli, c]));

export interface Parsed {
  command: Command;
  /** What the command's `run` gets. */
  input: Record<string, unknown>;
  globals: { json: boolean; agent?: string; workspace?: string; help: boolean };
}

export interface Io {
  /** stdin, when it isn't a terminal; null when it is (nothing to read). */
  stdin(): string | null;
  readFile(path: string): LocalFile;
}

/** Split words into flags (with their values, if they take one) and positional words. */
function tokenize(argv: string[], takesValue: (flag: string) => boolean) {
  const flags: Array<[string, string | true]> = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i];
    if (w === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (w === "-h") flags.push(["help", true]);
    else if (w.startsWith("--") && w.length > 2) {
      const eq = w.indexOf("=");
      const name = eq > 0 ? w.slice(2, eq) : w.slice(2);
      if (eq > 0) flags.push([name, w.slice(eq + 1)]);
      else if (takesValue(name)) {
        if (argv[i + 1] === undefined) throw new UsageError(`--${name} needs a value`);
        flags.push([name, argv[++i]]);
      } else flags.push([name, true]);
    } else words.push(w);
  }
  return { flags, words };
}

/** The command a line of words names, and the words left for its arguments. */
export function findCommand(words: string[]): { command: Command; rest: string[]; set: Record<string, unknown> } | null {
  for (const n of [2, 1]) {
    const c = BY_WORDS.get(words.slice(0, n).join(" "));
    if (c && words.length >= n) return { command: c, rest: words.slice(n), set: {} };
  }
  const alias = ALIASES[words[0]];
  if (alias) return { command: BY_WORDS.get(alias.to)!, rest: words.slice(1), set: alias.set };
  const fallback = GROUP_DEFAULTS[words[0]];
  if (fallback) return { command: BY_WORDS.get(fallback)!, rest: words.slice(1), set: {} };
  return null;
}

/** The second words that go with a first: `task` → add, update, move, remove. */
export function subcommands(first: string): string[] {
  return COMMANDS.flatMap((c) => {
    const [a, b] = c.cli.split(" ");
    return a === first && b ? [b] : [];
  });
}
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/** Why a line of words names no command, if it starts like one: `card shuffle`. */
export function noSuchSubcommand(words: string[]): string | null {
  const subs = subcommands(words[0]);
  return subs.length && !BY_WORDS.has(words[0]) ? `${words[0]} needs ${orList(subs)}, not "${words[1] ?? ""}"` : null;
}

/** The words that start commands: `search`, `task`, … and the aliases. */
export const topWords = () => [...new Set([...COMMANDS.map((c) => c.cli.split(" ")[0]), ...Object.keys(ALIASES)])].sort();

/** A value from the command line, as its argument's kind. */
function convert(name: string, a: ArgSpec, raw: string, where: "flag" | "pos", io: Io): unknown {
  const shown = where === "flag" ? `--${flagOf(name, a)}` : `<${labelOf(name, a)}>`;
  if (a.nullable && raw === "none") return null;
  if (a.kind === "number") {
    if (!/^\d+$/.test(raw) || (a.min !== undefined && Number(raw) < a.min) || (a.max !== undefined && Number(raw) > a.max)) {
      const range = a.max !== undefined ? ` from ${a.min ?? 0} to ${a.max}` : a.min === 1 ? "" : "";
      throw new UsageError(`${shown} must be a ${where === "flag" ? "positive " : ""}whole number${range}, not "${raw}"`);
    }
    return Number(raw);
  }
  if (a.kind === "strings") return raw === "none" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (a.kind === "files") return [io.readFile(raw)];
  if (a.kind === "pairs") {
    const [key, ...value] = raw.split("=");
    if (!value.length || !key.trim()) throw new UsageError(`${shown} takes Name=value, not "${raw}"`);
    return { [key.trim()]: value.join("=") };
  }
  if (a.stdin && raw === "-") {
    const input = io.stdin();
    if (input === null) throw new UsageError(`${shown} is "-", but nothing was piped in`);
    return input;
  }
  if (a.enum && !a.enum.includes(raw)) throw new UsageError(`${shown} ${a.enum.length === 1 ? "can only be" : "must be"} ${orList([...a.enum])}, not "${raw}"`);
  return raw;
}

/** Read a command line. Throws UsageError for anything that doesn't fit the command. */
export function parse(argv: string[], io: Io): Parsed | { help: string[] } | null {
  const valueFlags = new Set<string>(Object.entries(GLOBAL_FLAGS).flatMap(([k, f]) => (f.value ? [k] : [])));
  for (const c of COMMANDS) {
    for (const [name, a] of cliArgs(c)) {
      if (a.kind !== "boolean") for (const f of [flagOf(name, a), ...(a.aliases ?? [])]) valueFlags.add(`${c.cli}\u0000${f}`);
    }
  }
  // Words first (flags can't be told apart until the command is known): a flag takes a value if any
  // command's flag of that name does, then the command's own spec settles it.
  const pre = tokenize(argv, (f) => (valueFlags.has(f) ? true : COMMANDS.some((c) => valueFlags.has(`${c.cli}\u0000${f}`))));
  const found = findCommand(pre.words);
  if (!found) return null;
  const { set } = found;
  let { command } = found;
  const has = (c: Command, f: string) => cliArgs(c).some(([name, a]) => flagOf(name, a) === f || a.aliases?.includes(f) || (a.presets && f in a.presets));
  const alt = WITH_FLAGS[command.cli] ? BY_WORDS.get(WITH_FLAGS[command.cli]) : undefined;
  if (alt && pre.flags.some(([f]) => !has(command, f) && has(alt, f))) command = alt;
  const own = (f: string) => valueFlags.has(`${command.cli}\u0000${f}`) || valueFlags.has(f);
  const { flags, words } = tokenize(argv, own);
  const rest = findCommand(words)!.rest;
  const globals: Parsed["globals"] = { json: false, help: false };
  const input: Record<string, unknown> = { ...set };
  const args = cliArgs(command);
  for (const [flag, value] of flags) {
    if (flag === "json" || flag === "help") {
      globals[flag] = true;
      continue;
    }
    if (flag === "agent" || flag === "as") {
      globals.agent = String(value);
      continue;
    }
    if (flag === "workspace") {
      globals.workspace = String(value);
      continue;
    }
    const hit = args.find(([name, a]) => flagOf(name, a) === flag || a.aliases?.includes(flag));
    const preset = args.find(([, a]) => a.presets && flag in a.presets);
    if (preset) input[preset[0]] = preset[1].presets![flag];
    else if (!hit) throw new UsageError(`${command.cli} has no --${flag}: see commonink help ${command.cli}`);
    else if (hit[1].kind === "boolean") input[hit[0]] = true;
    else if (hit[1].kind === "pairs") input[hit[0]] = { ...(input[hit[0]] as object), ...(convert(hit[0], hit[1], String(value), "flag", io) as object) };
    else input[hit[0]] = convert(hit[0], hit[1], String(value), "flag", io);
  }
  if (globals.help) return { help: command.cli.split(" ") };
  const positional = args.filter(([, a]) => a.pos !== undefined).sort(([, a], [, b]) => (a.pos === "rest" ? 1 : b.pos === "rest" ? -1 : (a.pos as number) - (b.pos as number)));
  let at = 0;
  for (const [name, a] of positional) {
    if (a.pos === "rest") {
      const words = rest.slice(at);
      at = rest.length;
      if (!words.length) continue;
      input[name] =
        a.kind === "strings" ? words
        : a.kind === "files" ? words.map((w) => io.readFile(w))
        : a.stdin && words.length === 1 && words[0] === "-" ? convert(name, a, "-", "pos", io)
        : words.join(" ");
    } else if (rest[at] !== undefined) input[name] = convert(name, a, rest[at++], "pos", io);
  }
  if (at < rest.length) {
    const subs = at === 0 ? subcommands(command.cli) : [];
    throw new UsageError(subs.length ? `${command.cli} takes ${orList(subs)}, not "${rest[0]}"` : `${command.cli} takes no more arguments: "${rest.slice(at).join(" ")}" is extra`);
  }
  for (const [name, a] of args) {
    if (input[name] !== undefined || !cliRequired(a)) continue;
    // A piped-in body is the content when it's left out: `… | commonink create Log`.
    const piped = a.stdin ? io.stdin() : null;
    if (piped !== null) {
      input[name] = piped;
      continue;
    }
    throw new UsageError(a.missing ?? `${command.cli} needs ${a.pos !== undefined ? `<${labelOf(name, a)}>` : `--${flagOf(name, a)}`}`);
  }
  return { command, input, globals };
}
