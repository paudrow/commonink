---
pr: 183
title: Smart folder filters
---
1. Press ⌘K and pick **New smart folder**. Name it "Health journal", set **Tags** to `health`, then use the # button to pick `journal` too: the field reads `health, journal` and the count says 2 notes match (Run log and Swim, not Gym plan or Sleep notes). Set **Sort** to **Newest by date** and save. Swim (2025-06-10, from its name) lists above Run log (2024-03-01, from its frontmatter).
2. Make another with **Folder** `Try/Smart folder filters/Health and Fitness` and **Sort** **Oldest by date**. It saves without complaining about "and". Gym plan (created 2023) lists first.
3. In **Notes**, the sort menu now offers **Recently changed**, **Newest by date**, **Oldest by date** and **By title**.
4. From the CLI or an agent: `commonink smart-save Both tag=health tag=journal sort=date` saves `tag="health,journal" sort=date`.
