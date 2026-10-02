---
title: Tips
tags: [tour]
---

# Tips

Common Ink is a **local-first** notebook. Every note is a plain markdown file in `vault/`, and any agent that speaks *MCP* (or just has a shell) can search, read and edit it right alongside you.

![[margin.svg]]

## Writing

Markup tucks itself away when your cursor leaves it: **bold**, *italic*, ~~struck~~, `inline code`, and [links](https://modelcontextprotocol.io). Move your cursor into any of them to see the source.

> Notes are files. Agents are guests. You stay in charge of both.

- Bullets become bullets
- [ ] Tasks become checkboxes. Click one
- [x] Finished tasks fade back

## Linking and embedding

Link with [[Outside-in agents]], or embed a note (or just one section of it) with `![[…]]`:

![[Common Ink roadmap#Next]]

HTML notes render in a sandbox, even when embedded:

![[Reading stats.html]]

## Widgets and tools

Type `/` for tools (embeds, timers, tables, dates) and `@` to link a note. Widgets are one line of markdown, so agents can add them too. Press the sliders button to configure one.

::timer{duration=25m label="Focus"}

::stopwatch{label="Run"}

Paste a link on its own line to embed it: YouTube, Vimeo, Loom, X, Bluesky, Mastodon, Instagram, TikTok and Spotify play inline, and any other page becomes a link card. Wrap it as `<https://…>` to keep a plain link.

https://www.youtube.com/watch?v=aircAruvnKk

https://modelcontextprotocol.io/specification/2026-07-28/changelog
https://x.com/bridgemindai/status/2104242319037804728

## Code and tables

```ts
const hits = commonink.search("embeds", 10);
for (const hit of hits) console.log(hit.path, hit.lines);
```

| Surface     | Who uses it                    | Talks to     |
| ----------- | ------------------------------ | ------------ |
| Web editor  | you                            | local server |
| MCP server  | Claude, Cursor, Codex, …       | the vault    |
| `commonink` CLI | shell agents, scripts, you     | the vault    |

## Keys

Off a Mac, read `⌘` as `Ctrl`. Press `?` for every shortcut.

- `⌘K` search and jump between notes
- `⌘Z` takes back the last change in a note, an agent's included
- Vim keys: turn them on in Settings (`⌘,`) or with "Turn vim keys on" in `⌘⇧P`
- `/` inserts tools and widgets, `@` links a note, `[[` completes note names
- `gd` follows the link under the cursor (vim), `:w` saves, `:e name` opens a note
- `⌘\` toggles the info panel (outline, backlinks and activity); `⌘E` flips an HTML note between preview and source
