// A fenced code block's info string, the text after its opening ``` (see AGENTS.md):
//
//   ```ts nowrap title="server.ts" {3-5} showLineNumbers
//
// The first word is the language. The rest are optional settings, each a word GitHub and other
// renderers ignore: `nowrap` (long lines scroll instead of wrapping) or `wrap` (overrides a
// no-wrap default), a `title`, lines to highlight, and line numbers. Anything else is kept as
// written. Edits change one setting in place and leave the rest of the string alone. No Node
// imports: the editor uses this too.

export type Wrap = "wrap" | "nowrap";

export interface Fence {
  /** The language as written ("ts", "Python"), or "" for none. */
  lang: string;
  /** Null when the block doesn't say, and the reader's default applies. */
  wrap: Wrap | null;
  title: string | null;
  /** Lines to highlight, counted from 1 in the code. */
  highlight: Set<number>;
  lineNumbers: boolean;
}

/** A setting's token: `nowrap`, `title="x"`, `{3-5}`. Each alternative is linear, so no input backtracks. */
const TOKEN = /\{[^}]*\}|[\w-]+="[^"]*"|\S+/g;
const TITLE = /^title=(?:"([^"]*)"|(\S*))$/i;
/** Long enough for any real info string; past this, the rest is ignored. */
const MAX_INFO = 500;
/** No block has more lines worth highlighting than this. */
const MAX_HIGHLIGHT = 5000;

const tokens = (info: string) => info.slice(0, MAX_INFO).match(TOKEN) ?? [];
const isSetting = (t: string) => /^(no)?wrap$/i.test(t) || TITLE.test(t) || /^\{.*\}$/.test(t) || /^showlinenumbers$/i.test(t);
/** Whether the first word is a language rather than a setting. */
const startsWithLang = (words: string[]) => words[0] !== undefined && !isSetting(words[0]);

/** Read an info string. */
export function parseFence(info: string): Fence {
  const words = tokens(info.trim());
  const fence: Fence = { lang: "", wrap: null, title: null, highlight: new Set(), lineNumbers: false };
  words.forEach((w, i) => {
    if (i === 0 && !isSetting(w)) fence.lang = w;
    else if (/^(no)?wrap$/i.test(w)) fence.wrap = w.toLowerCase() as Wrap;
    else if (TITLE.test(w)) {
      const m = w.match(TITLE)!;
      fence.title = m[1] ?? m[2];
    } else if (/^showlinenumbers$/i.test(w)) fence.lineNumbers = true;
    else if (/^\{.*\}$/.test(w)) {
      for (const part of w.slice(1, -1).split(",")) {
        const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
        if (!m) continue;
        const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
        for (let n = a; n <= b && fence.highlight.size < MAX_HIGHLIGHT; n++) if (n > 0) fence.highlight.add(n);
      }
    }
  });
  return fence;
}

/** The info string with its language set (or cleared with ""), settings kept. */
export function setFenceLang(info: string, lang: string): string {
  const words = tokens(info.trim());
  if (startsWithLang(words)) words.shift();
  return [lang.trim(), ...words].filter(Boolean).join(" ");
}

/** The info string with its wrap setting set, or removed (null) so the reader's default applies. */
export function setFenceWrap(info: string, wrap: Wrap | null): string {
  const words = tokens(info.trim());
  const lang = startsWithLang(words) ? [words.shift()!] : [];
  const rest = words.filter((w) => !/^(no)?wrap$/i.test(w));
  return [...lang, ...(wrap ? [wrap] : []), ...rest].join(" ");
}

/** Whether a block's long lines wrap, given the reader's default. */
export const wraps = (fence: Fence, byDefault: boolean) => (fence.wrap ? fence.wrap === "wrap" : byDefault);

/**
 * The change that flips a block's wrapping for someone whose default is `byDefault`: a setting
 * only when the block should differ from the default, so most blocks stay plain ```ts.
 */
export function toggleWrap(info: string, byDefault: boolean): string {
  const next = !wraps(parseFence(info), byDefault);
  return setFenceWrap(info, next === byDefault ? null : next ? "wrap" : "nowrap");
}

/** How a `diff` block's line reads: added, removed, or neither. File headers (+++, ---) are neither. */
export function diffLine(line: string): "add" | "del" | null {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return null;
}

/**
 * Whether markdown has a fenced code block: a line opening with ``` or ~~~ (indented, or in a
 * list or quote, too). An unclosed fence counts, as it's a block to the end of the note. A line
 * like ```x``` is inline code, not a fence. The status bar shows its Wrap code switch only then.
 */
export const hasFencedCode = (md: string) => /^[ \t>]*(?:[-*+] +|\d+[.)] +)?(?:`{3,}[^`\n]*$|~{3,})/m.test(md);
