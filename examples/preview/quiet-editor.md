---
pr: 81
title: A quieter editor
---
1. Open [[Quiet blocks]]. The timer, image, video and link card show without their markdown lines. Press ↓ (or `j` with vim on) from the top: the cursor stops on each block's line, and the line shows above the block until the cursor moves on.
2. Play the video, then move the cursor onto its link line and off again: it keeps playing.
3. Click the `<>` button on the timer, or hover the link card or video and click its `<>`: the cursor goes to that line. Click just above the image to do the same.
4. Put the cursor at the start of "The line above is a link card…" and press Backspace: the link card's line is selected instead of joined. Press Backspace again to delete it (⌘Z brings it back).
5. Open [[Empty line hint]] and click the empty line under the first sentence: a grey "Type / for tools, @ to link a note" shows. There's none on the empty lines in the list, the code block or the properties, none when the editor isn't focused, and none in vim's normal mode.
6. Type `/` and pick anything. The hint is gone from every note after that. To see it again, run `localStorage.removeItem("quire.slashUsed")` in the console and reload.
