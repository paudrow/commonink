---
pr: 0
title: Moving a note to a folder path keeps its name
---
An agent or the CLI moving a note to a folder path with a trailing slash, like `Archive 2025/`, used to fail with "can't change its file type from .md to" (and nothing after "to"). It now moves the note into that folder under its own name, as `mv` does. A path without the slash is still the note's new name.

1. With an agent connected to this workspace, ask it to move [[Move me into a folder]] to `Try/Moving a note to a folder path keeps its name/Filed/`, with the slash at the end.
2. The note is now in a Filed folder, still named "Move me into a folder", and [[Links to the moved note]] still opens it.
3. Locally: `quire mv "Move me into a folder" Filed/` does the same.
