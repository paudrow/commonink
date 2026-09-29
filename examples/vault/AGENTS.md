# Vault conventions

These notes belong to a person. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Folders: `Projects/`, `Ideas/`, `Journal/` (daily notes named `YYYY-MM-DD.md`), `Dashboards/` (HTML notes), `assets/`.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits (`edit_note` / `quire edit`) and keep the user's words intact; change their text only when they ask.
- Your changes show in History as yours, "<your name> for you". With the `quire` CLI, set `QUIRE_AGENT=<your name>` (or pass `--agent <your name>`) so they do; without it they look like the person's own.
- When you do something worth remembering, add a line to today's journal under `## Log`: `- HH:MM — what you did ([[Note]])`.
- HTML notes are self-contained: inline CSS and JS only.
- Widgets are single lines. Leave any `id=` value as it is.
  - `::tasks{folder=Projects}` or `::tasks{note="Quire roadmap"}`: live checklist of tasks from those notes. Add tasks to the notes themselves (`- [ ] …`); the widget collects them.
  - `::query{folder=Projects tag=meeting q="words" limit=5}`: live list of matching notes.
  - `::calendar{folder=Journal}`: month of daily notes.
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`. Durations look like `90s`, `25m`, `1h30m`.
- Diagrams: a ```mermaid code block renders as a diagram (flowchart, sequence, timeline…).
- A URL alone on its own line renders as an embed (YouTube, X, Bluesky, Spotify, …) or a link card.
- Archiving (`archive_note` / `quire archive`) moves a note under `Archive/`, out of search and listings; its links keep working and `unarchive_note` brings it back. Archive when the user asks you to tidy up.
