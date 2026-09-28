# Workspace conventions

These notes belong to people. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits and keep people's words intact; change their text only when they ask.
- Tags: `#tag` in the text, or `tags: [a, b]` in the frontmatter. Nest them with `/` (`#work/clients/acme`); filtering by `work` includes every tag under it, and case doesn't matter. A `#` in a heading, in code or in a URL isn't a tag, and neither is a number like `#27`. Tag a task on its own line.
  - Keep tags few and deliberate: status, client or project, context. Nest one level, where the prefix says what kind of tag it is (`client/acme`, `status/waiting`, `area/home`). Don't build deep topic trees; search finds topics. Reuse a tag that exists (check the Tags page) before inventing one.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}` (or `tag=work`) collects checkbox tasks from those notes.
  - `::query{folder=Projects tag=meeting limit=5}` is a live list of matching notes.
  - `::calendar{folder=Journal}` shows a month of daily notes (`Journal/YYYY-MM-DD.md`).
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`.
- Diagrams: a ```mermaid code block renders as a diagram.
- Archive notes that are done when asked to tidy up; they move under `Archive/` and keep their links.
