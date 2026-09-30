---
pr: 131
title: Undo keeps edits made since
---
Two Undo buttons put notes back without checking whether anything had changed since. One follows a tag rename, the other follows History's Restore to before. An edit made in between, by you or an agent, was lost. Now Undo leaves a note that changed since as it is, and a toast says so.

1. Open **Tags** and rename `#errand` to `#chore`. Don't press Undo yet.
2. Open [[Hardware store]] and add a line at the end, or have an agent do it.
3. Press **Undo** on the rename toast, or rename and edit again if it's gone. [[Pick up dry cleaning]] is back to `#errand`. [[Hardware store]] keeps your new line and `#chore`, and a toast says 1 note changed since the rename.
4. Open **History**, pick an edit to [[Hardware store]], and press **Restore to before**. Type a line in the note, then press **Undo** on the restore toast. Your line stays, and the toast says the note changed since.
