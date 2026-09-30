---
pr: 0
title: History keeps older versions as edits, not copies
---
History kept a whole copy of a note for every change. Now it keeps the newest one whole and each older one as the edits from the version after it, with a whole copy every 64 changes. A 94 KB note saved 200 times grew the index by 18 MB before and by 0.6 MB now. What History shows, restores and undoes is the same text as before.

1. Open [[Reading log]] and add a line at the end, such as "- September: a note-taking app's changelog."
2. Open any other note and type a word, then come back to [[Reading log]] and add another line. Do this three or four times, so History has several changes to the log.
3. Open **History of this note**. Your changes are one entry with a saves count, and its +/− counts match the lines you added.
4. Select it and press **Restore to before**. The log goes back to how it was before your first line, and none of your lines are left.
5. Press **Undo** on the toast. All your lines are back, in order.
6. Have an agent append a line to [[Reading log]], then press **Undo** on its toast. Only its line comes out.
