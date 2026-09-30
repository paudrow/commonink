---
pr: 125
title: A board shown in another note doesn't write over an agent's change
---
A board shown outside its note (`::kanban{note=…}`, or the note embedded with `![[…]]`) saves each change one after another. When a save found the note changed underneath, the board reloaded, but the saves queued behind it still went out. They were made on the old text, so they wrote over the other change.

1. Open [[Board elsewhere]]. It shows the board from [[Team board]].
2. Open [[Team board]] in a second tab, or have a connected agent add a card to it ("add a card 'Added by an agent' to Backlog in Team board").
3. In the second tab, add a card. Straight after, before the first tab's board refreshes, move two cards there quickly, one after the other.
4. Open [[Team board]] as text. The other card is still there. Your moves either landed after it, or the board reloaded and showed the other version. Before, the second move could put the note back as it was before the other card. The window is short, so it may take a few tries to hit it either way.
