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

Tools: `search_notes`, `read_note`, `list_notes`, `list_tags`, `list_tasks`, `get_today`, `add_task`, `update_task`, `move_task`, `read_board`, `add_card`, `move_card`, `edit_card`, `create_note`, `edit_note`, `append_to_note`, `move_note`, `archive_note`, `unarchive_note`, `delete_note`, `star_note`, `unstar_note`, `star_tag`, `unstar_tag`, `list_smart_folders`, `save_smart_folder`, `delete_smart_folder`, `backlinks`, `recent_changes`. The server sends `vault/AGENTS.md` as its instructions, so edit that file to change agent conventions.

### Connect an agent to a hosted workspace

Online, agents connect over MCP's Streamable HTTP at `https://commonink.app/mcp` (a Preview's is `https://pr-<number>-commonink.<subdomain>.workers.dev/mcp`). They sign in with OAuth 2.1, so there's no key to copy:

| Client | How |
| --- | --- |
| Claude (claude.ai, Desktop) | **Settings → Connectors → Add custom connector**, and paste the URL. |
| Claude Code | `claude mcp add --transport http commonink https://commonink.app/mcp`, then `/mcp` to sign in. |
| Cursor | Add `{"mcpServers": {"commonink": {"url": "https://commonink.app/mcp"}}}` to `.cursor/mcp.json`, then **Connect**. |
| Anything else | Point an MCP client that supports OAuth at the URL. It registers itself (dynamic client registration) and signs in with PKCE. |

The client opens Common Ink in your browser: sign in, pick the workspace it may use, and **Allow**. From then on it acts as you, with your role in that workspace at the time of each request: a viewer's agent only gets the read tools and starring. Its changes show in History as "Claude (via Audrow)". The same tools serve both kinds of connection (`src/core/tools.ts`). **Connected agents** in the account menu lists your agents, when each was last used and what it changed lately, and **Revoke** cuts one off at its next request.

## How edits from agents and you stay safe together

- **Edits are exact-string replacements** with an optional `base_version`. A stale edit fails with a clear message instead of clobbering anything.
- **Every write is attributed.** MCP writes carry the client's name, CLI writes use `--as`, and anything else (vim in a terminal, `sed`) is logged as `external` by the file watcher.
- **Changes on disk land in the editor as a diff**, so your cursor, undo history and vim mode survive. If you have unsaved typing, it does a three-way merge. Overlapping edits get a banner with Keep mine, Use theirs and Compare, which shows the two versions as a diff first; either choice comes with an Undo. An agent's edit comes with a toast whose Undo takes out just that edit and keeps what you've typed since. For a note that isn't open, Undo puts the note back only if nothing has changed it since.

## Editor

CodeMirror 6, with vim mode (`@replit/codemirror-vim`) behind the status bar's **Vim keys** toggle (off until you turn it on), plus:

