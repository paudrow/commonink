# Vault conventions

These notes belong to a person. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Folders: `Projects/`, `Ideas/`, `Journal/` (daily notes named `YYYY-MM-DD.md`), `Dashboards/` (HTML notes), `assets/`.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Tags: `#tag` in the text, or `tags: [a, b]` in the frontmatter. Nest them with `/` (`#work/clients/acme`); filtering by `work` includes every tag under it, and case doesn't matter. A `#` in a heading, in code or in a URL isn't a tag, and neither is a number like `#27`. Tag a task on its own line. `list_tags` shows the tags in use; `search_notes` and `list_notes` take a `tag`.
  - Keep tags few and deliberate: status, client or project, context. Nest one level, where the prefix says what kind of tag it is (`client/acme`, `status/waiting`, `area/home`). Don't build deep topic trees; search finds topics. Reuse a tag that exists (`list_tags`) before inventing one.
- Tasks are `- [ ] …` lines. Put their details at the end of the line as tokens, all optional: `due:2026-10-01` (or `due:2026-10-01T09:30`), `start:2026-09-28` (hidden until then), `rec:weekly` (or `rec:2w` for every two weeks), `#tag`, `@person`, `!high` or `!low`. Ticking a task adds `done:` with the date. Use `list_tasks` to find tasks and `update_task` to tick one or change its tokens; it leaves the rest of the line alone.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits (`edit_note` / `quire edit`) and keep the user's words intact; change their text only when they ask.
- When you do something worth remembering, add a line to today's journal under `## Log`: `- HH:MM — what you did ([[Note]])`.
- HTML notes are self-contained: inline CSS and JS only.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}`, `::tasks{note="Quire roadmap"}` or `::tasks{tag=work assignee=jane due<=today}`: live checklist of tasks from those notes. Add tasks to the notes themselves (`- [ ] …`); the widget collects them.
  - `::query{folder=Projects tag=meeting q="words" limit=5}`: live list of matching notes.
  - `::calendar{folder=Journal}`: month of daily notes.
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`. Durations look like `90s`, `25m`, `1h30m`.
  - `::kanban{note="Launch"}`: the Kanban board in another note (`board=2` for its second).
- Kanban boards are a block in a note, with ordinary text around it: a `:::kanban` line, `## Column` headings with `- [ ] card` lines under them, and a closing `:::`. Cards are tasks (same tokens), a card can be just a `[[Note]]` link, and lines indented under a card are its details. Moving a card into the column named `Done` ticks it. A column can have a colour after its name: `## Doing {color=blue}`. Use `read_board`, then `add_card`, `move_card` and `edit_card`.
- Diagrams: a ```mermaid code block renders as a diagram (flowchart, sequence, timeline…).
- A URL alone on its own line renders as an embed (YouTube, X, Bluesky, Spotify, …) or a link card.
- Archiving (`archive_note` / `quire archive`) moves a note under `Archive/`, out of search and listings; its links keep working and `unarchive_note` brings it back. Archive when the user asks you to tidy up.
