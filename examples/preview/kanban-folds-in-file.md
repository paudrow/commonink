---
pr: 0
title: Kanban folds are saved in the note
---
Folding a Kanban column now writes it into the board's markdown, so the fold follows the note to other browsers, people and agents.

1. Open [[Folding board]]. **Done** is folded, because the board's first line says `:::kanban{folded=Done}`.
2. Fold **Later** with the arrow on its header. Press `<>` (Edit as text): the first line now reads `:::kanban{folded="Later,Done"}`. Leave the text.
3. Press ⌘Z (Ctrl+Z off a Mac). Later unfolds again: a fold is one change, like any other board edit.
4. Fold **Later** again, then reload or open the note in another browser. It's still folded.
5. Rename **Later** to "Someday" (double-click its name). It stays folded, and the first line follows the new name.
6. Unfold every column. The `{folded=…}` goes away, so the board is back to a plain `:::kanban`.
7. Folds you made before this change lived in your browser only. They are let go, so a board you had folded opens unfolded once.
