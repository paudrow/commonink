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

Tools: `search_notes`, `read_note`, `list_notes`, `create_note`, `edit_note`, `append_to_note`, `move_note`, `backlinks`, `recent_changes`. The server sends `vault/AGENTS.md` as its instructions, so edit that file to change agent conventions.

## How edits from agents and you stay safe together

- **Edits are exact-string replacements** with an optional `base_version`. A stale edit fails with a clear message instead of clobbering anything.
- **Every write is attributed.** MCP writes carry the client's name, CLI writes use `--as`, and anything else (vim in a terminal, `sed`) is logged as `external` by the file watcher.
- **Changes on disk land in the editor as a diff**, so your cursor, undo history and vim mode survive. If you have unsaved typing, it does a three-way merge. Overlapping edits get a Keep mine / Use theirs banner. Press `u` to undo an agent's edit.

## Editor

CodeMirror 6 with vim mode (`@replit/codemirror-vim`), plus:

- **Live preview.** Markup hides when your cursor leaves it. Checkboxes can be clicked, and tables and frontmatter render as cards.
- **Embeds.** `![[Note]]`, `![[Note#Heading]]`, `![[image.svg]]`, `![[page.html]]`, and YouTube links.
- **HTML notes** render in a sandboxed iframe with an opaque origin, both full-page and embedded (`⌘E` toggles source).
- **Search.** `⌘K` does fuzzy name matching plus FTS5 full-text search. `gd` follows the link under the cursor, `:w` saves, `:e name` opens a note.
- **Typing helpers.** `/` opens tools (embeds, widgets, blocks, dates), `@` links a note (people plug into the same menu later), and `[[` completes note names.
- **Widgets** are one markdown line (generic-directive syntax), so agents can write them too. The sliders button edits the args in place. See `Dashboards/Overview.md` for all of them together.
  - `::tasks{folder=… note=…}` rolls up checkboxes from across the vault, grouped by note with a progress bar. Ticking one edits the note it lives in, and the list updates as notes change.
  - `::query{q=… folder=… tag=… limit=…}` is a live list of matching notes, good for dashboards.
  - `::calendar{folder=Journal}` shows a month of daily notes, shaded by how much you wrote, with your streak. Click a day to open it, or to start it.
  - `::timer{duration=25m label="Focus"}` and `::stopwatch{label="Run"}` keep their running state (time left, laps) in the browser, keyed by `id`, so they don't churn the file. Timers chime and notify even when their note isn't open.
- **Diagrams.** A ```mermaid block renders inline in the app's colors (Mermaid is loaded only when a note has one). Move into it to edit the code, with the diagram re-rendering live underneath.
- **Pasting a link** on its own line embeds it. YouTube, Vimeo, Loom, X, Bluesky, Mastodon, Instagram, TikTok and Spotify play inline, and other pages become link cards (the server fetches their OpenGraph tags, public hosts only). Pasting over selected text makes `[text](url)`, and `<url>` keeps a plain link.

## Links to notes

Every note has a stable ID, so its address is `/notes/<title>-<id>` (e.g. `/notes/quire-roadmap-8nvfq4ju`). The title part is only for people: the ID finds the note after renames, moves and archiving, and a link with an old title still opens it (and the address bar corrects it). The ID lives in the index, not the file. The index keeps it through moves in the app and through renames made outside it (`mv`, another editor). The MCP tools and the CLI accept an ID or a note URL anywhere they take a note. Old `#/path` links still open.

Online, IDs are unique across all workspaces. Each workspace claims its notes' IDs in the directory (`note_ids` in D1), so a note's link opens it from any workspace you belong to: the app switches to the note's workspace. People who can't open it get the same "doesn't exist" answer as for a made-up ID.

## Notes and archive

- **Notes** (sidebar, `⌘⇧F`, or `:notes`) is home: it shows every note as a card, newest first, with a rendered preview. Type to filter (full-text), switch between Active, Archived and All, or narrow to a folder. It's keyboard-first: `j`/`k` to move, `↵` to open, `e` to archive, `x` to select several, `/` to filter.
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