- **Live preview.** Markup hides when your cursor leaves it. Checkboxes can be clicked, `#tags` show as chips (click one to see its notes), and tables and frontmatter render as cards.
- **Task details** are tokens at the end of a task's line, in the spirit of todo.txt: `- [ ] Send invoice due:2026-10-01 rec:monthly #work/clients @jane !high`. Also `start:` (hidden until then; `scheduled:` works too) and `done:`, which ticking adds and unticking takes off. Off the cursor's line they show as chips (a date pill that turns red when overdue, a repeat mark, a person, a priority flag). Chips look and work the same in the Tasks view, `::tasks`, Notes cards and the editor: each opens its own editor (priority, a due date with quick picks, a repeat, a person) and rewrites only its token, and chips always show in one order (priority, due, repeat, person, tags). Every task also has a ⚙ menu listing all its fields, set or not; a new one goes in at its place among the tokens. In task lists, click a task's words to edit them in place (Enter or leaving saves, Escape cancels; only the words change), and the ↗ button or ⌘/Ctrl-click opens the note at that line. In the editor, the ⚙ sits at the end of the cursor's task line (with a faint "due · repeat · @ · # · !" hint while it has no tokens), and typing `due:`, `start:`, `rec:`, `!` or `@` on a task line offers values. Tasks group by note, due date, priority, tag or person. One parser (`src/core/tasks.ts`) serves the editor, the server, MCP (`list_tasks`, `update_task`) and the CLI (`quire tasks`, `quire task`).
- **Repeating tasks** (`src/core/recurrence.ts`): `rec:` is one token that follows RFC 5545's date math. From the due date: `weekly`, `2w`, `mon,thu`, `2w-mon,thu`, `6th`, `last-day`, `1st-tue,3rd-tue`, `last-fri`, `mar-1`, `1st-mon-mar`, `day-50`, or any `RRULE:FREQ=…`; a bill due on the 6th and paid on the 4th is next due on the 6th. `after-1m` counts from the day it's done instead (dog medicine given on the 8th is next due on the 8th). Ticking one marks it `done:` and adds the next occurrence directly below (its `start:` moves by as much); unticking straight after takes it back. A repeat can end: `until:2027-06-30` (no occurrence after that day) or `times:3` (three more, this one included; each tick counts it down, and the last makes none), and an RRULE's `COUNT`/`UNTIL` read the same. The chip says so ("Monthly · 5 left"), and the repeat editor has an Ends row. The repeat chip's editor has quick picks, Skip this one, Stop repeating, and a full form with a plain-English summary and the next dates.
- **Quick-add** (`src/core/quickAdd.ts`): the bar at the top of Tasks, or ⌘⇧. (Ctrl+Shift+. off a Mac) from anywhere, the editor in any Vim mode included, takes a task the way you'd say it: "Pay rent every month on the 1st #home" → `- [ ] Pay rent due:2026-10-01 rec:1st #home`. Dates ("tomorrow", "next fri", "oct 3", "in 2 weeks"), starts ("starting monday") and repeats ("every other week", "last friday of the month", "every 3 days after done") light up as you type, the chips below show what will be written, and clicking a lit phrase keeps it as words. `#` and `@` suggest tags and people. It goes under `## Tasks` in today's daily note (`Journal/YYYY-MM-DD.md`, made if needed), or into the note named with `→ [[Note]]`. A task's ⚙ menu has "Move to…" to file it in another note. Opened from a note, Tab switches where it goes between today's daily note and that note. With Vim on, the bar's field is Vim too (Esc to normal mode, Esc again closes, Enter adds). MCP `add_task` / `move_task` and `quire task add "…"` / `quire task move` use the same parser and rules. The bar's field is the one task input (`web/src/taskInput.ts`) used wherever a task is typed: the Tasks page's inline edit and a Kanban card's add and edit fields read phrases the same way, with the same highlights, chips, suggestions and Vim keys (phrases already in a task you open for editing stay words). In a note, the phrases on the cursor's task line get a dotted underline; Tab right after one, or a click on one, turns it into tokens as one change that one undo takes back, and nothing changes otherwise.
- **Shortcuts follow the character you type**, not where the key sits, so they work on any keyboard layout: ⌘⇧. is whichever key types "." (on Dvorak, the E key). ⌘ on a Mac is Ctrl elsewhere. App shortcuts go through one helper, `matchKeys(e, "Mod-Shift-.")` in `web/src/keys.ts` (keys written as CodeMirror writes them, as in the command registry), with `formatKeys` to show them. For ⌥ combinations on a Mac, which type symbols, it asks the browser's layout map which character the key types.
- **Today** sits at the top of Tasks, under the quick-add bar: today's journal note (open it, or start it from `Templates/Daily note.md`, where `{{date}}` becomes the day), then open tasks overdue, due today and starting today (repeating ones show their rule), with empty sections left out. Those tasks aren't listed again below. Narrowed to a tag or a person, Tasks shows just the list. The same view is a `::today` widget for dashboards, MCP `get_today` and `quire today`, all from one core function (`Quire.today`).
- **Kanban boards** (`src/core/kanban.ts`) are a block in any note, with text above and below: a `:::kanban` line, `## Column` headings with cards (list items, tasks or not) under them, and a closing `:::`. Drag cards and columns, or move a focused card with Alt+arrows; every change is one edit of the markdown, so it autosaves and Cmd-Z undoes it. A card moved into the column named `Done` (or the one `done=` names) is ticked. A card that is a `[[link]]` shows the note's title and progress, and "Open as note" turns a card into one. `/Kanban board` inserts one, and `::kanban{note="Launch"}` or `![[Launch]]` shows another note's board live. Agents use MCP `read_board`, `add_card`, `move_card` and `edit_card`, or `quire board` and `quire card`.
- **Split view.** Two notes side by side, each pane with its own back and forward. ⌘-click (Ctrl-click off a Mac) a link, card, task, backlink or starred note to open it to the side, drag a note to the right edge, or press `⌘⌥\`. The focused pane leads the top bar, the side panel and the address bar, and a note shows in one pane at a time. The layout is kept per workspace in this browser.
- **Embeds.** `![[Note]]`, `![[Note#Heading]]`, `![[image.svg]]`, `![[page.html]]`, and YouTube links.
- **HTML notes** render in a sandboxed iframe with an opaque origin, both full-page and embedded (`⌘E` toggles source).
- **Search.** `⌘P` (or `⌘K`) is quick open: fuzzy name matching plus FTS5 full-text search. `⌘⇧P`, or `>` in quick open, lists commands (new note, go to Tasks, toggle theme, archive this note…), as in VS Code. Off a Mac, ⌘ is Ctrl. `?` (outside the editor) shows every keyboard shortcut. Both read one registry, `web/src/commands.ts`. `gd` follows the link under the cursor, `:w` saves, `:e name` opens a note.
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

## Notes, archive and Trash

- **Notes** (sidebar, `⌘⇧F`, or `:notes`) is home: it shows every note as a card, newest first, with a rendered preview. Notes tagged `start` (the Welcome note) sit on top, marked Start here, until you archive them or drop the tag; `AGENTS.md` comes after your own notes, marked Agent instructions. Type to filter (full-text), switch between Active, Archived and All, or narrow to a folder. It's keyboard-first: `j`/`k` to move, `↵` to open, `e` to archive, `x` to select several, `/` to filter.
- **The sidebar** leads with tags: the views (Notes, Tasks, Assets, History), then Favorites, Folders and Tags, each of which folds away from its header (remembered in this browser; Folders starts folded, since folders are storage and tags are how you find things). Tags is the tag tree with counts: nested tags open from their chevron, and clicking one opens Notes narrowed to it. Its header button opens the Tags page, for renaming and merging. Folders list no notes either: clicking one opens Notes narrowed to it. Drag a card from Notes onto a folder to move the note there, onto Favorites to star it, or onto Archive. New note puts the note at the top level, or in the folder Notes is showing.
- **Favorites** are the notes (and tags) you reach for, at the top of the sidebar. Star a tag with the same star notes have, on its row under Tags or beside the tag filter in Notes, or with `quire star '#work'` / MCP `star_tag`; clicking it opens Notes narrowed to that tag. A starred tag follows renames and merges, and drops out of sight while no note uses it. Star a note from its top bar, from its card in Notes (`s`), with `:star` in vim, `quire star <note…>`, or the MCP `star_note` tool. Drag favorites to reorder them, or drag a card from Notes onto Favorites to star it. Stars point at the note's stable ID, so they follow it through renames, moves and archiving. They're each person's own: stored beside the index locally, and per person in each workspace online, never in a note.
- **Tags** are `#tag` in a note (a task's tags go on its line) or `tags: [a, b]` in its frontmatter, and nest with `/`: `#work` includes `#work/clients/acme`. Case doesn't matter, and a tag shows the way it was first written. A `#` in a heading, code or a URL isn't a tag, and neither is `#27`. Typing `#` suggests tags, most used first. Notes, Tasks and Assets each have a Tag filter, and clicking a tag anywhere filters by it. The **Tags** page shows the tree with counts; renaming a tag there rewrites it in every note and asset (renaming onto an existing tag merges them), with Undo. Assets are tagged from their preview, and their tags live in `assets/.tags.json`. The index keeps a `tags` table (tag, kind, path, line) current with every write, so filters never re-read the vault.
- **Smart folders** are saved note queries in the sidebar, under Favorites, each with a live count: `tag=work/clients sort=title`, `folder=Projects q="launch"`. They use the same keys as `::query` (`q`, `folder`, `tag`, `sort`, `limit`), parsed by one parser (`src/core/query.ts`) and run by one engine (`Quire.feed`), which the Notes filter bar uses too, so the three can't drift. Make one with the + on the Smart folders header, or save the Notes filters or a `::query` widget's settings ("Save as smart folder"). The editor is the `::query` settings form, with a live count of matching notes. Clicking one opens Notes with its filters applied. A smart folder is shared with the workspace unless you choose **Just me**. They live in the workspace database next to favorites (`smart_folders`, where a null `owner` means shared). Online, a viewer can keep their own smart folders, but only editors and owners can create, change or delete shared ones.
- **Archive** moves a note to `Archive/<original path>`, which takes it out of the sidebar, search, `@` suggestions and agents' default listings. Links keep working. Archive from Notes (`e`, or in bulk), the top bar or `⌘⇧E` in a note, `:archive` in vim, `quire archive <note…>`, or the MCP `archive_note` tool. Every archive comes with Undo, and unarchiving puts the note back where it was.
- **Delete** sends notes, assets and folders to **Trash** for 30 days, then they're gone for good. Delete from a note's top bar, `:trash` in vim (`:delete` stays Vim's line delete), the Delete key or the bulk bar in Notes and Assets, a folder's trash icon in the sidebar, `quire delete <note…>`, or the MCP `delete_note` tool. Deleting comes with Undo, and asks first when other notes link to (or embed) what's going. Deleting a folder asks whether its notes go too or move up a level, with how many there are. **Trash** (under Archive in the sidebar) restores items where they were, or under a free name if that's taken, with their note IDs, so links and URLs work again. Delete forever and Empty trash ask first; online they're for workspace owners, and viewers don't see Trash. Agents can't delete for good. Deleted files wait in a hidden `.trash/<ms>-<change id>/` folder (in the vault locally, in the workspace's files table online), so nothing lists, searches or serves them. Deleting forever also takes the note's text out of the change log.

## Undo and recovery

Anything you can undo in the app says so in a toast at the bottom right: archiving, moving, ticking a task, an agent's edit, a conflict's choice. A toast stays while the pointer or the keyboard focus is on it, and one with an Undo stays 10 seconds. ⌘Z (Ctrl+Z off a Mac) presses the newest Undo while you aren't typing in the editor or a field, where their own undo comes first. Esc closes a focused toast. Screen readers hear each toast as it comes.

Every change in the log keeps the note's previous text. To put a note back the way it was before a change:

```bash
bin/quire changes --path "Journal/2026-09-27.md"
bin/quire restore 24
```

The server also refuses to replace a non-empty note with an empty one unless the editor says you cleared it yourself.

## Security notes

The server binds to 127.0.0.1 and checks the `Host` header to block DNS rebinding. Writes must come from its own origin and be JSON, which blocks cross-site requests and requests from sandboxed notes. The WebSocket checks `Origin`. Rendered markdown goes through DOMPurify. Vault assets are served with a `sandbox` CSP. HTML notes run in `/sandbox`, a page with its own `sandbox` policy, so their scripts get an opaque origin: no cookies, no API, no access to the app.

Online, every route has a least role that the Worker checks and the workspace checks again, sessions are `__Host-` cookies that expire and can be signed out everywhere, and every page gets a strict CSP with a fresh nonce. [docs/security/threat-model.md](docs/security/threat-model.md) lists what's protected, from whom, and what's still to do.

## Who can sign up

Online, new accounts are invite-only. Anyone can sign in with Google, but someone new gets an account only after they enter the sign-up code, or when they arrive through a workspace invite link. People who already have an account sign in as usual. The code is a Worker secret. Case and extra spaces don't matter, so it can be a phrase you say out loud:

```bash
npx wrangler secret put SIGNUP_CODE -c cloud/wrangler.jsonc    # set it or change it
npx wrangler secret delete SIGNUP_CODE -c cloud/wrangler.jsonc # no new accounts except by invite
```

With no code set, sign-ups are closed. Each Google account gets 5 wrong tries a day, so the code can't be guessed. Developer sign-in (local and Previews) skips the gate.

## Testing

```bash
npm test        # node:test over test/*.test.ts
npm run check   # both typechecks, then the tests
```

The tests run the real surfaces against throwaway vaults: the core and the shared API in-process, and the server, CLI and MCP server as child processes. The online Worker runs locally in workerd (`test/cloud.ts`, through Wrangler's test harness), with its own empty D1, R2 and Durable Objects. These switches make that possible, and work just as well by hand:

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

Suggestion mode (accept or reject agent edits), git auto-commits authored by each agent, semantic search (`sqlite-vec`), Yjs multiplayer, and an MCP App version of the editor.
