---
pr: 269
title: Import from other apps
---
Sample exports to try, one from each app plus a plain markdown folder, are on the **Assets** page (⌘K → **Assets**; they're in `assets/Import samples`, search `zip` to see just them): **Obsidian vault.zip**, **Notion export.zip**, **Evernote export.zip**, **AppleNotesExport.zip** and **Markdown notes.zip**. Click one and press **Download** to save it, then import it. Each import makes its own folder named after the .zip.

There's one way in for every app: ⌘K (Ctrl+K off a Mac) → **Import notes…**. It tells which app made the files from what's in them.

1. **Obsidian.** **Import notes…**, pick `Obsidian vault.zip`, and import. Open **Obsidian vault/Projects/Garden redesign**: the link to the **start page** (an alias of Home in Obsidian) goes to Home, the tasks have due dates and priorities where Obsidian had 📅 and ⏫, and the PDF and sketch show. **Home** has the picture, the callout as a tip, and no `%% comment %%` or `^decision` showing. `.obsidian/` and `.trash/` weren't brought in, and the summary says `Garden board.canvas` was left out.
2. **Notion.** Import `Notion export.zip` the same way. The note names have no long ids (**Garden**, **Plant list**, **Seeds/Tomato**), and the links in **Garden** open those notes. The Seeds database comes in as `Seeds.csv`.
3. **Evernote.** Import `Evernote export.zip` (a .zip holding `Home projects.enex`; a bare .enex works too). **Home projects/Shed repairs** has its tags, dates and source in its properties, a checklist, and the photo, which was in the .enex as base64.
4. **Apple Notes.** **Import notes…**, pick `AppleNotesExport.zip`. This is what `scripts/export-apple-notes.js` saves on a Mac: a folder of HTML notes per Apple Notes folder, inside `AppleNotesExport` (that folder is how the importer knows). **Notes/Trip to Lisbon** has its bold, lists, checklist and link, **Recipes/Pancakes** its numbered steps and table, and **Gift ideas** (a .txt) is a note too.
5. **Plain markdown.** Import `Markdown notes.zip`: **Markdown notes/Welcome** links to **Recipes/Tomato soup** and **Reading list** and shows the sketch from `images/`; nothing in it is changed.
6. From the CLI against this Preview: `commonink import "Notion export.zip" --folder Notion`, and `commonink import AppleNotesExport.zip`.
7. To check on a real Mac: `osascript -l JavaScript scripts/export-apple-notes.js` writes every note to `~/Desktop/AppleNotesExport`. Zip that folder and import it with **Import notes…**.
