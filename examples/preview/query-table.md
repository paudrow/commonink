---
pr: 294
title: A table view for note lists
---
A `::view` (then `::query`) list can now show its notes as a table, with a column for each property you name. This uses the sample notes from the properties PR: [[Pricing page]], [[Onboarding emails]] and [[Logo refresh]].

1. Open any note and add this line: `::view{has=status layout=table fields=status,owner,due sort=title}`. You see a table with the columns Note, status, owner and due.
2. [[Onboarding emails]] has `status: [review, draft]`, so its status cell says "review, draft". Notes without a `due` show a dash.
3. Click a title in the table to open that note. ⌘-click (Ctrl-click) opens it to the side.
4. Change the line to `fields=status,tags,folder,modified`. `tags`, `folder` and `modified` work as columns for every note, even without frontmatter.
5. Open the widget's settings (the sliders button). There's a Layout menu and a Fields field.
6. Make the window narrow, or open it on your phone. The table scrolls sideways inside the widget instead of squeezing the words.
7. Share → Print… shows the same table on paper.

Editing a cell isn't in this PR yet: change a property in the note itself and the table updates.
