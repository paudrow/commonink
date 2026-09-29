# Vault conventions

These notes belong to a person. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Folders: `Projects/`, `Ideas/`, `Journal/` (daily notes named `YYYY-MM-DD.md`), `Dashboards/` (HTML notes), `assets/`.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Tags: `#tag` in the text, or `tags: [a, b]` in the frontmatter. Nest them with `/` (`#work/clients/acme`); filtering by `work` includes every tag under it, and case doesn't matter. A `#` in a heading, in code or in a URL isn't a tag, and neither is a number like `#27`. Tag a task on its own line. `list_tags` shows the tags in use; `search_notes` and `list_notes` take a `tag`.
  - Keep tags few and deliberate: status, client or project, context. Nest one level, where the prefix says what kind of tag it is (`client/acme`, `status/waiting`, `area/home`). Don't build deep topic trees; search finds topics. Reuse a tag that exists (`list_tags`) before inventing one.
- Tasks are `- [ ] …` lines. Put their details at the end of the line as tokens, all optional: `due:2026-10-01` (or `due:2026-10-01T09:30`), `start:2026-09-28` (hidden until then), `rec:…` (how it repeats), `#tag`, `@person`, `!high` or `!low`. Ticking a task adds `done:` with the date.
  - `rec:` repeats from the due date: `daily` `weekly` `monthly` `yearly`, `3d` `2w`, `mon,thu`, `2w-mon,thu`, `6th`, `last-day`, `1st-tue,3rd-tue`, `last-fri`, `mar-1`, `1st-mon-mar`, `day-50`, or `RRULE:FREQ=…`. `after-1m` / `after-10d` repeat a gap after it's done. Ticking a repeating task adds the next one on the line below, with the new `due:`; don't add it yourself. Use `list_tasks` to find tasks and `update_task` to tick one or change its tokens; it leaves the rest of the line alone.
- Smart folders are saved note queries in the sidebar, written like `::query` args: `tag=work sort=title`, `folder=Projects q="launch"`. `list_smart_folders` shows them, `list_notes` with `smart_folder` lists one's notes, and `save_smart_folder` makes one (shared unless `just_me`). Only make one when asked.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits (`edit_note` / `quire edit`) and keep the user's words intact; change their text only when they ask.
- When you do something worth remembering, add a line to today's journal under `## Log`: `- HH:MM — what you did ([[Note]])`.
- HTML notes are self-contained: inline CSS and JS only.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}`, `::tasks{note="Quire roadmap"}` or `::tasks{tag=work assignee=jane due<=today}`: live checklist of tasks from those notes. Add tasks to the notes themselves (`- [ ] …`); the widget collects them.
  - `::query{folder=Projects tag=meeting q="words" limit=5}`: live list of matching notes.
  - `::calendar{folder=Journal}`: month of daily notes.
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`. Durations look like `90s`, `25m`, `1h30m`.
- Diagrams: a ```mermaid code block renders as a diagram (flowchart, sequence, timeline…).
- A URL alone on its own line renders as an embed (YouTube, X, Bluesky, Spotify, …) or a link card.
- Archiving (`archive_note` / `quire archive`) moves a note under `Archive/`, out of search and listings; its links keep working and `unarchive_note` brings it back. Archive when the user asks you to tidy up.
