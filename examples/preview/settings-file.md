---
pr: 268
title: Settings file and property help
---
1. Open Settings (⌘,) and search **settings file**. Under Workspace, click **Open Settings.md**. It opens `Config/Settings.md`, whose properties card shows `gamified true`.
2. Click the card to see its YAML. Change `true` to `yes`: a red strip above the note says what's wrong, and the value is underlined. Delete `yes` and type `f`: **false** is suggested. Pick it, and the sidebar shows Contacts, Calendar and Smart folders at once.
3. Hover the word `gamified` to read what it does. On a new line inside the `---` lines, type `t`: **tags** and **title** are suggested, each with what it is. Type `gamifed: true` on a line of its own: it's flagged with "Did you mean gamified?"
4. Open Settings again and turn **Unlock as you go** back on. The file's `gamified:` line changes to `true` while it's open.
5. Open [[Properties with mistakes]]. The strip says it has three problems, and the card marks the rows; `status: draft` is fine, since a note can have properties of its own.
6. `Config` isn't among the sidebar's folders. Settings → Sidebar → **Show the Config folder** puts it there.
7. Settings → Workspace → **Organizing style**: pick PARA. Open Config/AGENTS.md (⌘K, "AGENTS"): it has an Organizing section telling agents how to file notes. Pick Zettelkasten, and only that section changes.
8. To see what a new workspace is asked, use the workspace menu → **New team workspace…**: it opens with "How do you like to organize?"
