---
pr: 109
title: One note per file, however its path is typed
---
On a Mac, the disk ignores case and Unicode form. An agent that typed `try/…/case check` for [[Case check]] used to get a second copy of the note in Notes, Tasks and History until the next restart. This shows locally; online, paths were already exact.

1. Run Common Ink locally on a Mac with this branch's example vault copied in, and open [[Case check]].
2. In a terminal: `quire edit "try/one note per file, however its path is typed/case check.md" --old plants --new ferns`. It answers "Edited Try/One note per file, however its path is typed/Case check.md", in the note's own case.
3. `quire tasks` lists "Water the ferns" once. In the app, Notes shows one Case check, and History lists the edit under the note's own path.
4. A file whose name has an accent in decomposed form (common in folders copied from older Macs) now answers to `[[Café]]` typed on a keyboard, and its backlinks list the notes that link to it.
