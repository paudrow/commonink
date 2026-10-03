---
pr: 346
title: Views are notes in Views/
---
Smart folders are now **Views**: each is a note in `Views/` holding one `::view{…}` line. A Preview starts fresh, so step 6 is the one to try locally on a vault that had smart folders.

1. Click the **+** on the **Views** header (where Smart folders were). Name it "Meetings", pick Tag `meeting`, and Save: it opens in Notes with its count, and the toast says it's a note in `Views/`.
2. In the file tree, open `Views/Meetings.md` (online it's in `Views/` if you ticked **Share with workspace**, else in `Views/<your user ID>/`). The note shows the live list of meeting notes. Type a line above the `::view` line: the view in the sidebar still works.
3. Back in the sidebar, click the view's sliders and rename it "Team meetings", Sort **By title**, Save. The note is now `Team meetings.md`, your line above the query is still there, and its query line says `sort=title`.
4. In **Notes**, pick Folder `Projects` and press **Save as view**. Then rename the `Projects` folder (its row's menu, Rename): open the new view's note and its query line now names the new folder. Rename it back.
5. Delete a view from its sliders: the confirmation names its note, and the note is in **Trash**, where restoring it brings the view back.
6. Locally only: on `main`, save a smart folder or two (one starred), then check out this branch and run `npm run dev` on the same vault. Each one is now a note in `Views/`, the star is still on it, and History shows "Common Ink" made them.
