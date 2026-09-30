---
pr: 0
title: Undoing a tag rename keeps edits made since
---
Undo on a tag rename put every renamed note back as it was before the rename, even one that someone edited in the seconds after. Their edit was gone. Now Undo restores only the notes still as the rename left them. The others keep their edit, and the new tag, and a toast says so.

1. Open **Tags** and rename `#errand` to `#chore`. Don't press Undo yet.
2. Open [[Hardware store]] and add a line at the end, or have an agent do it.
3. Press **Undo** on the rename toast, or rename and edit again if it's gone. [[Pick up dry cleaning]] is back to `#errand`. [[Hardware store]] keeps your new line and `#chore`, and a toast says 1 note changed since the rename.
