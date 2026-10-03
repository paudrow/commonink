---
pr: 282
title: More ways to filter notes
---
The Notes filter, smart folders and `::view` lists understand a few new words. Try them in the Notes filter (press `/` on Notes).

1. Type `launch`. Among the notes you see [[Launch plan]], [[Launch budget]] and [[Launch party]].
2. Type `launch -draft`. [[Launch plan]] is gone: `-word` leaves out notes with that word.
3. Type `budget OR party`. You see [[Launch budget]] and [[Launch party]], each matching one of the two words.
4. Type `"launch plan"` with the quotes. Only notes with those two words side by side show. [[Launch party]] has "plan for the launch", so it's left out.
5. Type `tag=launch -tag=fun`. You see [[Launch plan]] and [[Launch budget]], but not [[Launch party]], which has #fun.
6. Type `modified>-7d`. You see notes changed in the last seven days. Then try `modified<-1d`: in a new Preview every note is newer than that, so the list is empty.
7. In ⌘K, choose "New smart folder" and type `q="launch -draft" sort=created`. Save it and open it: the launch notes are there without [[Launch plan]], the newest note first.
8. In any note, add a line `::view{q="launch -tag=draft" modified>-7d}`. It lists the launch notes without the draft. With the Matching field empty, its placeholder in the settings lists the new words.
9. Try a typo in a smart folder, like `modified>someday`. The editor says it isn't a day and shows what to write.
10. Back in the Notes filter, type `(tag=draft OR tag=fun) launch`. You see [[Launch plan]] and [[Launch party]]: the parentheses keep the OR together, and `launch` applies to both.
11. Type `tag=draft OR tag=fun -tag=launch`. You see [[Launch plan]]: AND goes before OR, so this reads `tag=draft OR (tag=fun -tag=launch)`. Now add parentheses, `(tag=draft OR tag=fun) -tag=launch`, and the list is empty, since both notes have #launch.
12. Type `launch -(tag=draft OR tag=fun) folder=Try`. Only [[Launch budget]] is left: `-( … )` leaves out the whole group, and `folder=` keeps notes in that folder or under it.
13. Type `(launch OR budget` and stop. A red line under the box says `Missing ")" for the "(" at character 1`. Add the `)` and it goes away.
14. Click the **?** at the right of the filter box. The Query syntax page lists every operator and field with an example. Click an example, like `budget OR costs`, and Notes opens filtered by it. The same **?** is beside Matching in a `::view`'s settings and in the smart folder editor.
