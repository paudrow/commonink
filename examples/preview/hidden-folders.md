---
title: Hidden folders, and folders the app keeps
---
1. Open the sidebar's **Folders**. `Config` and `Templates` aren't there, and at the bottom, a row says **Hidden folders (2)** (or 1, if there's no Templates yet). Click it: they're listed below it, dimmed and apart from your own folders, never mixed in. Click it again to fold them away.
2. Hide them again. Open Notes narrowed to a folder of your own (click it in the sidebar), then ⌘K **Hide folder from the sidebar**: it leaves the list, and the toast's Undo brings it back. ⌘K "hide" while it's hidden offers **Show folder in the sidebar**.
3. Search (⌘P) still finds notes in a hidden folder, and Notes narrowed to it still lists them.
4. Settings (⌘,) → **Workspace** → **Hidden folders** lists them, comma-separated. Add `Projects` and press Enter: Projects leaves the sidebar. Open the settings file: its `hidden_folders:` line says the same, and hovering it says what it does.
5. Settings → **User** → **Show hidden folders** is the same as the Hidden folders row, and your settings file's `show_hidden_folders:` changes with it.
6. Open Hidden folders and hover `Templates`, `Config` or `People`: they have no ✎ or trash icon. F2 on one, or ⌘K **Rename folder…** with Notes narrowed to it, says why it keeps its name. In a terminal, `commonink folder delete Templates --notes lift` refuses, with the same reason. A note inside one can still be deleted.
