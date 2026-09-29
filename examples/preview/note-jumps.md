---
pr: 0
title: Back and forward between notes
---
1. Click Notes in the sidebar, then open [[Trip plan]]. Follow [[Flights]], and from there [[Airport transfer]]: click a link, or with vim on, put the cursor on it and press `gd`.
2. Press ⌘[ (Ctrl+[ or Alt+← off a Mac), or Ctrl-O in vim's normal mode. You're back on Flights, the note that linked you there. Press it again for Trip plan, and once more for Notes, because you went there. ⌘] (Alt+→, or Ctrl-I in vim) goes forward again.
3. The browser's back and forward buttons, and a mouse's side buttons, go the same way.
4. In Trip plan, scroll down and put the cursor on the Day 3 line that says so. Follow a link, then come back: the cursor and the scroll are where you left them, even after a reload.
5. Open a note from Tasks, or from a link, and go back: you get the page or note you came from, not Notes.
6. With vim on, `gD` on a link opens it to the side (⌘-click does too, Ctrl-click off a Mac). Each pane goes back and forward through its own notes: ⌘[ in the side pane only moves the side pane.
