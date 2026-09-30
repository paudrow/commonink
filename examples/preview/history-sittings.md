---
pr: 137
title: One History entry per sitting, not per autosave
---
The editor autosaves about every second while you type, and each save kept a full copy of the note in History, forever. Now a stretch of typing in one note is one change. It starts with the note as it was before you began and ends with your last save. A pause of more than 5 minutes, a save to another note, or anyone else's change to the note starts a new one.

1. Open [[Draft letter]] and type three lines, waiting a second or two after each so each one saves.
2. Open **History of this note** from the command palette. Your typing is one entry with no "saves" count, and its +/− counts are your three lines.
3. Select it and press **Restore to before**. The letter is back to how it started. Press **Undo** on the toast and your lines come back.
4. Type a line in [[Draft letter]], type a line in any other note, then come back and type one more. History for the letter shows 2 saves: the note switch started a new change.
5. With an agent connected, type in [[Draft letter]], have the agent append "P.S. Bring gloves." to it, then type again. History lists your typing, the agent's edit, and your typing again as separate changes. The agent's toast **Undo** takes out only its line.
