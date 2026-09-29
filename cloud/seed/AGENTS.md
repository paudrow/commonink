# Workspace conventions

These notes belong to people. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits and keep people's words intact; change their text only when they ask.
- Tags: `#tag` in the text, or `tags: [a, b]` in the frontmatter. Nest them with `/` (`#work/clients/acme`); filtering by `work` includes every tag under it, and case doesn't matter. A `#` in a heading, in code or in a URL isn't a tag, and neither is a number like `#27`. Tag a task on its own line.
  - Keep tags few and deliberate: status, client or project, context. Nest one level, where the prefix says what kind of tag it is (`client/acme`, `status/waiting`, `area/home`). Don't build deep topic trees; search finds topics. Reuse a tag that exists (check the Tags page) before inventing one.
- Tasks are `- [ ] …` lines. Put their details at the end of the line as tokens, all optional: `due:2026-10-01` (or `due:2026-10-01T09:30`), `start:2026-09-28` (hidden until then), `rec:…` (how it repeats), `#tag`, `@person`, `!high` or `!low`. Ticking a task adds `done:` with the date.
  - `rec:` repeats from the due date: `daily` `weekly` `monthly` `yearly`, `3d` `2w`, `mon,thu`, `2w-mon,thu`, `6th`, `last-day`, `1st-tue,3rd-tue`, `last-fri`, `mar-1`, `1st-mon-mar`, `day-50`, or `RRULE:FREQ=…`. `after-1m` / `after-10d` repeat a gap after it's done. Ticking a repeating task adds the next one on the line below, with the new `due:`; don't add it yourself.
  - To add a task someone asks for, `add_task` takes it in words ("call the bank tomorrow", "every month on the 1st") and files it under `## Tasks` in today's daily note, or in `→ [[Note]]`.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}` (or `tag=work`, `assignee=jane`, `due<=today`) collects checkbox tasks from those notes.
  - `::query{folder=Projects tag=meeting limit=5}` is a live list of matching notes.
  - `::today` is the day at a glance: overdue, due today, starting today, and today's journal note. `get_today` gives agents the same.
  - `::calendar{folder=Journal}` shows a month of daily notes (`Journal/YYYY-MM-DD.md`).
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`.
- Diagrams: a ```mermaid code block renders as a diagram.
- Archive notes that are done when asked to tidy up; they move under `Archive/` and keep their links.
