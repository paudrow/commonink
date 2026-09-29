---
pr: 70
title: Collapsible sections
---
1. Open [[Meeting with folds]]. "Full transcript" and "Raw log" start closed, and "Links and references" starts open (it's `<details open>`). Click a triangle to open or close one. The note doesn't change: History shows no edit.
2. Reload the page: each section is still the way you left it.
3. Open "Full transcript": its tasks, the nested "Aside" and the list all render. Click the summary text to edit it, and the tags show as written.
4. Select a few lines, press ⌘⌥S (Ctrl+Alt+S off a Mac): they're wrapped in a new section with its summary selected, ready to name. Or type `/collapsible`.
5. With vim on, put the cursor in a section: `za` toggles it, `zo` and `zc` open and close it, `zM` closes every section and `zR` opens them all.
6. Close "Full transcript", then search (⌘K) for "HTML samples" and open the result: the section opens at the match.
7. Embed the note somewhere, or look at its card on the Notes page: the sections are native folds there too.
