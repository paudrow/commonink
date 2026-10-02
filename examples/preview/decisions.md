---
pr: 230
title: Decisions on the Today page
---
1. Click **Today**. Under the quick-add bar, **Decisions** shows the first of three questions an agent asked (with `ask_decision`): the question, who asked, what they know, and the choices, with the one they'd pick already picked and marked **Recommended**.
2. Press `2` (or click **SQLite**), type a reason in **Why?**, and press Enter. A toast says what you decided and the next question comes up. **Today's note** in the toast opens your daily note: the answer is under **## Decisions**, with the reason under it.
3. Press `S` or → to skip a question and ← to come back. On the last one, type an answer of your own in **Or answer in your own words…** and press Enter. Click **Not deciding** on one to close it without an answer: the note says so.
4. With nothing left, the card says "All decided." Reload Today and it's gone until an agent asks again.
5. Agents: `commonink decision ask "Ship on Friday?" --options Yes,No --recommended 1`, then `commonink decisions --status settled` to read the answer.
