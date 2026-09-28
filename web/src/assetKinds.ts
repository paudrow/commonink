// What kind of file an asset is, for icons, filters and previews.
export type AssetType = "image" | "pdf" | "video" | "audio" | "text" | "other";
/** How a text asset reads best: CSV as a table, JSON formatted, anything else as plain text. */
export type TextFormat = "csv" | "json" | "plain";

const ext = (path: string) => path.toLowerCase().split(".").pop() ?? "";

export function assetType(path: string): AssetType {
  const e = ext(path);
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(e)) return "image";
  if (e === "pdf") return "pdf";
  if (["mp4", "webm", "mov"].includes(e)) return "video";
  if (["mp3", "m4a", "wav", "ogg"].includes(e)) return "audio";
  if (["txt", "csv", "json"].includes(e)) return "text";
  return "other";
}

export const textFormat = (path: string): TextFormat => (ext(path) === "csv" ? "csv" : ext(path) === "json" ? "json" : "plain");

export const ASSET_LABEL: Record<AssetType, string> = { image: "Images", pdf: "PDFs", video: "Video", audio: "Audio", text: "Text", other: "Other" };
const TYPE_ICON: Record<AssetType, string> = { image: "image", pdf: "pdf", video: "video", audio: "audio", text: "file", other: "paperclip" };

/** The icon for one file: its type's, with CSV and JSON told apart. */
export function assetIcon(path: string): string {
  const type = assetType(path);
  if (type !== "text") return TYPE_ICON[type];
  return { csv: "table", json: "braces", plain: "file" }[textFormat(path)];
}
export const typeIcon = (type: AssetType) => TYPE_ICON[type];

export const extOf = (path: string) => (path.includes(".") ? path.split(".").pop()!.toUpperCase() : "FILE");

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
