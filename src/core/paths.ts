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
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Headers for serving a stored file. Files are writable by agents and teammates, so none may run
 * script in our origin (an SVG opened directly, say): everything is sandboxed, except PDFs, which
 * browsers render in their own isolated viewer and refuse to show inside a sandbox. Only the app
 * itself may frame them.
 */
export function fileSecurityHeaders(mime: string): Record<string, string> {
  const policy = mime === "application/pdf" ? "" : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; ";
  return { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": `${policy}frame-ancestors 'self'` };
}

/** Largest file accepted through the upload API. */
export const MAX_UPLOAD = 50 * 1024 * 1024;

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
  if (!norm || norm === "." || norm.startsWith("..") || path.posix.isAbsolute(norm) || /[\x00-\x1f\x7f]/.test(norm)) {
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

/**
 * "Projects/Roadmap.md" -> "roadmap". In composed Unicode, like linkKey, so a file named in
 * decomposed form (as older Macs wrote names) matches the links typed to it.
 */
export function stemOf(p: string): string {
  const base = path.posix.basename(p);
  return (kindOf(p) === "md" ? base.replace(/\.(md|markdown)$/i, "") : base).normalize("NFC").toLowerCase();
}

/** Lowercased link key for a wikilink / markdown link target, in composed Unicode. */
export function linkKey(target: string): string {
  return target
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/#.*$/, "")
    .replace(/\.(md|markdown)$/i, "")
    .normalize("NFC")
    .toLowerCase();
}

export class QuireError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "conflict" | "invalid" | "exists" | "forbidden" = "invalid",
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}
