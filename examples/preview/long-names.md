---
pr: 133
title: Long note names get a clear answer
---
Locally, a note name longer than the disk allows (255 bytes) got "Internal error". A name a little under the limit failed too, because the temporary file used for the save had a longer name still. Now the long one says the name is too long, and the one under the limit saves. Online there's no such limit, so nothing changes there.

1. Run Common Ink locally. In a terminal, try `quire create "$(printf 'x%.0s' {1..300})"`. It says the name is too long.
2. Try a 245-character name the same way. It's created.
3. In [[A note to rename]], paste a 300-character heading over its heading and click in the text below. The note takes the heading's first 120 characters as its name.
