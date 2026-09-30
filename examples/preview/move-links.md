---
pr: 106
title: Renames rewrite only the links to the note
---
Renaming or moving a note rewrites the links that pointed at it: all of them, and only those.

1. Open [[Links to plan]] and click "The budget". It opens [[Plan]] at its Budget heading.
2. Open [[Standup]]. "The plan" opens the Plan one folder up, and "Our plan" opens the team's own Plan.
3. In [[Plan]], click its file name in the top bar and rename it to `Plan (2027)`. The toast says it updated links in 2 notes.
4. Open [[Links to plan]]. "The budget" still lands on the Budget heading, and `[[Plan]]` became `[[Plan (2027)]]`. The `[[Plan]]` in the code span and in the code block are as typed.
5. Open [[Standup]]. "The plan" still opens the renamed note, and "Our plan" still opens the team's note.
6. On a Mac, running Common Ink locally: rename a note by changing only the case of its name, `plan` to `Plan`. It used to say the note already exists.
