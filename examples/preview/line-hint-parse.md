---
pr: 0
title: The empty-line hint reads the whole note
---
The "Type / for tools" hint on an empty line decided whether the line was code from however much of the note the parser had read so far. On a busy machine that could stop short, so the hint showed inside a code block or a list. It also made a test fail now and then in CI.

1. Open [[Long code]] and click the empty line inside the code block near the end. No hint shows.
2. Click the empty line between the two list items. No hint shows there either.
3. Click the empty line after the last paragraph. The hint shows.
