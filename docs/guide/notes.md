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
| `backlog:2026-10-03` | In the Backlog since that day |

Off the cursor's line these show as chips you can click to change. **Quick add** (⌘⇧.) takes a task in plain words: "Pay rent every month on the 1st #home" is written as the line above would be. It lands in today's daily note unless you name another with `→ [[Note]]`.

**Tasks** lists every task in your notes, with **Today** on top: today's daily note, then what's overdue, due and starting today, and today's calendar events. Ticking a repeating task adds the next one below it.

### The Backlog

The **Backlog** is where tasks wait out of sight. Move one there from its ⚙ menu (**Move to the Backlog**) and it leaves Today, Tasks, `::tasks` lists and what your agents list, without leaving its note: its line gains `backlog:` with the day it went. **Tasks → Backlog** shows what's waiting. **Bring back** returns one, and **Bring all back** returns every task shown (pick a tag or a person first to bring back just those).

A task nobody touches for 30 days moves to the Backlog on its own. A task with a due or start date waits until 30 days after that date, so nothing disappears before its day. History shows each of these moves as a change by **Common Ink**, and undoes it like any other change. Two settings (⌘, → Workspace, or `Config/Settings.md`) control it:

| Setting | Meaning |
| --- | --- |
| `auto_backlog_days: 30` | Days a task sits untouched before it moves. `0` turns it off |
| `backlog_exempt_tag: dont-backlog` | A task with this tag never moves on its own |

So `- [ ] Renew passport #dont-backlog` stays in your lists however long it sits. Cards on a board stay where they are too. For agents and the CLI, `commonink tasks --backlog only` lists the Backlog, and `commonink task Plan 8 --to-backlog` and `--from-backlog` move a task there and back.

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
- `::view{tag=project sort=modified}` is a live list of matching notes. Add `fields=status,due` to show those properties, and `layout=table`, `layout=board` or `layout=calendar` to see the same notes as a table, as columns by `status` (drag a card to change it), or on a month by their `due` date.
- `::calendar{folder=Journal}` is a month of daily notes, and `::agenda{days=3}` your next few days of events.
- `::timer{duration=25m}` and `::stopwatch` keep time.

A ```` ```mermaid ```` block draws a diagram, and `$…$` sets math.

## Finding things

- **⌘K** finds a note by name or by anything in it.
- **Notes** shows every note as a card, newest first. Type in its filter to search, or narrow to a folder or tag.
- **Views** are saved searches in the sidebar, like `tag=work/clients sort=title`, with live counts. Each is a note in `Views/` holding its query, so you can edit, rename or delete it like any note. Make one with **New view** in ⌘K, or save the Notes filter as one.
- **Favorites**: star a note or a tag to keep it at the top of the sidebar.

### Searching and filtering

The Notes filter, views, `::view` and `commonink ls --query` all read the same query language. Plain words find notes with all of them, each as the start of a word (`plan` finds "planning"). A `*` is a wildcard, in a word (`pl*ing`, `*ing`) or in a filter's value (`folder=*/Clients`, `tag=work/*`, `status=draft*`). Combine them with `AND` and `OR` (in capitals), leave things out with `-`, and group with parentheses: without them, AND goes before OR, so `a b OR c` means `(a b) OR c`. For example:

```
(tag=work OR tag=home) -folder=Archive "launch plan" sort=created
```

finds notes tagged work or home, outside Archive, with the words "launch plan" together, newest first. A query with a mistake in it, like a `(` that's never closed, says where under the filter, and the list shows the best reading of the rest meanwhile.

In the app, the **?** beside the Notes filter (or **Query syntax** in ⌘K) lists all of this with examples you can click to try; `commonink help query` prints it too.

<!-- query-syntax -->
| | Write | Try | What it does |
| --- | --- | --- | --- |
| Words | `word` | `plan` | Notes with a word starting with it: "plan" finds planning. Several words: notes with all of them. |
| Words | `wild*card` | `pl*ing` | A * stands for any letters, or none, and the pattern is the whole word: pl*ing finds planning and playing, *ing every word ending in ing, *plan* any word with plan in it. |
| Words | `"a phrase"` | `"launch plan"` | The words together, in this order. Inside q="…" (a saved view or ::view), use single quotes. |
| Combine | `a AND b` | `launch AND budget` | Both. Words side by side mean AND too, so launch budget is the same. |
| Combine | `a OR b` | `budget OR costs` | Either one. Write OR and AND in capitals: lowercase they're just words. |
| Combine | `-term` | `launch -draft` | Leave out notes that match: -word, -"a phrase", -tag=old, -folder=Archive. |
| Combine | `( … )` | `(tag=work OR tag=home) launch` | A group. Without one, AND goes before OR: a b OR c is (a b) OR c. |
| Combine | `-( … )` | `launch -(draft OR old)` | Leave out notes matching anything in the group. |
| Filters | `tag=name` | `tag=work` | Tagged with it, or a tag under it (work/clients). tag=a,b needs both; tag=a\|b either. |
| Filters | `folder=name` | `folder=Projects` | In that folder or a folder under it. folder=A\|B is either. Quote names with spaces: folder='Health and Fitness'. |
| Filters | `modified>day` | `modified>-7d` | Changed after a day (<, <=, >, >= or =). A day is 2026-09-01, today, yesterday, or -7d, -2w, -1m, -1y back. modified>-7d is the last 7 days. |
| Filters | `created<day` | `created<2026-09-01` | Made before a day, with the same comparisons and days as modified. |
| Filters | `property=value` | `status=draft` | A frontmatter property has this value, in any case; a list matches if any item does. title=… is the note's title. Quote values with spaces: status='in progress'. |
| Filters | `has=property` | `has=due` | The property is set, to anything. -has=due: notes without one. |
| Filters | `filter=wild*card` | `folder=*/Clients` | A * in a filter's value stands for anything, or nothing. folder=*/Clients is a Clients folder inside any folder, and folder=Proj* every folder starting with Proj. tag=work/* is the tags under work, not work itself. status=draft* starts with draft, and owner=*Smith ends with Smith. |
| Order | `sort=order` | `tag=work sort=title` | modified (last changed first, the default), date or oldest (by the note's own date), title or created (newest first). On its own, not inside ( ). |
<!-- /query-syntax -->

## Putting notes away

- **Archive** (⌘⇧E) takes a note out of the sidebar, search and agents' lists, and its links keep working.
- **Delete** sends it to **Trash** for 30 days, and Trash puts it back where it was.
- Every change is kept: a note's **History** shows each version, who made it, and restores any of them. Label a version ("Sent to Alex") to find it later.
