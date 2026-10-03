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
- **Notes** shows every note as a card, newest first. Type in its filter to search, or narrow to a folder or tag.
- **Smart folders** are saved searches in the sidebar, like `tag=work/clients sort=title`, with live counts. Make one with **New smart folder** in ⌘K, or save the Notes filter as one.
- **Favorites**: star a note or a tag to keep it at the top of the sidebar.

### Searching and filtering

The Notes filter, smart folders, `::query` and `commonink ls --query` all read the same query language. Plain words find notes with all of them, each as the start of a word (`plan` finds "planning"). Combine them with `AND` and `OR` (in capitals), leave things out with `-`, and group with parentheses: without them, AND goes before OR, so `a b OR c` means `(a b) OR c`. For example:

```
(tag=work OR tag=home) -folder=Archive "launch plan" sort=created
```

finds notes tagged work or home, outside Archive, with the words "launch plan" together, newest first. A query with a mistake in it, like a `(` that's never closed, says where under the filter, and the list shows the best reading of the rest meanwhile.

In the app, the **?** beside the Notes filter (or **Query syntax** in ⌘K) lists all of this with examples you can click to try; `commonink help query` prints it too.

<!-- query-syntax -->
| | Write | Try | What it does |
| --- | --- | --- | --- |
| Words | `word` | `plan` | Notes with a word starting with it: "plan" finds planning. Several words: notes with all of them. |
| Words | `"a phrase"` | `"launch plan"` | The words together, in this order. Inside q="…" (a smart folder or ::query), use single quotes. |
| Combine | `a AND b` | `launch AND budget` | Both. Words side by side mean AND too, so launch budget is the same. |
| Combine | `a OR b` | `budget OR costs` | Either one. Write OR and AND in capitals: lowercase they're just words. |
| Combine | `-term` | `launch -draft` | Leave out notes that match: -word, -"a phrase", -tag=old, -folder=Archive. |
| Combine | `( … )` | `(tag=work OR tag=home) launch` | A group. Without one, AND goes before OR: a b OR c is (a b) OR c. |
| Combine | `-( … )` | `launch -(draft OR old)` | Leave out notes matching anything in the group. |
| Filters | `tag=name` | `tag=work` | Tagged with it, or a tag under it (work/clients). tag=a,b needs both; tag=a\|b either. |
| Filters | `folder=name` | `folder=Projects` | In that folder or a folder under it. folder=A\|B is either. Quote names with spaces: folder='Health and Fitness'. |
| Filters | `modified>day` | `modified>-7d` | Changed after a day (<, <=, >, >= or =). A day is 2026-09-01, today, yesterday, or -7d, -2w, -1m, -1y back. modified>-7d is the last 7 days. |
| Filters | `created<day` | `created<2026-09-01` | Made before a day, with the same comparisons and days as modified. |
| Order | `sort=order` | `tag=work sort=title` | modified (last changed first, the default), date or oldest (by the note's own date), title or created (newest first). On its own, not inside ( ). |
<!-- /query-syntax -->

## Putting notes away

- **Archive** (⌘⇧E) takes a note out of the sidebar, search and agents' lists, and its links keep working.
- **Delete** sends it to **Trash** for 30 days, and Trash puts it back where it was.
- Every change is kept: a note's **History** shows each version, who made it, and restores any of them. Label a version ("Sent to Alex") to find it later.
