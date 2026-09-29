---
pr: 73
title: Code blocks
---
1. Open [[Code sampler]]. Each block is highlighted in its language (TypeScript, Python, shell, SQL, YAML, JSONC, Dockerfile, Rust), and the TypeScript block has a `server.ts` title.
2. Hover a block: **Copy** and a wrap toggle appear next to its language. Press **Copy**: it says "Copied", and pasting gives the code without the fences.
3. Hover the first long `js` line's block and press the wrap toggle: the line scrolls sideways, the note around it still wraps, and the fence now reads ```` ```js nowrap ````. Press it again to take `nowrap` off.
4. Click the language label (`PY`) and pick another language, or type one: the fence's first word changes.
5. Click inside any block's code: the cursor lands where you clicked and the block shows as markdown to edit. With the cursor in a block, ⌘⇧C (Ctrl+Shift+C off a Mac) copies its code; in vim, `yic` yanks it.
6. The `diff` block shows added lines in green and removed lines in red. The Rust block has line numbers and highlights lines 2 and 3.
7. Click **wrap** in the status bar to make long lines scroll by default; the first long block now scrolls too. Click it again to go back.
8. Open [[Code in an embed]], then **Notes**: the sampler's blocks look the same in the embed and on its card.
9. Switch the theme (the moon in the status bar): the colors follow in light and dark.
