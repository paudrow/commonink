---
pr: 134
title: Google Calendar
---
This Preview has no Google OAuth client, so a stand-in plays Google's part, with demo calendars. It runs the same connection, token and sync code as real Google.

1. Open **Calendar**, press **Calendars**, then **Connect Google Calendar**. The stand-in's consent page asks to see your calendars: press **Allow**.
2. Back in Calendars, turn on **Show here** for **Dev (demo Google)**. **Product sync** appears on Tuesdays and Thursdays at 1 PM Los Angeles time, marked as yours alone.
3. Turn on **Link meeting notes** for it. The stand-in asks again, this time to edit events. Then open a **Product sync** and press **Create meeting note**: the toast says its link was added in Google Calendar. Open the event again: its description ends with a "Common Ink" block linking to the note, and nothing of the note's text.
4. Switch to the **Launch team** workspace, turn on **Family (demo Google)** there, then sign in as Sam ([/auth/dev?as=sam](/auth/dev?as=sam)): in Launch team, Sam's Calendar has none of your Google events.
5. As yourself again, press **Disconnect** in Calendars: your Google calendars leave every workspace.
