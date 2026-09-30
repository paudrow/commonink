---
pr: 77
title: Math
---
1. Open [[Math sampler]]. Inline math sits in its sentence, and the three blocks (`$$`, ```` ```math ```` and `\[ \]`) are drawn centered.
2. Click into $E = mc^2$: its source shows while the cursor is in it. Move away and it's drawn again.
3. Click the first block and change `\sqrt{\pi}` to `\pi`: the live preview under the source follows as you type.
4. Hover a block and press **Copy LaTeX**: pasting gives its source.
5. Open [[Math in a row]]. Press ↓ (or `j` with **Vim keys** on) from the top to the end, then ↑ (`k`) back: the cursor goes one line or one block at a time, into each of the three blocks in a row, never jumping past them. The block straight under a line of text is drawn too.
6. "it costs $5 and $10" and "\$20" stay text. The last formula is broken on purpose: it shows in red, and hovering it shows KaTeX's message. In the embed (step 9), Tab to it to show the message from the keyboard.
7. On a new line, type `/math` and pick **Math (inline)** or **Math (block)**.
8. Search (⌘K) for `pmatrix`: the sampler turns up, since search reads the LaTeX.
9. Open [[Math in an embed]], then **Notes**: the formulas are drawn in the embed and on the card too.
10. Switch the theme: math follows light and dark.
