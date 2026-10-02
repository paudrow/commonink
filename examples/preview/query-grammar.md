---
pr: 282
title: More ways to filter notes
---
The Notes filter, smart folders and `::query` lists understand a few new words. Try them in the Notes filter (press `/` on Notes).

1. Type `launch`. Among the notes you see [[Launch plan]], [[Launch budget]] and [[Launch party]].
2. Type `launch -draft`. [[Launch plan]] is gone: `-word` leaves out notes with that word.
3. Type `budget OR party`. You see [[Launch budget]] and [[Launch party]], each matching one of the two words.
4. Type `"launch plan"` with the quotes. Only notes with those two words side by side show. [[Launch party]] has "plan for the launch", so it's left out.
5. Type `tag=launch -tag=fun`. You see [[Launch plan]] and [[Launch budget]], but not [[Launch party]], which has #fun.
6. Type `modified>-7d`. You see notes changed in the last seven days. Then try `modified<-1d`: in a new Preview every note is newer than that, so the list is empty.
7. In ⌘K, choose "New smart folder" and type `q="launch -draft" sort=created`. Save it and open it: the launch notes are there without [[Launch plan]], the newest note first.
8. In any note, add a line `::query{q="launch -tag=draft" modified>-7d}`. It lists the launch notes without the draft. With the Matching field empty, its placeholder in the settings lists the new words.
9. Try a typo in a smart folder, like `modified>someday`. The editor says it isn't a day and shows what to write.
