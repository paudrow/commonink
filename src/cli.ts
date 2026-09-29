// `quire` CLI — the same core as the MCP server, for agents that prefer a shell (and for you).
import fs from "node:fs";
import { LOCAL_USER, openVault } from "./core/local.ts";
import { QuireError } from "./core/paths.ts";
import { fmtBacklinks, fmtChanges, fmtFavorites, fmtList, fmtRead, fmtSearch, fmtWrite } from "./core/format.ts";
import { agentSource, parseAuthorFilter } from "./core/actor.ts";

const HELP = `quire — markdown notes for you and your agents

Usage: quire <command> [args] [--agent <name>] [--json]

  search <query…> [--archived|--all] full-text search (prefix matching)
  read <note> [--offset N] [--limit N]
  ls [folder] [--recent N] [--archived|--all]
  archive <note…>                  move notes to Archive/ (links keep working)
  unarchive <note…>                move archived notes back
  create <path> [content | -]      '-' or no content reads stdin
  edit <note> --old <s> --new <s> [--all] [--base <version>]
  append <note> [text | -]
  mv <note> <new-path>             rewrites links to the note
  backlinks <note>
  star <note…> / unstar <note…>    add to or take out of your favorites
  starred                          list your favorites, in order
  changes [--since <iso|id>] [--path <path|id|url>] [--limit N] [--by people|ai|<agent>]
                                   --path brings the note's history under earlier names too;
                                   --by shows only people's changes, any agent's, or one agent's
  restore <change-id>              put a note back the way it was before that change
  mcp                              run the stdio MCP server

<note> can be a path, a path without .md, a [[wikilink]] name, a note ID or a note URL.
Writes are yours, unless an agent says it's the one writing: --agent <name> (or --as), or
$QUIRE_AGENT. Agents: set QUIRE_AGENT, so History shows your changes as "<agent> for you".
Vault: $QUIRE_VAULT (default: ./vault next to this tool).`;

const argv = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (["all", "json", "help", "archived"].includes(key) || next === undefined) flags[key] = true;
    else flags[key] = argv[++i];
  } else pos.push(a);
}
const [cmd, ...args] = pos;
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
/** A positive whole number from `--k`, or undefined if the flag is absent. */
const num = (k: string) => {
  const v = str(k);
  if (v === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(v)) throw new QuireError(`--${k} must be a positive whole number, not "${v}"`);
  return Number(v);
};
/** The i-th positional argument, which the command can't do without. */
const need = (i: number, name: string) => {
  if (args[i] === undefined) throw new QuireError(`${cmd} needs <${name}>`);
  return args[i];
};
const agent = str("agent") || str("as") || process.env.QUIRE_AGENT;
const source = agent ? agentSource(agent, LOCAL_USER) : LOCAL_USER;
const stdin = () => fs.readFileSync(0, "utf8");
const scope = flags.archived ? ("archived" as const) : flags.all ? ("all" as const) : ("active" as const);
const out = (text: string, data: unknown) => console.log(flags.json ? JSON.stringify(data, null, 2) : text);

if (cmd === "mcp") {
  await import("./mcp.ts");
} else if (!cmd || flags.help || cmd === "help") {
  console.log(HELP);
} else {
  try {
    const q = openVault();
    switch (cmd) {
      case "search": {
        const query = args.join(" ");
        const hits = q.search(query, num("limit") ?? 10, scope);
        out(fmtSearch(query, hits), hits);
        break;
      }
      case "read": {
        const n = q.read(need(0, "note"));
        out(fmtRead(n, num("offset"), num("limit")), n);
        break;
      }
      case "ls": {
        const notes = num("recent") ? q.recent(num("recent")) : q.list(args[0], scope);
        out(fmtList(notes), notes);
        break;
      }
      case "create": {
        const content = args[1] === undefined || args[1] === "-" ? stdin() : args.slice(1).join(" ");
        const r = q.create(need(0, "path"), content, source);
        out(fmtWrite(r, "Created"), r);
        break;
      }
      case "edit": {
        if (str("old") === undefined || str("new") === undefined) throw new QuireError("edit needs --old and --new");
        const r = q.edit(need(0, "note"), { oldString: str("old")!, newString: str("new")!, replaceAll: !!flags.all, baseVersion: str("base") }, source);
        out(fmtWrite(r, "Edited"), r);
        break;
      }
      case "append": {
        const text = args[1] === undefined || args[1] === "-" ? stdin() : args.slice(1).join(" ");
        const r = q.append(need(0, "note"), text, source);
        out(fmtWrite(r, "Appended to"), r);
        break;
      }
      case "mv": {
        const r = q.move(need(0, "note"), need(1, "new-path"), source);
        out(`Moved to ${r.path}.${r.updated.length ? ` Updated links in: ${r.updated.join(", ")}` : ""}`, r);
        break;
      }
      case "backlinks": {
        const links = q.backlinks(need(0, "note"));
        out(fmtBacklinks(args[0], links), links);
        break;
      }
      case "changes": {
        const cs = q.changes({ since: str("since"), path: str("path"), limit: num("limit") ?? 30, by: parseAuthorFilter(str("by")) });
        out(fmtChanges(cs), cs);
        break;
      }
      case "archive":
      case "unarchive": {
        const lines = args.map((a) => {
          const r = cmd === "archive" ? q.archive(a, source) : q.unarchive(a, source);
          return `${cmd === "archive" ? "Archived" : "Unarchived"} → ${r.path}`;
        });
        out(lines.join("\n"), lines);
        break;
      }
      case "star":
      case "unstar": {
        if (!args.length) throw new QuireError(`${cmd} needs <note>`);
        for (const a of args) cmd === "star" ? q.star(LOCAL_USER, a) : q.unstar(LOCAL_USER, a);
        const list = q.favorites(LOCAL_USER);
        out(fmtFavorites(list), list);
        break;
      }
      case "starred": {
        const list = q.favorites(LOCAL_USER);
        out(fmtFavorites(list), list);
        break;
      }
      case "restore": {
        const id = need(0, "change-id");
        if (!/^\d+$/.test(id)) throw new QuireError(`<change-id> must be a whole number, not "${id}"`);
        const r = q.restore(Number(id), source);
        out(fmtWrite(r, "Restored"), r);
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof QuireError ? e.message : e);
    process.exit(1);
  }
}
