// `quire` CLI — the same core as the MCP server, for agents that prefer a shell (and for you).
import fs from "node:fs";
import { LOCAL_USER, openVault } from "./core/local.ts";
import { QuireError } from "./core/paths.ts";
import { fmtBacklinks, fmtBoards, fmtChanges, fmtContact, fmtContactLine, fmtFavorites, fmtList, fmtRead, fmtSearch, fmtSmartFolders, fmtTags, fmtTasks, fmtToday, fmtTrash, fmtWrite } from "./core/format.ts";
import { matchContacts } from "./core/contacts.ts";
import { parseQuery } from "./core/query.ts";
import { fmtTemplate } from "./core/tools.ts";
import { agentSource, parseAuthorFilter } from "./core/actor.ts";
import { EXPORT_FORMATS, type ExportFormat } from "./core/export.ts";
import { Calendar, dayRange, fetchFeed, fmtEvent, fmtEvents, fmtSources } from "./core/calendar.ts";
import { assertPublic } from "./server/unfurl.ts";

const HELP = `quire — markdown notes for you and your agents

Usage: quire <command> [args] [--agent <name>] [--json]

  search <query…> [--tag T] [--limit N] [--archived|--all]
                                   full-text search (prefix matching)
  read <note> [--offset N] [--limit N]
  ls [folder] [--tag T] [--recent N] [--archived|--all]
  tags                             every tag, nested, with what carries it
                                   (--tag work also matches #work/acme)
  tasks [--tag T] [--assignee P] [--due '<=today'] [--done|--all]
                                   open tasks (tokens: due: start: rec: #tag @person !high)
  today [--date YYYY-MM-DD]        the day at a glance: overdue, due today, starting today,
                                   and today's journal note
  task add "<task>"                add a task in words: "Pay rent every month on the 1st #home",
                                   "Call mom tomorrow → [[Family]]"; it goes in today's daily
                                   note (Journal/YYYY-MM-DD.md) or the → [[note]]
  task move <note> <line> --to <note>
                                   move a task (and what's nested under it) to another note
  task <note> <line> [--done|--undone] [--due D] [--start D] [--rec R]
       [--until D] [--times N] [--priority high|low] [--assignee P,…] [--tag T,…] [--skip]
                                   tick a task or change its tokens; "none" clears one.
                                   --rec weekly, 6th, 1st-tue, after-1m (from done)…;
                                   --until and --times end a repeat (last day, times left);
                                   --skip moves a repeating task to its next date
  contacts [--q words] [--tag T] [--company C]
                                   people: notes in People/ with email, phone, company, role,
                                   links, aliases and tags in their frontmatter
  contact <name>                   one person, and the notes that mention them
  contact add <name> [--email a,b] [--phone P,…] [--company C] [--role R]
       [--link URL,…] [--alias A,…] [--tag T,…]
  contact <name> [--email …] [--company …] …
                                   change their details (a list flag replaces that list)
  contacts import <file.vcf|file.csv> [--format vcard|csv]
                                   add people from an export; ones already here (same email
                                   or name) get what's new
  contacts merge <keep> <drop>     one person with two notes: <drop>'s details and links move to
                                   <keep>, and <drop> goes to Trash
  templates                        note templates: notes in Templates/ with {{placeholders}}
  new --template <name> [--title T] [--folder F] [--var Label=value …]
                                   a note from a template; --var answers its {{ask:Label}}s
  board <note>                     the note's Kanban boards (:::kanban blocks), cards with line numbers
  card add <note> <column> <text…> [--board N] [--position N]
  card move <note> <card> <column> [--position N]
  card edit <note> <card> [--text T] [--done|--undone]
                                   <card> is a line number from \`board\`, or words only its text has
  archive <note…>                  move notes to Archive/ (links keep working)
  unarchive <note…>                move archived notes back
  delete <note…>                   move notes or assets to Trash (restorable for 30 days)
  trash                            what's in Trash, newest first, with ids
  trash restore <id…>              put Trash items back where they were
  create <path> [content | -]      '-' or no content reads stdin
  edit <note> --old <s> --new <s> [--all] [--base <version>]
  append <note> [text | -]
  mv <note> <new-path>             rewrites links to the note
  backlinks <note>
  star <note…> / unstar <note…>    add to or take out of your favorites ('#tag' for a tag)
  starred                          list your favorites, in order
  smart [name]                     your smart folders, or the notes in one
  smart-save <name> [query…] [--just-me] [--id ID]
                                   save a note query (q="…" folder=… tag=… sort=title)
  smart-rm <name>                  delete a smart folder
  changes [--since <iso|id>] [--path <path|id|url>] [--limit N] [--by people|ai|<agent>]
                                   --path brings the note's history under earlier names too;
                                   --by shows only people's changes, any agent's, or one agent's
  restore <change-id>              put a note back the way it was before that change
  export <note|folder|/> --format md|html|docx|zip [--out <file>|-]
                                   a note as its markdown, one web page or a Word document, or
                                   notes as a .zip with their files, folders kept and links that
                                   work in Obsidian ("/" is every note); --out - writes to stdout
  events [--from YYYY-MM-DD] [--days N] [--query words] [--tz Zone]
                                   calendar events, soonest first (default: the next 7 days);
                                   feeds that are due are read first
  event <id>                       one event in full, with its meeting note
  meeting-note <id> [--tz Zone]    the event's meeting note in Meetings/, made and linked if new
  calendars                        the calendars (ICS feeds) this vault subscribes to
  calendars add <url> [--name N]   subscribe to an ICS or webcal feed
  calendars refresh | remove <id>  read every feed again now, or unsubscribe from one
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
    if (["all", "json", "help", "archived", "done", "undone", "skip", "just-me"].includes(key) || next === undefined) flags[key] = true;
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
/** A comma-separated list from `--k` ("none" or "" for an empty one), or undefined if the flag is absent. */
const list = (k: string) => {
  const v = str(k);
  if (v === undefined) return undefined;
  return v === "none" ? [] : v.split(",").map((s) => s.trim()).filter(Boolean);
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
/** The vault's one person, who may change its calendars. */
const ME = { user: LOCAL_USER, canEdit: true };
const calendarOf = (q: ReturnType<typeof openVault>) => new Calendar(q.db, (url, last) => fetchFeed(url, last, assertPublic));

if (cmd === "mcp") {
  await import("./mcp.ts");
} else if (!cmd || flags.help || cmd === "help") {
  console.log(HELP);
} else {
  try {
    const q = openVault();
    switch (cmd) {
      case "export": {
        const target = need(0, "note|folder");
        const format = str("format") ?? "md";
        if (!EXPORT_FORMATS.includes(format as ExportFormat)) throw new QuireError(`--format must be one of ${EXPORT_FORMATS.join(", ")}`);
        const { localExporter } = await import("./server/export.ts");
        const file = await localExporter(q)(target, format as ExportFormat);
        const dest = str("out") ?? file.name;
        if (dest === "-") {
          process.stdout.write(file.data);
          break;
        }
        fs.writeFileSync(dest, file.data);
        out(`Wrote ${dest} (${file.data.byteLength} bytes)`, { path: dest, bytes: file.data.byteLength, mime: file.mime });
        break;
      }
      case "search": {
        const query = args.join(" ");
        const hits = q.search(query, num("limit") ?? 10, scope, str("tag"));
        out(fmtSearch(query, hits), hits);
        break;
      }
      case "today": {
        const t = q.today(str("date"));
        out(fmtToday(t), t);
        break;
      }
      case "tasks": {
        const tasks = q.tasks({ tag: str("tag"), assignee: str("assignee"), due: str("due") }).filter((t) => flags.all || t.done === !!flags.done);
        out(fmtTasks(tasks), tasks);
        break;
      }
      case "task": {
        if (args[0] === "add") {
          if (!args[1]) throw new QuireError('Say what the task is: quire task add "Call mom tomorrow"');
          const r = q.addTask(args.slice(1).join(" "), source);
          out(`Added "- [ ] ${r.text}" to ${r.path}:${r.line}`, r);
          break;
        }
        if (args[0] === "move") {
          const [note, line] = [need(1, "note"), Number(need(2, "line"))];
          const task = q.tasks({ note }).find((t) => t.line === line);
          if (!task) throw new QuireError(`There's no task on line ${args[2]} of ${note}`);
          const to = str("to");
          if (!to) throw new QuireError("task move needs --to <note>");
          const r = q.moveTask(note, line, task.text, to, source);
          out(`Moved "${r.text}" to ${r.path}:${r.line}`, r);
          break;
        }
        const note = need(0, "note");
        const line = Number(need(1, "line"));
        const task = q.tasks({ note }).find((t) => t.line === line);
        if (!task) throw new QuireError(`There's no task on line ${args[1]} of ${note}`);
        const one = (k: string) => (str(k) === undefined ? undefined : str(k) === "none" ? null : str(k));
        const list = (k: string) => (str(k) === undefined ? undefined : str(k) === "none" ? [] : str(k)!.split(",").map((s) => s.trim().replace(/^[@#]/, "")));
        const checked = flags.done ? true : flags.undone ? false : undefined;
        const patch = Object.fromEntries(
          Object.entries({ checked, due: one("due"), start: one("start"), rec: one("rec"), until: one("until"), times: str("times") === undefined ? undefined : str("times") === "none" ? null : Number(str("times")), priority: one("priority"), assignees: list("assignee"), tags: list("tag") }).filter(([, v]) => v !== undefined),
        );
        const r = flags.skip ? q.skipTask(note, line, task.text, source) : q.updateTask(note, line, task.text, patch, source);
        out(fmtWrite(r, r.change ? "Updated" : "No change to"), r);
        break;
      }
      case "contacts": {
        if (args[0] === "import") {
          const file = need(1, "file");
          const format = str("format") ?? (/\.vcf$/i.test(file) ? "vcard" : /\.csv$/i.test(file) ? "csv" : undefined);
          if (format !== "vcard" && format !== "csv") throw new QuireError("--format must be vcard or csv");
          const r = q.importContacts(fs.readFileSync(file, "utf8"), format, source);
          const line = (label: string, paths: string[]) => (paths.length ? [`${label} ${paths.length}: ${paths.join(", ")}`] : []);
          out([...line("Created", r.created), ...line("Updated", r.updated), ...line("Unchanged", r.unchanged)].join("\n") || "No contacts in that file.", r);
          break;
        }
        if (args[0] === "merge") {
          const r = q.mergeContacts(need(1, "keep"), need(2, "drop"), source);
          out(`Merged ${r.trashed[0].path} into ${r.path} (it's in Trash). Links updated in ${r.updated.length} note${r.updated.length === 1 ? "" : "s"}.`, { path: r.path, updated: r.updated, trashed: r.trashed.map((t) => t.path) });
          break;
        }
        if (args.length) throw new QuireError(`contacts takes import or merge, not "${args[0]}"`);
        const list = matchContacts(q.contacts(), { q: str("q"), tag: str("tag"), company: str("company") });
        out(list.length ? list.map(fmtContactLine).join("\n") : "No contacts match. People are notes in People/; `quire contact add <name>` makes one.", list);
        break;
      }
      case "contact": {
        const fields = {
          email: list("email"),
          phone: list("phone"),
          company: str("company"),
          role: str("role"),
          links: list("link"),
          aliases: list("alias"),
          tags: list("tag"),
        };
        const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (args[0] === "add") {
          if (!args[1]) throw new QuireError("contact add needs <name>");
          const r = q.createContact({ ...given, name: args.slice(1).join(" ") }, source);
          out(`Created ${r.path}. Link to them with [[${r.path.replace(/\.md$/, "")}]].`, { path: r.path });
          break;
        }
        const who = args.join(" ");
        if (!who) throw new QuireError("contact needs <name>");
        if (Object.keys(given).length) {
          const r = q.updateContact(who, given, source);
          out(r.change ? `Updated ${r.path} → version ${r.version}` : `${r.path} already says that`, { path: r.path, version: r.version });
          break;
        }
        const c = q.contact(who);
        out(fmtContact(c), c);
        break;
      }
      case "templates": {
        const list = q.templates();
        out(list.length ? list.map(fmtTemplate).join("\n") : "No templates yet. A template is any note in Templates/.", list);
        break;
      }
      case "new": {
        const template = str("template");
        if (!template) throw new QuireError("new needs --template <name>");
        // --var can be given more than once, so it's read from the arguments themselves.
        const answers: Record<string, string> = {};
        argv.forEach((a, i) => {
          if (a !== "--var" || argv[i + 1] === undefined) return;
          const [label, ...rest] = argv[i + 1].split("=");
          if (!rest.length || !label.trim()) throw new QuireError(`--var takes Name=value, not "${argv[i + 1]}"`);
          answers[label.trim()] = rest.join("=");
        });
        const r = q.createFromTemplate(template, { title: str("title"), folder: str("folder"), answers }, source);
        const from = q.templates().find((t) => t.name.toLowerCase() === template.toLowerCase() || t.path === template)?.path ?? template;
        out(`Created ${r.path} from ${from}.${r.unfilled.length ? ` Still to fill in: ${r.unfilled.map((u) => `{{${u}}}`).join(", ")}.` : ""}`, r);
        break;
      }
      case "board": {
        const { note, boards, unclosed } = q.boards(need(0, "note"));
        out(fmtBoards(note.path, boards, unclosed), { boards, unclosed });
        break;
      }
      case "card": {
        const [verb, note] = [need(0, "add|move|edit"), need(1, "note")];
        const r =
          verb === "add" ? q.addCard(note, need(2, "column"), args.slice(3).join(" "), source, { board: num("board"), position: num("position") })
          : verb === "move" ? q.moveCard(note, need(2, "card"), need(3, "column"), source, { position: num("position") })
          : verb === "edit" ? q.editCard(note, need(2, "card"), { text: str("text"), done: flags.done ? true : flags.undone ? false : undefined }, source)
          : null;
        if (!r) throw new QuireError(`card needs add, move or edit, not "${verb}"`);
        out(fmtWrite(r, r.change ? "Changed a card in" : "No change to"), r);
        break;
      }
      case "tags": {
        const tags = q.tags();
        out(fmtTags(tags), tags);
        break;
      }
      case "read": {
        const n = q.read(need(0, "note"));
        out(fmtRead(n, num("offset"), num("limit")), n);
        break;
      }
      case "ls": {
        const notes = num("recent") ? q.recent(num("recent")) : q.list(args[0], scope, str("tag"));
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
        out(fmtChanges(cs, q), cs);
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
      case "delete": {
        if (!args.length) throw new QuireError("delete needs <note>");
        const gone = q.delete(args, source);
        out(gone.map((d) => `Moved ${d.path} to Trash (${d.id})`).join("\n"), gone.map(({ id, path }) => ({ id, path })));
        break;
      }
      // Restoring only: deleting for good is for a person, in the app.
      case "trash": {
        if (args[0] === "restore") {
          if (args.length < 2) throw new QuireError("trash restore needs <id>");
          const back = q.untrash(args.slice(1), source);
          out(back.map((b) => `Restored ${b.path}`).join("\n"), back.map((b) => b.path));
          break;
        }
        if (args.length) throw new QuireError(`trash takes restore, not "${args[0]}"`);
        const items = q.trash();
        out(fmtTrash(items), items);
        break;
      }
      case "star":
      case "unstar": {
        if (!args.length) throw new QuireError(`${cmd} needs <note>`);
        for (const a of args) {
          if (a.startsWith("#")) cmd === "star" ? q.starTag(LOCAL_USER, a) : q.unstarTag(LOCAL_USER, a);
          else cmd === "star" ? q.star(LOCAL_USER, a) : q.unstar(LOCAL_USER, a);
        }
        const list = q.favorites(LOCAL_USER);
        out(fmtFavorites(list), list);
        break;
      }
      case "smart": {
        if (!args.length) {
          const list = q.smartFolders(LOCAL_USER);
          out(fmtSmartFolders(list), list);
          break;
        }
        const query = parseQuery(q.findSmartFolder(LOCAL_USER, args.join(" ")).query);
        const notes = q.feed({ ...query, limit: Infinity }).items;
        out(fmtList(notes), notes);
        break;
      }
      case "smart-save": {
        const f = q.saveSmartFolder(LOCAL_USER, { id: str("id"), name: need(0, "name"), query: args.slice(1).join(" "), shared: !flags["just-me"] }, true);
        out(fmtSmartFolders([f]), f);
        break;
      }
      case "smart-rm": {
        const list = q.deleteSmartFolder(LOCAL_USER, need(0, "name"), true);
        out(fmtSmartFolders(list), list);
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
      case "events": {
        const cal = calendarOf(q);
        await cal.syncDue();
        const zone = str("tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const range = dayRange(str("from"), num("days") ?? 7, zone);
        const events = cal.events(ME, { ...range, zone, q: str("query") });
        out(fmtEvents(events, cal.sources(ME), zone, range), events);
        break;
      }
      case "event": {
        const cal = calendarOf(q);
        const ev = cal.event(need(0, "id"), ME);
        if (!ev) throw new QuireError(`No event ${args[0]}; \`quire events\` lists them with their ids`);
        out(fmtEvent(ev, cal.sources(ME), str("tz") || Intl.DateTimeFormat().resolvedOptions().timeZone), ev);
        break;
      }
      case "meeting-note": {
        const r = calendarOf(q).meetingNote(q, need(0, "id"), ME, { timeZone: str("tz") || Intl.DateTimeFormat().resolvedOptions().timeZone, source });
        out(r.created ? `Created ${r.path}, linked to the event` : `The event already has a meeting note: ${r.path}`, { path: r.path, created: r.created });
        break;
      }
      case "calendars": {
        const cal = calendarOf(q);
        if (args[0] === "add") await cal.addIcs({ url: need(1, "url"), name: str("name") }, ME, source);
        else if (args[0] === "remove") cal.remove(need(1, "id"), ME);
        else if (args[0] === "refresh") await cal.refresh(ME);
        else if (args[0] !== undefined) throw new QuireError(`calendars takes add, refresh or remove, not "${args[0]}"`);
        const list = cal.sources(ME);
        out(fmtSources(list), list);
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
