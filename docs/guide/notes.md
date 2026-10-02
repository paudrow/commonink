---
title: Writing notes
description: Links, tags, tasks, boards, templates and widgets in Common Ink.
---

# Writing notes

A note is a markdown file. The editor hides the markup when your cursor leaves it, so it reads like a page and edits like text. Type `/` for blocks, widgets and dates.

## Links and embeds

- `[[Note name]]` links a note; typing `[[` suggests names. `@` links a note or a person.
- `![[Note]]` shows another note inline, `![[Note#Heading]]` one section of it, and `![[picture.png]]` a file.
- Paste a link on its own line to embed it: YouTube, Vimeo, Loom, X, Bluesky, Spotify and others play inline, and other pages become link cards.
- Every note has a stable address, so links and bookmarks keep working after renames and moves. Renaming a note (change its first `# heading`) rewrites links to it.

## Tags

`#tag` anywhere in a note, or `tags: [a, b]` in its frontmatter. Tags nest with `/`: `#work` includes `#work/clients/acme`. The sidebar lists them with counts, and clicking one shows its notes. Rename a tag on the **Tags** page and it changes in every note, with Undo.

## Tasks

A task is a checkbox line with details at the end:

```markdown
- [ ] Send invoice due:2026-10-01 rec:monthly #work/clients @jane !high
```

| Token | Meaning |
| --- | --- |
| `due:2026-10-01` | Due date; turns red when overdue |
| `start:2026-09-28` | Hidden until then |
| `rec:monthly` | Repeats: `weekly`, `2w`, `mon,thu`, `last-fri`, `1st-tue`, `after-1m` and more |
| `@jane` | Assigned to a person or a workspace member |
| `!high` | Priority |
| `#tag` | Tags, as in notes |

Off the cursor's line these show as chips you can click to change. **Quick add** (⌘⇧.) takes a task in plain words: "Pay rent every month on the 1st #home" is written as the line above would be. It lands in today's daily note unless you name another with `→ [[Note]]`.

**Tasks** lists every task in your notes, with **Today** on top: today's daily note, then what's overdue, due and starting today, and today's calendar events. Ticking a repeating task adds the next one below it.

## Daily notes and templates

Today's daily note is `Journal/YYYY-MM-DD.md`, started from `Templates/Daily note.md` if you have one. A template is any note in `Templates/`, with placeholders like `{{date:dddd, MMMM D}}`, `{{title}}`, `{{cursor}}` and `{{ask:Client}}`, which asks you before the note is made. The [templates reference](https://github.com/paudrow/commonink/blob/main/docs/templates.md) lists every option.

## Boards

A board is a block in any note:

```markdown
:::kanban
## To do
- Draft the launch post
## Doing
- [[Landing page]]
## Done
:::
```

Drag cards and columns; each move is one edit to the note, so it saves and undoes like typing. A card moved into **Done** is ticked. `/Kanban board` inserts one.

## Widgets

Widgets are one line of markdown, so agents can write them too:

- `::tasks{tag=work due<=today}` rolls up tasks from across your notes.
- `::query{tag=project sort=modified}` is a live list of matching notes.
- `::calendar{folder=Journal}` is a month of daily notes, and `::agenda{days=3}` your next few days of events.
- `::timer{duration=25m}` and `::stopwatch` keep time.

A ```` ```mermaid ```` block draws a diagram, and `$…$` sets math.

## Finding things

- **⌘K** finds a note by name or by anything in it.
- **Notes** shows every note as a card, newest first. Type to filter, or narrow to a folder or tag.
- **Smart folders** are saved searches in the sidebar, like `tag=work/clients sort=title`, with live counts.
- **Favorites**: star a note or a tag to keep it at the top of the sidebar.

## Putting notes away

- **Archive** (⌘⇧E) takes a note out of the sidebar, search and agents' lists, and its links keep working.
- **Delete** sends it to **Trash** for 30 days, and Trash puts it back where it was.
- Every change is kept: a note's **History** shows each version, who made it, and restores any of them. Label a version ("Sent to Alex") to find it later.
