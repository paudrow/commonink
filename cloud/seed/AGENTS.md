# Workspace conventions

These notes belong to people. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits and keep people's words intact; change their text only when they ask.
- Your changes show in History as yours, "<your name> for <person>", for whoever connected you. If you use the `quire` CLI, set `QUIRE_AGENT=<your name>` (or pass `--agent <your name>`) so they do.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}` collects checkbox tasks from those notes.
  - `::query{folder=Projects tag=meeting limit=5}` is a live list of matching notes.
  - `::calendar{folder=Journal}` shows a month of daily notes (`Journal/YYYY-MM-DD.md`).
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`.
- Diagrams: a ```mermaid code block renders as a diagram.
- Archive notes that are done when asked to tidy up; they move under `Archive/` and keep their links.
