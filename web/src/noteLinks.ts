// Rendered markdown links a `[[note]]` as `commonink:<note>` (see renderMarkdown). HTML from before
// the rename may say `quire:`, the legacy scheme, so both open the note.
import { safeDecode } from "../../src/core/uri.ts";

const NOTE_LINK = /^(?:commonink|quire):/; // legacy quire: too

/** Links to notes, for querySelectorAll. */
export const NOTE_LINKS = 'a[href^="commonink:"], a[href^="quire:"]'; // legacy quire: too

/** The note an href links to (`commonink:Roadmap` → "Roadmap"), or null if it isn't a link to a note. */
export function noteTarget(href: string): string | null {
  const scheme = NOTE_LINK.exec(href);
  return scheme ? safeDecode(href.slice(scheme[0].length)) : null;
}
