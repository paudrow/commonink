# Quire (prototype)

Local-first markdown notes that any agent can work in: **outside-in**, with no model inside the app. Agents come to your notes through MCP, a CLI, or plain files, and every change they make shows up live in the editor, highlighted and attributed.

```
            vault/  (*.md, *.html, assets)   ← source of truth
                          │
   ┌──────────── core  (src/core/quire.ts) ────────────┐
   │ SQLite FTS5 index · link graph · change log        │
   │ search / read / edit(exact + version) / move       │
   └──────┬───────────────┬───────────────┬─────────────┘
     web editor      MCP server       quire CLI
   (src/server)      (src/mcp.ts)     (src/cli.ts)
```

## Run it

```bash
npm install
npm run dev          # http://localhost:4777
npm run agent-demo   # in another terminal: an MCP client edits the roadmap while you watch
```

Needs Node 22.13+ (uses the built-in `node:sqlite`). The vault defaults to `./vault` (copy `examples/vault` to start fresh); point `QUIRE_VAULT` at any folder of markdown to use your own.

## Connect an agent

| Client | How |
| --- | --- |
| Claude Code (in this folder) | `.mcp.json` registers the server, and `.claude/skills/quire` teaches the CLI |
| Claude Code (anywhere) | `claude mcp add quire -- /path/to/quire/bin/quire mcp` |
| Claude Desktop, Cursor, … | stdio server: command `/path/to/quire/bin/quire`, args `["mcp"]` |
| Shell agents / scripts | `bin/quire --help`, and pass `--as <name>` so writes are attributed |

Tools: `search_notes`, `read_note`, `list_notes`, `list_tags`, `list_tasks`, `get_today`, `add_task`, `update_task`, `move_task`, `create_note`, `edit_note`, `append_to_note`, `move_note`, `archive_note`, `unarchive_note`, `star_note`, `unstar_note`, `star_tag`, `unstar_tag`, `backlinks`, `recent_changes`. The server sends `vault/AGENTS.md` as its instructions, so edit that file to change agent conventions.

## How edits from agents and you stay safe together

- **Edits are exact-string replacements** with an optional `base_version`. A stale edit fails with a clear message instead of clobbering anything.
- **Every write is attributed.** MCP writes carry the client's name, CLI writes use `--as`, and anything else (vim in a terminal, `sed`) is logged as `external` by the file watcher.
- **Changes on disk land in the editor as a diff**, so your cursor, undo history and vim mode survive. If you have unsaved typing, it does a three-way merge. Overlapping edits get a Keep mine / Use theirs banner. Press `u` to undo an agent's edit.

## Editor

CodeMirror 6 with vim mode (`@replit/codemirror-vim`), plus:

