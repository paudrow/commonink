import path from "node:path";

export type NoteKind = "md" | "html" | "asset";

const MD = new Set([".md", ".markdown"]);
const HTML = new Set([".html", ".htm"]);
const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

export function kindOf(p: string): NoteKind | null {
  const ext = path.posix.extname(p).toLowerCase();
  if (MD.has(ext)) return "md";
  if (HTML.has(ext)) return "html";
  if (ext in ASSET_TYPES) return "asset";
  return null;
}

export function mimeOf(p: string): string | null {
  return ASSET_TYPES[path.posix.extname(p).toLowerCase()] ?? null;
}

/** Normalize a vault-relative path and refuse anything that escapes the vault or touches dotfiles. */
export function cleanPath(input: string): string {
  const raw = input.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  const norm = path.posix.normalize(raw);
  if (!norm || norm === "." || norm.startsWith("..") || path.posix.isAbsolute(norm)) {
    throw new QuireError(`Invalid path: ${input}`);
  }
  if (norm.split("/").some((seg) => seg.startsWith("."))) {
    throw new QuireError(`Hidden paths are not allowed: ${input}`);
  }
  return norm;
}

export function isHidden(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith("."));
}

/** "Projects/Roadmap.md" -> "roadmap" */
export function stemOf(p: string): string {
  const base = path.posix.basename(p);
  return (kindOf(p) === "md" ? base.replace(/\.(md|markdown)$/i, "") : base).toLowerCase();
}

/** Lowercased link key for a wikilink / markdown link target. */
export function linkKey(target: string): string {
  return target
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/#.*$/, "")
    .replace(/\.(md|markdown)$/i, "")
    .toLowerCase();
}

export class QuireError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "conflict" | "invalid" | "exists" = "invalid",
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}
