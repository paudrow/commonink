---
pr: 298
title: Meeting notes say which event they're for
---
A meeting note made from a calendar event now names the event in its frontmatter, so the link between them is in the file, not only in the app's database.

1. Open Calendar and click **New event**. Give it a title, tick **Also make a meeting note** and save.
2. The meeting note opens. Its properties at the top show `event` (the event's ID in its calendar) and `calendar` (the calendar's name). For one day of a repeating event there is also `occurrence`.
3. Go back to the event and click it: **Open meeting note** opens the same note.
4. If you have `Templates/Meeting note.md`, make another meeting note. The template's own frontmatter stays, and the event's keys are added to it.
5. What this is for: after you export the workspace and bring it back, or subscribe to the same calendar again, the database no longer knows which note goes with which event. Opening the event, or clicking **Create meeting note**, now finds the note by its `event:` and links it again instead of making a second one. Agents can read `event:` too.
