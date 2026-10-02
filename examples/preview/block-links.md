---
pr: 0
title: Block links
---
Link to, and embed, one paragraph or list item of a note, the way Obsidian does.

1. Open [[Menu plan]]. Its link goes to `Recipe ideas#^soups`, and the two embeds show just one paragraph and just one list item (with the item under it) from [[Recipe ideas]].
2. Click the link. Recipe ideas opens at the soups paragraph.
3. In Recipe ideas, the ` ^soups` and ` ^pickles` markers are hidden. Put the cursor on that line and they show, as written.
4. Click in the last paragraph ("A plain paragraph with no ID yet"). Press ⌘⇧P and run **Copy link to this block**. A toast says "Block link copied", and the paragraph now ends in a short ` ^id`.
5. Paste in another note: you get `[[Recipe ideas#^…]]`. Type a `!` before it to embed the paragraph instead.
6. The side panel's Backlinks for Recipe ideas counts the block links from Menu plan.
