# Jumps near cards

Each heading below sits right under a card or table. Put the cursor on a heading, then click the next heading in the Outline: the cursor lands on that heading, and the card's markdown stays hidden.

## Focus
::timer{duration=25m label="Focus"}
## After the timer
The timer's line only shows when the cursor is on it.

## Reading
https://example.com
## After the link card
Links to a heading in another note land on it too: [[Tea timer#Steep]].

## Numbers
| Day | Pages |
| --- | ----- |
| Mon | 12 |
| Tue | 9 |
## After the table
Press ↓ or `j` from the "Numbers" heading: the cursor still steps into the table.

## Joining lines
With vim on, press `J` on the next line.
Laps for today's run:
::stopwatch{label="Run"}
The stopwatch stays whole: `J` joins nothing across it. `3J` on "With vim on…" joins only the two lines above it.
