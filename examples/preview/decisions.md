---
pr: 230
title: Decisions on the Today page
---
1. Click **Today**. Under the quick-add bar, **Decisions** shows eight questions an agent asked with `ask_decision`, one of each kind, "1 of 8". The agent's pick starts picked and says **Recommended**.
2. Step through them with → and ←: pick one (with a line about each option), a choice for each talk (**Go / Maybe / Skip**; a column's heading sets every row), two covers side by side, yes or no (`Y` / `N`), pick up to three, put work in order (the arrows move a row), a 1 to 5 scale, and one in words.
3. On any of them, add a **Comment** and press Enter (or **Decide**). A toast says what you decided; **Today's note** in it opens your daily note, where the answer is under **## Decisions** (the talks as one line each).
4. Press `S` (or **Skip**) to leave one for later. Once only skipped ones are left, the card says so, with **Show them again**. **Not deciding** closes one without an answer, and the note says so. Type in **Or answer in your own words…** to answer differently from the options.
5. Press ← (or the back arrow) to go back to one you've answered today. It says **Answered: …**; pick something else and press **Change answer**. Its lines in today's note are rewritten in place, not added again. After the last one, **Go back to change one** (or ←) takes you back.
6. Agents: `commonink decision ask "Which talks?" --kind rows --rows "Keynote,Panel" --options Go,Skip`, then `commonink decisions --status settled` to read the answer.
