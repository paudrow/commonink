---
pr: 293
title: Block links
---
Link to, and embed, one paragraph or list item of a note, the way Obsidian does, from a right-click menu.

1. Open [[Menu plan]]. Its link goes to `Recipe ideas#^soups`, and the two embeds show just one paragraph and just one list item (with the item under it) from [[Recipe ideas]].
2. Click the link. Recipe ideas opens at the soups paragraph.
3. In Recipe ideas, the ` ^soups` and ` ^pickles` markers are hidden. Put the cursor on that line and they show, as written.
4. Right-click the last paragraph ("A plain paragraph with no ID yet"). A small menu shows **Copy link to this note**, **Copy link to this paragraph** and **Copy embed of this paragraph**. Pick **Copy link to this paragraph**. A toast says "Link copied", and the paragraph now ends in a short ` ^id`.
5. Press ⌘Z. The ` ^id` goes away in one step.
6. Right-click "Granola" in the list: the menu says **list item** instead. Right-click the `# Recipe ideas` heading: it offers **Copy link to this heading**, which copies `[[Recipe ideas#Recipe ideas]]` with no ID added.
7. Copy a link again, open another note and paste: you get `[[Recipe ideas#^…]]`. Click it and Recipe ideas opens at that paragraph. Pick **Copy embed of this paragraph** instead to paste `![[Recipe ideas#^…]]`, which shows just the paragraph.
8. Select a few words and right-click: **Cut** and **Copy** are at the top.
9. Without the mouse: put the cursor in a paragraph and press Shift+F10 (or the Menu key). The menu opens at the cursor. Use the arrow keys and Enter, or Escape to close it, and you're back in the note.
10. Shift+right-click still shows the browser's own menu, for spellcheck and paste.
11. ⌘K still has **Copy link to this paragraph** and **Copy embed of this paragraph**.
12. The side panel's Backlinks for Recipe ideas counts the block links from Menu plan.
