---
pr: 126
title: Tasks in notes with Windows line endings
---
A note saved with Windows line endings (CRLF) had no tasks as far as Tasks, Today, task widgets and agents could tell: every task line ended in an invisible `\r` the task pattern refused. Its outline was empty too.

1. Open **Today**: "Renew the parking permit" and "Water the ferns" from [[Written on Windows]] are under Due today. On **Tasks**, all three, "Back up the laptop" too, are in their note's group.
2. Tick "Water the ferns" there. It's ticked in the note, and next week's occurrence is added below it.
3. Add a task with the bar: `Call the landlord tomorrow → [[Written on Windows]]`. It lands at the end of the note's Tasks section.
4. Open [[Written on Windows]]: the outline in the side panel lists Tasks and Log.
