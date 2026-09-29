---
pr: 75
title: GitHub-flavored markdown
---
1. Open [[GitHub markdown sampler]]. The five alerts are in GitHub's colours, with their icons. Shortcodes like `:tada:` are emoji, but `10:30`, the URL and the one in code stay as written. <kbd>⌘</kbd> <kbd>K</kbd>, H₂O and mc² render, and the badge and the skyline picture show. Put the cursor on any of them to see the markdown.
2. Hover a footnote's number to read it. Click the number to go to the footnote, then click its ↩ to come back.
3. Switch your system between light and dark: the alerts change colour, and the skyline swaps the sun for the moon.
4. Hover "Emoji" and click the link icon at the end of the heading: it says Copied. Paste the link into a new tab, and the note opens at that heading. Or click "Footnotes" in the "Jump to" line.
5. Open [[Callouts that fold]]. The first callout starts closed, and its triangle opens it. Reload, and it's still open. The file doesn't change (History shows no edit). Moving with `j`/`k` or the arrows, the cursor stops on a callout's title line and steps over a folded body; Space there folds or unfolds it. With vim on, `za` in a callout toggles it, and `zM`/`zR` close and open them all.
6. Split the view with [[GitHub markdown sampler]] on one side, then open its heading link from step 4. It opens in the pane that has the note.
7. In any note, type `:roc` and pick 🚀. The note gets `:rocket:`, which reads the same on GitHub. No suggestions pop up after `10:30`, in a URL or in code.
8. On the Notes page, open the sampler's card, or embed it with `![[GitHub markdown sampler]]`. Alerts, footnotes and emoji render there too, and a footnote link scrolls within the card or embed.
