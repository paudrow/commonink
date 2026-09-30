---
pr: 0
title: Template docs, suggestions and typed questions
---
1. Press ⌘⇧P (Ctrl+Shift+P off a Mac), choose **New note from template…**, and click **?** in the picker: the help lists every template option, with examples. It's the same page as `docs/templates.md` in the repo.
2. Pick **Kickoff**. Its form has a field for each kind of question:
   - **Team** and **Owner** are people pickers. Type `dev` and press Enter to add Dev User (you, in this Preview), or type a new name like `Lee Chang` and press Enter to add someone new. Backspace takes the last one off.
   - **Ships** is a date picker.
   - **Size** is a menu, with "medium" already chosen.
3. Fill it in (Project "Atlas") and press **Create**. `Projects/Atlas kickoff` opens:
   - the Team line has the names;
   - the task lines have @handles (`@Dev @Lee`), which assign them;
   - the brief is due on the Ships date.
4. Open [[Kickoff]] in `Templates/` and type `{{` on a new line: every placeholder is suggested, with a line on what it does. Picking `{{ask:Attendees|people}}` selects "Attendees" so you can type your own label. Open `Templates/Meeting note.md` (make it if you don't have one): the calendar's `{{when}}`, `{{where}}`, `{{attendees}}`, `{{agenda}}` and `{{event}}` are offered there too. In a note outside `Templates/`, like [[Write a template here]], `{{` suggests nothing.
