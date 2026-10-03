---
pr: 287
title: Filter notes by their properties
---
Notes can now be filtered by the properties in their frontmatter, like `status: draft`. Three sample notes have some: [[Pricing page]], [[Onboarding emails]] and [[Logo refresh]].

1. On Notes, press `/` and type `status=draft`. You see [[Pricing page]] and [[Onboarding emails]]. The second one has `status: [review, draft]`: a list matches if any item does.
2. Type `status=DONE`. You see [[Logo refresh]], whose frontmatter says `Status: Done`. Keys and values match in any case.
3. Type `owner=ana -status=done`. Only [[Pricing page]] is left.
4. Type `has=due`. Only [[Pricing page]] has a `due:`. Then try `-has=due owner=bo` for [[Onboarding emails]].
5. Open [[Pricing page]] and change `status: draft` to `status: done`. Back on Notes, `status=draft` now lists only [[Onboarding emails]].
6. In ⌘K, choose "New smart folder" and type `status=draft`. The live count matches the Notes list. Save it: it stays up to date as you edit.
7. In any note, add a line `::view{status=draft}` to list the drafts there.
