---
pr: 187
title: More vim commands
---
Vim users can now reach every page and file a note without the mouse.

1. Turn vim on: ⌘⇧P (Ctrl+Shift+P off a Mac), **Turn vim keys on**.
2. Open [[Move me]], press Esc, and type `:move ideas` then Enter. The note moves to Ideas (folder names match in any case) and a toast offers Undo. `:move /` puts it back at the top level. `:move nowhere` says there's no folder by that name. `:move` alone opens the folder picker.
3. Type `:tasks`, `:tags`, `:history`, `:assets`, `:contacts` or `:calendar` from any note to go to that page.
4. `:archive` archives the note. On an archived note, `:unarchive` brings it back.
5. Press `?` outside the editor: the Vim section lists the new commands.
