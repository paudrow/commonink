---
pr: 71
title: Collapsible sections
---
1. Open [[Meeting with folds]]. "Full transcript" and "Raw log" start closed, and "Links and references" starts open (it's `<details open>`). Click a triangle to open or close one. The note doesn't change: History shows no edit.
2. Reload the page: each section is still the way you left it.
3. Open "Full transcript": its tasks, the nested "Aside" and the list all render. Click the summary text to edit it, and the tags show as written.
4. Select a few lines, press ⌘⌥S (Ctrl+Alt+S off a Mac): they're wrapped in a new section with its summary selected, ready to name. Or type `/collapsible`. "Fold all sections" and "Unfold all sections" are in the command palette (⌘⇧P).
5. With vim on, move with `j` and `k`: the cursor stops on each summary line (its tags show while it's there), `j` again skips a closed section and enters an open one. Space on a summary line opens or closes it. In a section, `za` toggles it, `zo` and `zc` open and close it, `zM` closes every section and `zR` opens them all. Without vim, the arrow keys stop on summary lines the same way, and Space at the start or end of one toggles it.
6. Close "Full transcript", then search (⌘K) for "HTML samples" and open the result: the section opens at the match.
7. Embed the note somewhere, or look at its card on the Notes page: the sections are native folds there too.
