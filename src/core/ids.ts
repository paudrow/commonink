// Stable note IDs and the URLs built from them. No Node imports: the web app uses this too.
import { safeDecode } from "./uri.ts";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o or 1/l

/** An ID like "k3x9q2mf". It always has a digit and a letter, so it can't be mistaken for a word. */
export const NOTE_ID = /^(?=[a-z]*[2-9])(?=[2-9]*[a-z])[a-z2-9]{8}$/;

export function newNoteId(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    if (NOTE_ID.test(id)) return id;
  }
}

/** "Q3 plan: hiring & budget" → "q3-plan-hiring-budget". */
export function slugOf(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Where a note lives in the app: /notes/<title slug>-<id>. The slug is for people; the ID finds the note. */
export const notePath = (title: string, id: string) => {
  const slug = slugOf(title);
  return `/notes/${slug ? `${slug}-` : ""}${id}`;
};

/** The ID and slug in "/notes/q3-plan-k3x9q2mf" (or a full URL to it), or null if it isn't a note URL. */
export function parseNotePath(s: string): { id: string; slug: string } | null {
  const m = s.match(/(?:^|\/)notes\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!m) return null;
  const last = safeDecode(m[1]);
  const id = last.slice(-8);
  if (!NOTE_ID.test(id) || (last.length > 8 && last[last.length - 9] !== "-")) return null;
  return { id, slug: last.slice(0, -9) };
}
