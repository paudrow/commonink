---
pr: 139
title: Agents use your day
---
1. Connect an agent to this Preview: `claude mcp add --transport http commonink-preview <this Preview's address>/mcp`, then `/mcp` in Claude Code to sign in. Pick your personal workspace.
2. Ask it "what's on today?". The heading and `Journal/` date are your day, not UTC's. After 7pm Central it still says today, not tomorrow.
3. Ask it to "add a task: call mom tomorrow". It goes in today's journal note with tomorrow's `due:`.
4. Ask it to tick "Pay the electric bill" in [[Agent dates]]. It gets `done:` with today's date.
5. Now pretend to be far east of UTC. In Chrome DevTools, open ⋮ › More tools › Sensors, and set **Timezone ID** to `Pacific/Kiritimati` (UTC+14). Reload the app, keeping DevTools open. Ask the agent "what's on today?" again: it's a day ahead of UTC, as in Kiritimati. Clear the override and reload to go back.
