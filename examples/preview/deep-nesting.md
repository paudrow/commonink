---
pr: 0
title: Deeply nested notes
---
1. Open [[Too deep]]. Every part renders. Lists and quotes nested past 20 levels sit at level 20, tags nested past 100 are dropped with their text kept, and the rest of the note renders as usual, and a run of 80 stars is stars. A line of only stars is still a divider.
2. Embed it in another note (`![[Too deep]]`), or open its card on the Notes page. It renders the same way there. Before this fix, a note nested thousands deep could stop an embed or card from rendering at all.
3. In the editor, move through it with the arrow keys: it stays quick. Past 20 levels, the list and quote markers show as written.
