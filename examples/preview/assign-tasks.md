---
pr: 97
title: Assigned tasks
---
In this Preview you're **Dev User**, so a task with `@Dev` is yours. Sam Dev is a contact (`People/Sam Dev`); in a team workspace, a member sees the tasks with their @name in their own Tasks, whoever's note they're in.

1. Open **Tasks** and choose **Assigned to me**: "Write the launch post" and "Send Priya the sandbox link" from [[Launch plan]].
2. Choose **Assigned by me**: the tasks you gave someone else in notes you made, grouped by person. `@Sam` and `@Sam-Dev` are one person, **Sam Dev**, and `@Priya` is Priya Shah.
3. In the quick-add bar, type `Book the room tomorrow @s`: Sam Dev is offered, and picking him writes `@Sam`. The same happens on a `- [ ]` line in a note.
4. Open **Contacts** → Sam Dev: his page lists his tasks, and you can tick one there.
5. Agents ask with `list_tasks` `{ "assignee": "me" }` or `{ "by": "me" }`, and the CLI with `quire tasks --assignee me` or `--by me`. Locally, where there are no accounts, "me" is `@me`.
