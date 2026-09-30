---
pr: 130
title: Calendar and ICS subscriptions
---
1. Open **Calendar** in the sidebar. This Preview subscribes to two calendars: **Launch team (demo)**, served by the Preview itself, and **US holidays**, a real public feed read from Google. Switch between Month, Week, Day and Agenda with `m`, `w`, `d` and `a`; `t` is today, `j` and `k` go forward and back.
2. In Week, find **All hands (hosted in Berlin)** on the first Tuesday of the month. It's set at 18:00 in Berlin, so it shows at your own time for that, and it moves when Berlin's clocks change, not yours.
3. Open **Standup** and press **Create meeting note**. It opens `Meetings/<date> Standup.md` with the time, the people and a link back to the event. Open the event again: it now says **Open meeting note**.
4. Press **Calendars** and subscribe to another feed: paste an ICS or `webcal://` link (Google Calendar's "Secret address in iCal format" works). Try `http://localhost/cal.ics` too: it's refused, since feeds are read from public addresses only.
5. Open **Tasks**: today's events are at the top, in Today. [[Agenda]] shows the next three days as an `::agenda` widget, next to a `::calendar` with each day's events.
6. In any note, type `@stand` or `[[stand`: upcoming events are offered, and picking one links to it.
