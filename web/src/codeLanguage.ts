// Which language a fenced code block is in, from the first word of its info string. The editor's
// highlighting and rendered blocks (code.ts) both ask here, so a block reads the same everywhere.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/** Names that mean "no language": shown as plain text rather than guessed at (`text` would match LaTeX). */
const PLAIN = new Set(["text", "txt", "plain", "plaintext", "console", "output", "log", "none"]);
/** Common names the language list doesn't know as aliases. */
const ALIASES: Record<string, string> = { py: "python", rs: "rust", md: "markdown", patch: "diff", docker: "dockerfile", yml: "yaml", jsonc: "json", zsh: "shell", sh: "shell", bash: "shell", ts: "typescript", js: "javascript" };

/** The language a fence's first word names, by name, alias or file extension; null for plain text. */
export function codeLanguage(name: string): LanguageDescription | null {
  const n = name.trim().toLowerCase();
  if (!n || PLAIN.has(n)) return null;
  const want = ALIASES[n] ?? n;
  return (
    LanguageDescription.matchLanguageName(languages, want, false) ??
    LanguageDescription.matchFilename(languages, `x.${n}`) ??
    LanguageDescription.matchLanguageName(languages, want, true)
  );
}

/** Every language by name, for the picker. */
export const languageNames = () => languages.map((l) => l.name).sort((a, b) => a.localeCompare(b));

/** How a picked language is written in a fence: its shortest alias ("ts" for TypeScript), as people write it. */
export function shortName(name: string): string {
  const d = languages.find((l) => l.name === name);
  const alias = d?.alias.filter((a) => /^[a-z0-9+#-]+$/.test(a)).sort((a, b) => a.length - b.length)[0];
  return alias ?? name.toLowerCase();
}
