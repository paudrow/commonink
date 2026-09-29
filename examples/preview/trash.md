---
pr: 0
title: Trash and deleting
---
Anything you can add, you can now delete. It goes to **Trash** for 30 days first. Deleting comes with Undo, and asks first only when other notes link to what's going, or when it's a whole folder.

1. Open [[Delete me]] and press the trash icon in the top bar. A dialog names the notes that link here. Click **Delete**, then **Undo** in the toast: it's back.
2. Delete it again, then open [[Links to delete me]]: the link shows as missing. Open **Trash** at the bottom of the sidebar, next to Archive. The note is there, with who deleted it and how many days are left. Click **Restore**, and the link works again.
3. Open **Folders** in the sidebar, then Try › Trash and deleting. Hover **Old project** and click its trash icon. The dialog counts 3 notes and 1 asset. Choose **Move them to Try/Trash and deleting**: the notes move up a level, keeping the Retro subfolder. Press **Undo** to put them back, then delete the folder again with **Delete them too**.
4. Open **Assets**, click "Trash logo.svg", and press **Delete**: 1 note embeds it, [[Brand page]]. To delete several assets, tick their checkboxes (or press `x` on one), then press **Delete** in the bar.
5. In **Notes**, press `x` on two cards, then the Delete key (or **Delete** in the bar). Press **Undo**.
6. With vim on, type `:trash` in a note to delete it. (`:delete` stays Vim's own line delete.)
7. Open **History**: deletes, restores and deletes-forever are all there. Select a delete and press **Restore to before**, and the note comes back from Trash.
8. In **Trash**, press **Delete forever** on one item, then **Empty trash**. Both ask first. On a Preview you own your workspace; online only owners can delete for good, and viewers don't see Trash at all.
9. Agents can delete too, but only to Trash: `quire delete <note>` and the MCP `delete_note` tool. `quire trash` lists what's there and `quire trash restore <id>` brings it back.
