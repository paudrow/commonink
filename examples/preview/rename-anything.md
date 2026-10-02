---
title: Rename folders and files, and everything the same way
---
Folders and files (images, PDFs and other assets) couldn't be renamed at all, and the things that could each did it a different way. Now anything with a name in a list renames the same way: press **F2** on it or double-click it, or use its ✎ button where its row has buttons. **⌘K → Rename…** renames whatever is showing. Links to what you renamed are updated everywhere.

1. **A folder.** In the sidebar under **Folders**, open **Try**, then this section's folder, and find **Recipes**. Double-click it (or focus it and press F2, or hover it and press ✎) and rename it to `Cooking`. [[Shopping list]] still opens both recipes and still shows the picture. Press **Undo** on the toast and it's **Recipes** again.
2. **From ⌘K.** Click **Recipes** so Notes shows that folder, then press ⌘K and run **Rename folder…**. With #dinner showing, ⌘K offers **Rename tag…**; on a smart folder, **Rename smart folder…** (it opens the smart folder's editor, where its name is); on a note, **Rename note…**.
3. **A file.** Open **Assets**, click **soup-pot.svg**, and press **Rename** (or F2). Call it `big pot`. [[Shopping list]] still shows it. Undo puts the old name back.
4. **A tag.** Hover #dinner under **Tags** in the sidebar and press ✎ (or press F2 on it). It renames everywhere, with Undo, as the Tags page does. On the Tags page, F2 on a tag starts its rename too.
5. **A note in a list.** On **Notes**, move to a card with j/k and press F2: the note opens with its heading selected, ready to type its new name. F2 on a favorite does the same.
6. **Agents and the CLI.** Ask an agent to rename the Recipes folder here (it uses the new `rename_folder` tool), or run `commonink folder rename <folder> <new-path>` with whole paths. Renaming a file is `commonink mv` / `move_note`, as for a note.
