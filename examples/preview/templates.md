---
pr: 110
title: Templates
---
Templates are notes in `Templates/`. Open [[Meeting]] to see one: `{{date:dddd, MMMM D}}`, `{{time:h:mm A}}` and `{{cursor}}` fill themselves in, and `{{ask:Client}}` and `{{ask:Attendees}}` are asked for. Its frontmatter names the new note (`title`), puts it in `Meetings/` (`folder`), and makes it the default there (`applies_to`).

1. Press ⌘⇧P (Ctrl+Shift+P off a Mac), choose **New note from template…**, and pick **Meeting**. Fill in Client ("Acme") and Attendees ("Sam, Lee") and press Enter: `Meetings/<today> Acme meeting` opens, with the cursor under Agenda. Its "- [ ] Send the recap to Sam, Lee" task is in Tasks; the template's own isn't.
2. The file button next to **New note** at the bottom of the sidebar opens the same picker.
3. Open the Meetings folder in Notes and click **New note**: it starts from Meeting, because the template applies to `Meetings/`.
4. In [[Launch notes]], type `/template` on the empty line and pick **Decision**. Answer "Ship in two steps": the decision block goes in with today's date and a revisit date four weeks out, and the cursor is at "Why".
5. Leave Attendees blank next time: `{{ask:Attendees}}` stays in the note, and a toast lists what's left to fill in.
6. Today's journal note (Today → Start today's note) and the calendar widget use `Templates/Daily note.md` through the same engine.
7. Agents use `list_templates` and `create_from_template` (with `variables`), and the CLI `commonink new --template Meeting --var Client=Acme`.
