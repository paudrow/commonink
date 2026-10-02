---
pr: 283
title: Your own events are notes
---
Events you make in the app now live as notes in an `Events/` folder. Subscribed feeds and Google calendars work as before.

1. Open **Calendar** and press **New event** (or `c`). Call it "Planning", give it a place, a description and a guest, and save.
2. Click the event. Its details have a new **Note** row: `Events/2026-… Planning`. Click it. The note has `start:`, `end:`, `where:` and `attendees:` at the top, the title as its heading, and the description under it.
3. Type a line under the description, like "- agreed on Friday". Go back to **Calendar** and click the event: the line is part of its description.
4. In Week view, drag the event to another day. Open its note again: the times changed, your line is still there, and the note's name now has the new day. **History** shows each change.
5. Delete the event from its details. Its note goes to **Trash**. Press **Undo** on the toast to get the event back.
6. Make an event by writing a note. In the sidebar, open **Folders** and click **Events**, then click **New note** at the bottom. Change its heading to `# Lunch` and paste this above it, on a date this week:
   ```
   ---
   start: 2026-10-09 12:30
   end: 13:30
   ---
   ```
   Open **Calendar** on that day: "Lunch" is there at 12:30. Edit the note's `start:` and the event moves with it.
7. Event notes are ordinary notes. They show in the Notes list like contacts in `People/` do, and the **Events** folder narrows to them.
8. If you have an agent connected, ask it to "add a dentist appointment next Tuesday at 3pm". It can now do that by writing a note in `Events/`, and `get_event` names the note on a `file:` line.