- **Live preview.** Markup hides when your cursor leaves it. Checkboxes can be clicked, `#tags` show as chips (click one to see its notes), and tables and frontmatter render as cards.
- **Task details** are tokens at the end of a task's line, in the spirit of todo.txt: `- [ ] Send invoice due:2026-10-01 rec:monthly #work/clients @jane !high`. Also `start:` (hidden until then; `scheduled:` works too) and `done:`, which ticking adds and unticking takes off. Off the cursor's line they show as chips (a date pill that turns red when overdue, a repeat mark, a person, a priority flag). Chips look and work the same in the Tasks view, `::tasks`, Notes cards and the editor: each opens its own editor (priority, a due date with quick picks, a repeat, a person) and rewrites only its token, and chips always show in one order (priority, due, repeat, person, tags). Every task also has a ⚙ menu listing all its fields, set or not; a new one goes in at its place among the tokens. In task lists, click a task's words to edit them in place (Enter or leaving saves, Escape cancels; only the words change), and the ↗ button or ⌘/Ctrl-click opens the note at that line. In the editor, the ⚙ sits at the end of the cursor's task line (with a faint "due · repeat · @ · # · !" hint while it has no tokens), and typing `due:`, `start:`, `rec:`, `!` or `@` on a task line offers values. Tasks group by note, due date, priority, tag or person. One parser (`src/core/tasks.ts`) serves the editor, the server, MCP (`list_tasks`, `update_task`) and the CLI (`quire tasks`, `quire task`).
- **Repeating tasks** (`src/core/recurrence.ts`): `rec:` is one token that follows RFC 5545's date math. From the due date: `weekly`, `2w`, `mon,thu`, `2w-mon,thu`, `6th`, `last-day`, `1st-tue,3rd-tue`, `last-fri`, `mar-1`, `1st-mon-mar`, `day-50`, or any `RRULE:FREQ=…`; a bill due on the 6th and paid on the 4th is next due on the 6th. `after-1m` counts from the day it's done instead (dog medicine given on the 8th is next due on the 8th). Ticking one marks it `done:` and adds the next occurrence directly below (its `start:` moves by as much); unticking straight after takes it back. The repeat chip's editor has quick picks, Skip this one, Stop repeating, and a full form with a plain-English summary and the next dates.
- **Quick-add** (`src/core/quickAdd.ts`): the bar at the top of Tasks, or `q` anywhere you aren't typing, takes a task the way you'd say it: "Pay rent every month on the 1st #home" → `- [ ] Pay rent due:2026-10-01 rec:1st #home`. Dates ("tomorrow", "next fri", "oct 3", "in 2 weeks"), starts ("starting monday") and repeats ("every other week", "last friday of the month", "every 3 days after done") light up as you type, the chips below show what will be written, and clicking a lit phrase keeps it as words. `#` and `@` suggest tags and people. It goes under `## Tasks` in today's daily note (`Journal/YYYY-MM-DD.md`, made if needed), or into the note named with `→ [[Note]]`. A task's ⚙ menu has "Move to…" to file it in another note. MCP `add_task` / `move_task` and `quire task add "…"` / `quire task move` use the same parser and rules.
- **Today**: the day at a glance, first in the sidebar. Open tasks overdue, due today and starting today (repeating ones show their rule), then today's journal note (open it, or start it from `Templates/Daily note.md`, where `{{date}}` becomes the day), with the quick-add bar on top. It's also a `::today` widget for dashboards, MCP `get_today` and `quire today`, all from one core function (`Quire.today`). "Start on Today" on the page makes it where the app opens, in that browser; Notes is the default.
- **Embeds.** `![[Note]]`, `![[Note#Heading]]`, `![[image.svg]]`, `![[page.html]]`, and YouTube links.
- **HTML notes** render in a sandboxed iframe with an opaque origin, both full-page and embedded (`⌘E` toggles source).
- **Search.** `⌘K` does fuzzy name matching plus FTS5 full-text search. `gd` follows the link under the cursor, `:w` saves, `:e name` opens a note.
- **Typing helpers.** `/` opens tools (embeds, widgets, blocks, dates), `@` links a note (people plug into the same menu later), and `[[` completes note names.
- **Widgets** are one markdown line (generic-directive syntax), so agents can write them too. The sliders button edits the args in place. See `Dashboards/Overview.md` for all of them together.
  - `::tasks{folder=… note=… tag=… assignee=… due<=today}` rolls up checkboxes from across the vault, grouped by note (or by due date, priority, tag or person) with a progress bar. Ticking one edits the note it lives in, and the list updates as notes change.
  - `::query{q=… folder=… tag=… limit=…}` is a live list of matching notes, good for dashboards.
  - `::calendar{folder=Journal}` shows a month of daily notes, shaded by how much you wrote, with your streak. Click a day to open it, or to start it.
  - `::timer{duration=25m label="Focus"}` and `::stopwatch{label="Run"}` keep their running state (time left, laps) in the browser, keyed by `id`, so they don't churn the file. Timers chime and notify even when their note isn't open.
- **Diagrams.** A ```mermaid block renders inline in the app's colors (Mermaid is loaded only when a note has one). Move into it to edit the code, with the diagram re-rendering live underneath.
- **Pasting a link** on its own line embeds it. YouTube, Vimeo, Loom, X, Bluesky, Mastodon, Instagram, TikTok and Spotify play inline, and other pages become link cards (the server fetches their OpenGraph tags, public hosts only). Pasting over selected text makes `[text](url)`, and `<url>` keeps a plain link.

## Links to notes

Every note has a stable ID, so its address is `/notes/<title>-<id>` (e.g. `/notes/quire-roadmap-8nvfq4ju`). The title part is only for people: the ID finds the note after renames, moves and archiving, and a link with an old title still opens it (and the address bar corrects it). The ID lives in the index, not the file. The index keeps it through moves in the app and through renames made outside it (`mv`, another editor). The MCP tools and the CLI accept an ID or a note URL anywhere they take a note. Old `#/path` links still open. The change log records each change's note ID too, so a note's history (the History page, `quire changes --path`, `recent_changes`) includes what happened to it under earlier names.

Online, IDs are unique across all workspaces. Each workspace claims its notes' IDs in the directory (`note_ids` in D1), so a note's link opens it from any workspace you belong to: the app switches to the note's workspace. People who can't open it get the same "doesn't exist" answer as for a made-up ID.

## Notes and archive

