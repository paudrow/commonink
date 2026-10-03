// Saving a note to Google Drive (#47): as a Google Doc, a PDF or its markdown file, in a "Common Ink"
// folder in the person's Drive. Nothing is converted here: the app sends the note as Word (its static
// render, widgets as a snapshot and links to notes as their web addresses), or as markdown, and Drive
// converts it to a Google Doc on upload. A PDF is that Doc, exported by Drive, and the Doc then goes.
// The scope is drive.file, the narrowest: Common Ink sees only the files and folder it made, and asks
// for it the first time someone saves (connections.ts). No Workers imports, so tests run this against
// a fake Google.
import { SAVE_FORMATS, type SaveFormat } from "../../src/core/export.ts";
import { GoogleError } from "./google.ts";

export const DRIVE = {
  api: "https://www.googleapis.com/drive/v3",
  upload: "https://www.googleapis.com/upload/drive/v3",
};
export type DriveEndpoints = typeof DRIVE;

/** Only files Common Ink made (or the person opened with it): never the rest of their Drive. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** What a note is saved as: a Google Doc (editable), a PDF, or its markdown file as it is. */
export const DRIVE_FORMATS = SAVE_FORMATS;
export type DriveFormat = SaveFormat;

/** The folder notes go in, made the first time. */
export const DRIVE_FOLDER = "Common Ink";

export const MIME = {
  doc: "application/vnd.google-apps.document",
  folder: "application/vnd.google-apps.folder",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  pdf: "application/pdf",
};

/** The most a note may be to save: Drive converts Word files up to 50 MB. */
export const MAX_DRIVE_BYTES = 50 * 1024 * 1024;

/** A file in Drive, and where to open it. */
export interface DriveFile {
  id: string;
  name: string;
  url: string;
}

/** What saving needs from Drive: the real API (DriveClient) or, on Previews, a stand-in (google-mock.ts). */
export interface DriveApi {
  /** The ID of the folder by this name that Common Ink made (drive.file sees no other), or of a new one. */
  folder(name: string): Promise<string>;
  /** Add a file. With `mimeType` a Google type, Drive converts `data` (of type `type`) to it. */
  upload(meta: { name: string; mimeType?: string; parents?: string[] }, data: Uint8Array, type: string): Promise<DriveFile>;
  /** A Google Doc as a PDF, drawn by Drive. */
  pdf(id: string): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
}

/** What's saved: the note's title, and the note as Word or markdown. */
export interface DriveSource {
  title: string;
  type: "docx" | "md";
  data: Uint8Array;
}

/**
 * A path in this app to come back to after connecting, never another site: not "//evil.example",
 * "/\evil.example", or "/\t/evil.example" (URLs drop tabs and newlines, which would make it the first).
 */
export const appPath = (s: string | null) => (s && /^\/(?![/\\])[^\s\u0000-\u001f\u007f]*$/.test(s) && s.length <= 1000 ? s : "/");

/** A title as a file name: no slashes or control characters, not empty, not too long. */
export const fileTitle = (title: string) =>
  title
    .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "Untitled";

/**
 * Save a note to Drive in the Common Ink folder. A Google Doc is the note converted by Drive; a PDF
 * is that Doc exported by Drive (the Doc is a step on the way and goes once the PDF is there); a
 * markdown file is the note's markdown, unconverted.
 */
export async function saveToDrive(api: DriveApi, source: DriveSource, as: DriveFormat): Promise<DriveFile> {
  const name = fileTitle(source.title);
  if (as === "md" && source.type !== "md") throw new GoogleError("A markdown file needs the note's markdown", 400);
  const parents = [await api.folder(DRIVE_FOLDER)];
  const type = source.type === "md" ? MIME.md : MIME.docx;
  if (as === "md") return api.upload({ name: `${name}.md`, mimeType: MIME.md, parents }, source.data, type);
  if (as === "doc") return api.upload({ name, mimeType: MIME.doc, parents }, source.data, type);
  const doc = await api.upload({ name, mimeType: MIME.doc, parents }, source.data, type);
  try {
    return await api.upload({ name: `${name}.pdf`, mimeType: MIME.pdf, parents }, await api.pdf(doc.id), MIME.pdf);
  } finally {
    await api.remove(doc.id).catch(() => {});
  }
}

/** What a Drive error says to the person: no scope (they took it back), the API off for this server, or Google's own words. */
export function driveProblem(e: unknown): string {
  if (!(e instanceof GoogleError)) return e instanceof Error ? e.message.replace(/^feed:/, "") : "Couldn't reach Google Drive";
  if (e.status === 401) return "Google Drive needs connecting again";
  if (/insufficient|scope/i.test(e.message)) return "Allow Common Ink to save to your Google Drive first";
  return `Google Drive: ${e.message}`;
}

export class DriveClient implements DriveApi {
  constructor(
    private token: () => Promise<string>,
    private endpoints: DriveEndpoints = DRIVE,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async send(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const res = await this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...init.headers }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GoogleError(data.error?.message ?? `Google answered ${res.status}`, res.status);
    }
    return res;
  }

  async folder(name: string): Promise<string> {
    const q = `name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType = '${MIME.folder}' and trashed = false`;
    const found = (await (await this.send(`${this.endpoints.api}/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" })}`)).json()) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) return found.files[0].id;
    const made = (await (
      await this.send(`${this.endpoints.api}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: MIME.folder }) })
    ).json()) as { id: string };
    return made.id;
  }

  // A resumable upload, so a note with big pictures goes in one PUT however large (a multipart upload stops at 5 MB).
  async upload(meta: { name: string; mimeType?: string; parents?: string[] }, data: Uint8Array, type: string): Promise<DriveFile> {
    const start = await this.send(`${this.endpoints.upload}/files?uploadType=resumable&fields=id,name,webViewLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(data.byteLength) },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get("Location");
    if (!session) throw new GoogleError("Google didn't start the upload", 502);
    const res = await this.send(session, { method: "PUT", headers: { "Content-Type": type }, body: data as Uint8Array<ArrayBuffer> });
    const file = (await res.json()) as { id: string; name: string; webViewLink?: string };
    return { id: file.id, name: file.name, url: file.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` };
  }

  async pdf(id: string): Promise<Uint8Array> {
    const res = await this.send(`${this.endpoints.api}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(MIME.pdf)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async remove(id: string): Promise<void> {
    await this.send(`${this.endpoints.api}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
