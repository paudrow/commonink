---
pr: 345
title: One view widget
---
The lists, tasks, month, agenda, today and board widgets are now one widget, `::view`. Its first setting, **Show**, picks what it shows, and the rest are that kind's settings. The old names (`::query`, `::tasks`, `::calendar`, `::agenda`, `::today`, `::kanban`) are gone.

1. Open [[Every view]]. Each section is one `::view` line: a list of notes (no `show=`), `show=tasks` (from [[View errands]]), `show=month`, `show=agenda`, `show=today` and `show=board` (the board in [[View board]]). Each draws as before, with its own header: Notes, Task list, Journal, Agenda, Today, Kanban.
2. On the Tasks list, press the sliders button. The form starts with **Show: Tasks**, then the task fields (Folder, Note, Tag, Person, Due…). Its preview line reads `::view{show=tasks …}`.
3. Change **Show** to **Month**. The fields become the month's (Folder, Show events, Calendars). The title "Errands" stays, the note goes, and the preview says `::view{show=month label=Errands folder=Journal …}`. Press **Cancel**.
4. On the notes list at the top, open the settings: **Save as smart folder** is there. Change **Show** to **Board**: the button goes and the fields are Title, Note and Board. Change it back to **Notes**: the preview has no `show=`, since notes is the default. Press **Cancel**.
5. On the board at the bottom, drag "Update the screenshots" into **Doing**, then open [[View board]]: the card moved there too. Its own board is still a `:::kanban` block.
6. In a new note, type `/view` and press Enter: a list of notes goes in with its settings open. Pick **Tasks** under Show and save.
7. On a new line type `/tasks`: the menu offers **Tasks view** (once, with Checkbox below it). Press Enter: `::view{show=tasks}` goes in. Try `/agenda`, `/calendar` (Month view) and `/kanban` (Board view next to Kanban board) too. `/timer` and `/stopwatch` are still their own.
8. Edit a line by hand to `::view{show=calendar}`: the widget says there's no view called "calendar" and its settings let you pick one.
9. Open **Today** and **Tasks** in the sidebar: they look and work as before.
10. Open [[Every view]]'s Share menu and choose **Export as a web page** (or **Print…**): the tasks, the notes list and the board come out as a snapshot.
