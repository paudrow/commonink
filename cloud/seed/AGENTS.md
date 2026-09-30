# Workspace conventions

These notes belong to people. You are a guest editor.

- One idea per note. The title is the first `# heading`; the filename matches the title.
- Link related notes with `[[Note name]]`; embed with `![[Note name]]` or `![[Note name#Heading]]`.
- Embed a CSV, JSON or text file the same way (`![[signups.csv]]`): it shows as a table (CSV) or formatted text in the note.
- Make small, targeted edits and keep people's words intact; change their text only when they ask.
- Tags: `#tag` in the text, or `tags: [a, b]` in the frontmatter. Nest them with `/` (`#work/clients/acme`); filtering by `work` includes every tag under it, and case doesn't matter. A `#` in a heading, in code or in a URL isn't a tag, and neither is a number like `#27`. Tag a task on its own line.
  - Keep tags few and deliberate: status, client or project, context. Nest one level, where the prefix says what kind of tag it is (`client/acme`, `status/waiting`, `area/home`). Don't build deep topic trees; search finds topics. Reuse a tag that exists (`list_tags`) before inventing one.
- Tasks are `- [ ] …` lines. Put their details at the end of the line as tokens, all optional: `due:2026-10-01` (or `due:2026-10-01T09:30`), `start:2026-09-28` (hidden until then), `rec:…` (how it repeats), `#tag`, `@person`, `!high` or `!low`. Ticking a task adds `done:` with the date.
  - `rec:` repeats from the due date: `daily` `weekly` `monthly` `yearly`, `3d` `2w`, `mon,thu`, `2w-mon,thu`, `6th`, `last-day`, `1st-tue,3rd-tue`, `last-fri`, `mar-1`, `1st-mon-mar`, `day-50`, or `RRULE:FREQ=…`. `after-1m` / `after-10d` repeat a gap after it's done. `until:2027-06-30` ends a repeat on that day, `times:3` after three more times (this one included; each tick counts it down). Ticking a repeating task adds the next one on the line below, with the new `due:`; don't add it yourself.
  - To add a task someone asks for, `add_task` takes it in words ("call the bank tomorrow", "every month on the 1st") and files it under `## Tasks` in today's daily note, or in `→ [[Note]]`. Use `list_tasks` to find tasks and `update_task` to tick one or change its tokens; it leaves the rest of the line alone.
- Templates are notes in `Templates/` with placeholders: `{{date}}` (or `{{date:dddd, MMMM D}}`, `{{date+1d}}`), `{{time}}`, `{{title}}`, `{{cursor}}`, and `{{ask:Attendees}}` for something to ask. Their frontmatter can set the new note's `title`, its `folder`, and `applies_to: Meetings/` (new notes there start from it). To make a note of a kind that has a template ("make a meeting note"), use `list_templates` and `create_from_template` with `variables` for its questions; the reply says what's still unfilled. `\{{…}}` stays as written, and a template's own `- [ ]` tasks aren't listed as tasks.
- Smart folders are saved note queries in the sidebar, written like `::query` args: `tag=work sort=title`, `folder=Projects q="launch"`. `list_smart_folders` shows them, `list_notes` with `smart_folder` lists one's notes, and `save_smart_folder` makes one (shared unless `just_me`). Only make one when asked.
- Your changes show in History as yours, "<your name> for <person>", for whoever connected you. If you use the `quire` CLI, set `QUIRE_AGENT=<your name>` (or pass `--agent <your name>`) so they do.
- Widgets are single lines. Leave any `id=` value, and any `<!-- guide:… -->` marker at the end of a task, as it is.
  - `::tasks{folder=Projects}` (or `tag=work`, `assignee=jane`, `due<=today`) collects checkbox tasks from those notes.
  - `::query{folder=Projects tag=meeting limit=5}` is a live list of matching notes.
  - `::today` is the day at a glance: overdue, due today, starting today, and today's journal note. `get_today` gives agents the same.
  - `::calendar{folder=Journal}` shows a month of daily notes (`Journal/YYYY-MM-DD.md`).
  - `::timer{duration=25m label="Focus"}`, `::stopwatch{label="Run"}`.
  - `::kanban{note="Launch"}` shows the Kanban board in another note.
- Kanban boards are a block in a note, with ordinary text around it: a `:::kanban` line, `## Column` headings with `- [ ] card` lines under them, and a closing `:::`. Cards are tasks (same tokens), a card can be just a `[[Note]]` link, and lines indented under a card are its details. Moving a card into the column named `Done` ticks it. A column can have a colour after its name: `## Doing {color=blue}`. Use `read_board`, then `add_card`, `move_card` and `edit_card`.
- Diagrams: a ```mermaid code block renders as a diagram.
- Math: `$E = mc^2$` inline and `$$` on lines of their own around a block (or a ```math block), as on GitHub; `\(…\)` and `\[…\]` work too. Math can't start with a space after `$` or end with a digit after the closing `$`, so most prices stay text; write `\$` for a dollar sign near math.
- Code blocks: put the language after the opening fence (```ts, ```py, ```sh, ```sql, ```diff…) for highlighting. After it, `nowrap` makes long lines scroll instead of wrapping, `title="server.ts"` names the block, `{3-5}` highlights lines and `showLineNumbers` numbers them: ```ts nowrap title="server.ts". Other apps ignore these.
- Collapsible sections: `<details>`, a `<summary>Title</summary>` line, a blank line, any markdown, a blank line, then `</details>`. Use them for long transcripts, logs and reference material. `<details open>` starts open. Opening and closing one in the app doesn't change the note, so leave the tags as they are.
- GitHub-flavored markdown renders as it does on GitHub:
  - Alerts: a blockquote whose first line is `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`, its text on the `>` lines under it. Keep them for what a reader mustn't miss. Obsidian's callouts work too: `> [!info]- Title` starts folded, `[!tip]+` is foldable and open. Folding one in the app doesn't change the note.
  - Footnotes: `[^1]` in the text, and `[^1]: the footnote` on a line of its own, at the end of the section. They're numbered by first reference, whatever the label.
  - Emoji shortcodes (`:tada:`, GitHub's names) show as emoji; write the shortcode, not the emoji, when the note already does.
  - Link to a heading with `[text](#heading-slug)`, GitHub's slug: lowercase, punctuation dropped, spaces as hyphens. A note's address can end in `#heading-slug` too.
  - HTML: only `<kbd>`, `<sub>`, `<sup>`, `<br>`, `<img src="…" width="…" height="…">`, and `<picture>` with a `<source media="(prefers-color-scheme: dark)" srcset="…">`. Scripts, styles and event handlers are dropped.
- Things shared from a phone (the Common Ink app's place in the share sheet) land under `## Captured`, in today's journal note by default, or in `Inbox` or a note the person picked. Treat that section as an inbox to sort when asked: move each item where it belongs, and leave the rest.
- Archive notes that are done when asked to tidy up; they move under `Archive/` and keep their links.
- Delete (`delete_note`) only when asked to delete something. It goes to Trash, where people can restore it for 30 days; you can't delete anything for good.
- Labels (`label_version`) name a note's version ("v1", "Sent to Alex"), so it can be compared (`diff_versions`) and restored (`restore_label`, one undoable change). Label the note before you rewrite much of it ("Before <your name> edit"), and when someone asks you to keep a version.
