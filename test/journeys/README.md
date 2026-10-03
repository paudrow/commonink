# User journeys

The few things everyone does in Common Ink, tested end to end the way they're done: by a person in a real browser, and by agents over MCP and the CLI. Each is a Given/When/Then scenario (Gherkin style) whose steps are node:test subtests, so a failure names the step, and the steps after it are skipped.

| File | Journey | Through |
| --- | --- | --- |
| `web.test.ts` | Capture a thought and find it again | browser |
| | Plan the day from Today | browser |
| | Gather notes by tag into a smart folder | browser, CLI |
| | Work alongside an agent, and undo what it did | browser, MCP |
| | Delete a note by mistake and get it back | browser |
| `agents.test.ts` | An agent keeps meeting notes from the shell | CLI, the files |
| | An agent over MCP and one in the shell work from the same notes | MCP, CLI |
| `hosted.test.ts` | Bring a teammate and their agent into a shared workspace | hosted API, CLI login |

```bash
npm run test:journeys   # each step by name; npm test runs them too
```

The browser journeys need headless Chromium: `npx playwright-core install chromium-headless-shell` (CI does this), or `COMMONINK_CHROMIUM=/path/to/chrome`. Without one they're skipped locally, and fail in CI. A failed step saves a screenshot of each page the journey had open (in `$JOURNEY_ARTIFACTS`, or the temp folder) and names it in the error; CI keeps them as the run's `journey-screenshots`.

A step the app doesn't pass yet is marked `{ todo: "why" }`: it runs and reports, but doesn't fail the run.

Writing one: `journey(title, ({ given, when, then, and }) => { … })` in `journey.ts`, which also starts the local app (`startLocalApp`), a browser profile (`person`, Vim keys on as on every test site), an MCP agent (`mcpAgent`) and the CLI (`commonink`). Act the way a person does: click by role and label, type with the keyboard, and check the result where it lands (the file on disk, what an agent reads back).
