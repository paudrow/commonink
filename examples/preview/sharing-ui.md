---
pr: 95
title: Sharing notes, in the app
---
This Preview shares [[Plan for Sam]] (editor), [[Read only for Sam]] (viewer) and the folder **Shared folder** with a second person, Sam Dev, and [[Public page]] with anyone who has the link. [[Secret numbers]] isn't shared.

1. **The share dialog.** Open [[Plan for Sam]]. The share button in the top bar (next to the star) is lit: the note is shared. Click it. Sam Dev is listed as an editor. Change Sam to **Viewer**, then back. Add someone by email (try `friend@example.com`): with no account yet, it's theirs when they sign in with that address. Remove them with ×.
2. **Anyone with the link.** Open [[Public page]] and its share dialog. General access is **Anyone with the link**. Press **Copy link** and open it in a private window: the note, on its own page with no sidebar. Where it embeds [[Secret numbers]] it says **No access**, and the link to it goes nowhere: that note isn't shared. Its `::query` widget shows only a note that widgets work inside the workspace. Set the link to expire **For 1 day**, or switch to **Restricted**, and the link stops working.
3. **As Sam.** In a private window, open `/auth/dev?as=sam` on this Preview. In the sidebar, **Shared with me** lists the three notes shared with Sam. Open [[Plan for Sam]]: **Edit**, change a line, **Done**. Back in your own window, the note shows Sam's change, and History says Sam made it. Open [[Read only for Sam]]: there's no Edit.
4. **A folder.** In the sidebar, open **Folders**, then Try › Sharing notes. Hover **Shared folder** and press its share icon: the same dialog, for everything in the folder.
5. **Everywhere else.** Notes cards of shared notes carry a **Shared** badge. ⌘⇧P then "Share…" opens the dialog for the note you're on, and on a phone it's in the More menu.
