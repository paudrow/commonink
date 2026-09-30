---
pr: 101
title: Jumps next to cards
---
1. Open [[Jumps near cards]]. Click the "Focus" heading, then click "After the timer" in the Outline: the cursor lands on that heading, and the timer's markdown stays hidden. Do the same from "Reading" (a link card) and "Numbers" (a table).
2. Click the "Focus" heading and press ↓ (or `j` with vim on): the cursor still stops on the timer's line, as before. From "Numbers" it steps into the table.
3. Click [[Tea timer#Steep]] in the "Reading" section: Tea timer opens with the cursor on "Steep", under its timer. Press ⌘[ and then ⌘] (Ctrl-O and Ctrl-I in vim): you're back on "Steep".
4. Press ⌘K and search for "Steep". The result opens on the heading, not on the timer above it.
5. With vim on, in [[Jumps near cards]], put the cursor on "Laps for today's run:" and press `J`: nothing joins, and the stopwatch stays whole. `gJ` and `:join` do the same. `3J` on "With vim on…" joins the two lines above the stopwatch and stops there.
