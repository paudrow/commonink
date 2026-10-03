---
pr: 357
title: One view widget, four layouts
---
`::query` is now `::view`: one set of notes (the ones its search, folder, tag or properties match) laid out as a list, a table, a board or a calendar. Four sample notes have `status`, `due` and `owner`: [[Launch site]], [[Press kit]], [[Beta invites]] and [[Launch retro]].

1. Open [[Launch views]]. It shows the same notes four times: a list, a table, a board and a calendar.
2. **List.** Each title has its fields (status, owner, due) as small chips under it. Click a title: the note opens. ⌘-click (Ctrl-click) opens it to the side.
3. **Table.** A column per field; [[Launch retro]] shows a dash for status and due. Click a title to open it.
4. **Board.** A column for each status (doing, todo, done) and one for **No status**. Drag [[Press kit]] from todo to done, then open it: its frontmatter now says `status: done`, and the other lines are as they were. Drag it to **No status** and the `status:` line goes. Click a card's title to open the note.
5. **Calendar.** October 2026 with each note on its `due` day; [[Launch retro]] has none, so the foot says "1 without a date". Use the arrows to change month. Click a note in a day: the note opens (nothing opens a day or the Calendar page).
6. Open any widget's settings (the sliders button). The settings are the same for every layout: Title, Matching, Folder, Tags, Sort, Layout, Fields and How many. Fields offers the properties your notes have as chips: click one to add it. Pick **Board** and a **Columns by** field appears (try `owner`); pick **Calendar** and a **Date** field appears instead.
7. In a note, type `/view`, `/query`, `/table` or `/board`: each finds **View**. `/board` starts it as a board.
8. Share → Print… shows the list and the table as they are; the board and the calendar print as the list of their notes.
9. Saved views are `::view{…}` lines now: open a note in `Views/` (or make one with **New view**) and add `layout=board` to its line. Renaming its folder or changing its query keeps the layout.
