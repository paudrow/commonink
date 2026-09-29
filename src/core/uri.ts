// Note text is full of things that look like escapes and aren't ("[done](100%)"). No Node imports:
// the web app uses this too.

/** `decodeURIComponent`, or the text as it is when it isn't valid percent-encoding. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