- **Notes** (sidebar, `⌘⇧F`, or `:notes`) is home: it shows every note as a card, newest first, with a rendered preview. Type to filter (full-text), switch between Active, Archived and All, or narrow to a folder. It's keyboard-first: `j`/`k` to move, `↵` to open, `e` to archive, `x` to select several, `/` to filter.
- **The sidebar** leads with tags: the views (Notes, Tasks, Assets, History), then Favorites, Folders and Tags, each of which folds away from its header (remembered in this browser; Folders starts folded, since folders are storage and tags are how you find things). Tags is the tag tree with counts: nested tags open from their chevron, and clicking one opens Notes narrowed to it. Its header button opens the Tags page, for renaming and merging. Folders list no notes either: clicking one opens Notes narrowed to it. Drag a card from Notes onto a folder to move the note there, onto Favorites to star it, or onto Archive. New note puts the note at the top level, or in the folder Notes is showing.
- **Favorites** are the notes (and tags) you reach for, at the top of the sidebar. Pin a tag from its row under Tags or from the tag filter in Notes, or `quire star '#work'` / MCP `star_tag`; clicking it opens Notes narrowed to that tag. A pinned tag follows renames and merges, and drops out of sight while no note uses it. Star a note from its top bar, from its card in Notes (`s`), with `:star` in vim, `quire star <note…>`, or the MCP `star_note` tool. Drag favorites to reorder them, or drag a card from Notes onto Favorites to star it. Stars point at the note's stable ID, so they follow it through renames, moves and archiving. They're each person's own: stored beside the index locally, and per person in each workspace online, never in a note.
- **Tags** are `#tag` in a note (a task's tags go on its line) or `tags: [a, b]` in its frontmatter, and nest with `/`: `#work` includes `#work/clients/acme`. Case doesn't matter, and a tag shows the way it was first written. A `#` in a heading, code or a URL isn't a tag, and neither is `#27`. Typing `#` suggests tags, most used first. Notes, Tasks and Assets each have a Tag filter, and clicking a tag anywhere filters by it. The **Tags** page shows the tree with counts; renaming a tag there rewrites it in every note and asset (renaming onto an existing tag merges them), with Undo. Assets are tagged from their preview, and their tags live in `assets/.tags.json`. The index keeps a `tags` table (tag, kind, path, line) current with every write, so filters never re-read the vault.
- **Archive** moves a note to `Archive/<original path>`, which takes it out of the sidebar, search, `@` suggestions and agents' default listings. Links keep working. Archive from Notes (`e`, or in bulk), the top bar or `⌘⇧E` in a note, `:archive` in vim, `quire archive <note…>`, or the MCP `archive_note` tool. Every archive comes with Undo, and unarchiving puts the note back where it was.

## Undo and recovery

Every change in the log keeps the note's previous text. To put a note back the way it was before a change:

```bash
bin/quire changes --path "Journal/2026-09-27.md"
bin/quire restore 24
```

The server also refuses to replace a non-empty note with an empty one unless the editor says you cleared it yourself.

## Security notes

The server binds to 127.0.0.1 and checks the `Host` header to block DNS rebinding. Writes must come from its own origin and be JSON, which blocks cross-site requests and requests from sandboxed notes. The WebSocket checks `Origin`. Rendered markdown goes through DOMPurify. Vault assets are served with a `sandbox` CSP, and HTML files are never served from the app's origin.

## Testing

```bash
npm test        # node:test over test/*.test.ts
npm run check   # both typechecks, then the tests
```

The tests run the real surfaces against throwaway vaults: the core and the shared API in-process, and the server, CLI and MCP server as child processes. These switches make that possible, and work just as well by hand:

| Lever | What it does |
| --- | --- |
| `QUIRE_VAULT=<dir>` | The vault the server, CLI and MCP server open. |
| `PORT=0` | The server picks a free port and prints it. |
| `QUIRE_NO_UI=1` | The server serves only `/api` and skips Vite, so it starts in well under a second. |
| `QUIRE_AGENT=<name>` | Who CLI and MCP writes are attributed to. |
| `openVault(dir, { now })` | A fake clock for change timestamps and the attribution window. |
| `tempVault(files)` in `test/helpers.ts` | A fresh vault folder holding the given files, removed when the tests exit. |

## Pull request previews

Every pull request gets its own copy of the online app at `https://pr-<number>-commonink.<subdomain>.workers.dev`. CI deploys it with [Worker Previews](https://developers.cloudflare.com/workers/previews/), links it from one comment on the PR that each push updates (and from the PR's "View deployment" button), and deletes it when the PR closes. A Preview opens already signed in as a developer, so there's no Google step. `scripts/preview-demo.ts` fills it with the sample vault, a note with history across a rename, favorites where the branch has them, and a **Try this PR** note on top with the PR's description. Each Preview has its own Durable Objects, so its own notes. The directory and uploads use preview-only D1 (`commonink-preview`) and R2 (`commonink-preview-files`), never production's. Previews are public, so put nothing real in them.

```bash
npm run cloud:preview -- --name my-branch                  # deploy one by hand
node --import tsx scripts/preview-demo.ts <preview-url>    # then fill it
```

## Not built yet

Suggestion mode (accept or reject agent edits), git auto-commits authored by each agent, semantic search (`sqlite-vec`), remote MCP over Streamable HTTP with OAuth, Yjs multiplayer, and an MCP App version of the editor.
