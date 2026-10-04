---
pr: 285
title: Task queries with ranges, priority and done dates
---
1. Open [[Weekly review]]. Its three task lists are empty for now, because its tasks have no dates yet.
2. In the Tasks section, give "Book flights" a due date in a few days (click into the line, type ` due:` and pick one). It shows up in "Due this week, high priority". Give "Renew passport" a due date next month: it stays out, because the list only shows the next 7 days (`due>=today due<=+7d`).
3. Give "Plan the offsite" a start date (`start:`) in the next few days. It appears in "Starts this week", even though open tasks that start later are usually hidden.
4. Tick "Water the plants". It appears in "Done this week" (`done>=-7d`), which opens on its Done tab.
5. Click the gear on any of the lists. The new **Starts**, **Done** and **Priority** fields are there, and the preview at the bottom writes a range back as two parts, like `due>=today due<=+7d`.
6. Try a broken filter: change a list to `::tasks{due<=soon}`. It says what it takes instead.
7. From a terminal or an agent, the same words work: `commonink task list --due '>=today <=+7d' --priority high`, `commonink task list --done-date '>=-7d'`, or MCP `list_tasks` with `due`, `start`, `done` and `priority`.
