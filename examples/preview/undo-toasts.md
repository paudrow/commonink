---
pr: 84
title: Undo from any toast
---
Every toast that can be undone now waits while you point at it or tab into it, stays 10 seconds, and is read out to screen readers. ⌘Z (Ctrl+Z off a Mac) presses the newest Undo whenever you aren't typing in a note or a field.

1. **Tick a task.** Open **Tasks** and tick "Call Sam about the venue" from [[Launch checklist]]. It stays a moment, struck through, then leaves the Open list, and a toast says "Done: Call Sam about the venue". Press ⌘Z: it's open again. Tick another and click **Undo** instead. The `::view{show=tasks}` list in [[Launch checklist]] and Today do the same.
2. **Hover and keyboard.** Tick one more and rest the pointer on the toast: it stays for as long as you like. Move away and it goes a couple of seconds later. Tick again, then press Tab until the toast's Undo has the focus (the toasts come last on the page): it stays, and Esc closes it.
3. **Undo an agent's edit.** Connect an agent to this Preview (see "Connect an agent" if it's there: the connector URL is this Preview's address plus `/mcp`). Open [[Agent scratchpad]], click at the end of the pricing line and type a few words. Then ask the agent to change "Friday" to "Monday" in Agent scratchpad. Its toast now has **Undo**: click it. "Friday" comes back, and your words stay.
4. **A note that isn't open.** Open another note. In one message, ask the agent to change "2000" to "2500" in [[Agent scratchpad]], and then "2500" to "3000". Two toasts come, each with **Open** and **Undo** (rest the pointer on them to keep them). Click **Undo** on the older one: it says the note changed since and leaves it alone. The newer one's Undo puts "2500" back.
5. **Compare in a conflict.** Open [[Agent scratchpad]] in two windows side by side. Type on the "Friday" line in one, then within half a second type on the same line in the other. The window you typed in last shows the conflict banner, now with **Compare**: it shows the two versions as a diff, with Keep mine and Use theirs. Choose **Use theirs**, then press ⌘Z (or click Undo on its toast): your version is back.
