# Templates

A template is a note in the `Templates/` folder. When you make a note from one (**New note from template…** in ⌘⇧P, the file button next to **New note**, or **New note** in a folder that has a default template), or insert one with `/template`, its placeholders are filled in. Anything in `{{ }}` that isn't a placeholder stays as written. Nothing in a template runs code, so anyone can share one safely.

In a note under `Templates/`, type `{{` for a menu of placeholders.

## Dates and times

| Placeholder | Becomes | What it is |
| --- | --- | --- |
| `{{date}}` | `2026-09-29` | Today's date, YYYY-MM-DD. |
| `{{date:dddd, MMMM D}}` | `Tuesday, September 29` | Today in a format. |
| `{{date:YYYY-MM-DD}}` | `2026-09-29` | The same, spelled out. |
| `{{date+1d}}` | `2026-09-30` | An offset: `+` or `-`, then a number of days (`d`) or weeks (`w`). |
| `{{date-1w:MMM D}}` | `Sep 22` | An offset and a format together. |
| `{{time}}` | `14:05` | The time now, 24-hour. |
| `{{time:h:mm A}}` | `2:05 PM` | The time in a format. |

"Today" and "now" are the clock of whoever makes the note. Formats use Moment-style tokens, as in Obsidian:

| Token | Example | Token | Example |
| --- | --- | --- | --- |
| `YYYY` | 2026 | `HH` | 14 (24-hour, padded) |
| `YY` | 26 | `H` | 14 |
| `MMMM` | September | `hh` | 02 (12-hour, padded) |
| `MMM` | Sep | `h` | 2 |
| `MM` | 09 | `mm` | 05 |
| `M` | 9 | `m` | 5 |
| `DD` | 09 | `ss` | 00 |
| `D` | 9 | `s` | 0 |
| `dddd` | Tuesday | `A` | PM |
| `ddd` | Tue | `a` | pm |

Words in square brackets stay as they are: `{{date:[Week of] MMM D}}` is "Week of Sep 29".

## The note itself

| Placeholder | What it is |
| --- | --- |
| `{{title}}` | The new note's title. |
| `{{cursor}}` | Where the cursor lands when the note opens (or after `/template`). |
| `{{clipboard}}` | What's on the clipboard. The app asks the browser for it only for a template that uses it; agents and the CLI leave it for you to fill. |

## Questions

A question is asked in a small form before the note is made. One answer fills every copy of the same question.

- `{{ask:Question}}`: text.
- `{{ask:Question|Default}}`: text, with a default if left blank.
- `{{ask:Attendees|people}}`: people, picked from the contacts and the workspace's members, or someone new. On a task line (`- [ ] …`) they're written as @handles, which assign the task to them (`@Sam @Priya-Shah`); anywhere else as links to their contact notes (`[[People/Priya Shah]]`), or names for someone with no contact (`Sam Dev`).
- `{{ask:Due|date}}`: a date, from a date picker, written YYYY-MM-DD.
- `{{ask:Priority|choice:low,medium,high}}`: one of a list, from a menu.

Any type takes a default after it: `{{ask:Priority|choice:low,medium,high|medium}}`, `{{ask:Due|date|2026-10-01}}`. To default a text question to a word that's also a type, say it's text: `{{ask:Who|text|people}}`.

A question left blank with no default stays in the note as written, so it's easy to find, and you're told what's left to fill in.

A person's @handle is their first name when no one else in the list has it (`@Sam`), otherwise their full name with dashes (`@Sam-Dev`).

## Frontmatter

A template's frontmatter can say how notes are made from it. These keys aren't copied into the note; any others (like `tags`) are.

```md
---
title: "{{date}} {{ask:Client}} meeting"
folder: Meetings
applies_to: Meetings/
tags: [meeting]
---
```

| Key | |
| --- | --- |
| `title:` | The new note's title, with placeholders. Without it, the note is named after the template. You can type a title in the form instead. |
| `folder:` | Where the note goes, with placeholders. Without it, the note goes in the folder you're in. |
| `applies_to:` | Folders whose **New note** starts from this template (folders under them too): `applies_to: Meetings/`, or a list, `[Meetings/, Clients/]`. |

## Keeping braces

`\{{date}}` is written as `{{date}}`, for a template that shows how templates work.

## Daily notes

Today's journal note (Tasks → Today), quick-add's journal, quick capture, and the calendar widget over `Journal/` make a new day's note from `Templates/Daily note.md`, with the same placeholders. `{{date}}` is that day, so `# {{date:dddd, MMMM D}}` heads it with the weekday.

## Meeting notes

**Create meeting note** on a calendar event uses `Templates/Meeting note.md`. There, `{{title}}` is the event's title, and `{{date}}` and `{{time}}` are when it starts, with formats as above. These are the event's too:

| Placeholder | What it is |
| --- | --- |
| `{{when}}` | Its day and time: `Mon, Oct 5, 2026, 4:30 PM to 4:45 PM UTC`. |
| `{{where}}` | Its location. |
| `{{attendees}}` | Who's invited. |
| `{{agenda}}` | Its description. |
| `{{event}}` | A link back to the event. |

## For agents

`list_templates` lists the templates and what each asks; `create_from_template` makes a note, with `variables` answering its questions by label (plain text, written as given). The reply says what's still unfilled. On the command line: `quire templates`, and `quire new --template Meeting --var Client=Acme --var "Attendees=@Sam @Lee"`.
