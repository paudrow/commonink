// What kind of file an asset is, for icons, filters and previews.
export type AssetType = "image" | "pdf" | "video" | "audio" | "other";

export function assetType(path: string): AssetType {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg"].includes(ext)) return "audio";
  return "other";
}

export const ASSET_ICON: Record<AssetType, string> = { image: "image", pdf: "pdf", video: "video", audio: "audio", other: "paperclip" };
export const ASSET_LABEL: Record<AssetType, string> = { image: "Images", pdf: "PDFs", video: "Video", audio: "Audio", other: "Other" };

export const extOf = (path: string) => (path.includes(".") ? path.split(".").pop()!.toUpperCase() : "FILE");

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
