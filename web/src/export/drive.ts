// Save to Google Drive (#47), online: the Share menu's last item. A small dialog picks what the note
// becomes there (a Google Doc, the default; a PDF; or its markdown file), and it goes into a folder
// named Common Ink in the person's Drive. A Doc and a PDF start from the Word export (the static
// render: widgets as a snapshot, links to notes as their web addresses), which Drive converts (and
// for a PDF, then exports); the markdown file has its links to notes made web addresses too. The first
// time, Google asks to let Common Ink make files in Drive (only the files it makes: drive.file), and
// the person comes back to the note with the dialog open again (main.ts). The server: cloud/src/drive.ts.
import { api, ApiError } from "../api.ts";
import { el } from "../dom.ts";
import { store } from "../store.ts";
import { toast } from "../toast.ts";
import { ask } from "../trash.ts";
import { calendarWorkspace } from "../calendar/data.ts";
import { relink, type LinkPlan } from "../../../src/core/export.ts";
import { notePath } from "../../../src/core/ids.ts";
import type { Printable } from "./print.ts";

export type DriveFormat = "doc" | "pdf" | "md";

const FORMATS: ReadonlyArray<{ value: DriveFormat; label: string; hint: string }> = [
  { value: "doc", label: "Google Doc", hint: "to edit in Google Docs" },
  { value: "pdf", label: "PDF", hint: "to read or print, as it looks here" },
  { value: "md", label: "Markdown file", hint: "the note's text as it is" },
];
const isFormat = (s: unknown): s is DriveFormat => FORMATS.some((f) => f.value === s);

/** Where the person goes to let Common Ink save to Drive, coming back to this note, in this workspace, with `as` picked. */
export function driveConnectUrl(as: DriveFormat) {
  const w = calendarWorkspace();
  return `/auth/google/drive?${new URLSearchParams({ next: `${location.pathname}${w ? `?w=${encodeURIComponent(w)}` : ""}`, as })}`;
}

/** Leave the app for Google's consent page. An object, so tests can see where it would go. */
export const leaveFor = { to: (url: string) => location.assign(url) };

/**
 * The note's markdown with each link to a note (itself too) made a link to its web address, as a
 * .zip export does for notes left out of it. Two passes: the first gathers what the links name,
 * then those are resolved over the API, and the second rewrites them.
 */
export async function webMarkdown(note: Printable): Promise<string> {
  const named = new Map<string, [string, string]>();
  const key = (target: string, from: string) => `${from}\u0000${target}`;
  relink(note.content, note.path, { resolve: (t, from) => (named.set(key(t, from), [t, from]), null), included: () => false, url: () => null, uses: () => {} });
  if (!named.size) return note.content;
  const metas = await api.notes();
  const paths = new Map(await Promise.all([...named].map(async ([k, [t, from]]) => [k, await api.resolve(t, from).catch(() => null)] as const)));
  const plan: LinkPlan = {
    resolve: (t, from) => paths.get(key(t, from)) ?? null,
    included: () => false,
    url: (rel) => {
      const meta = metas.find((m) => m.path === rel);
      return meta ? `${location.origin}${notePath(meta.title, meta.id)}` : null;
    },
    uses: () => {},
  };
  return relink(note.content, note.path, plan);
}

/** Save the note to Drive as `as`, with a toast while it goes and one to open it once it's there. */
export async function saveToDrive(note: Printable, as: DriveFormat): Promise<void> {
  toast({ icon: "drive", text: "Saving to Google Drive…" });
  try {
    const file =
      as === "md"
        ? new Blob([await webMarkdown(note)], { type: "text/markdown;charset=utf-8" })
        : await (await import("./files.ts")).docxFile(note);
    const saved = await api.saveToDrive(as, note.title, file);
    toast({ icon: "drive", text: `Saved to Google Drive: ${saved.name}`, actionLabel: "Open in Drive", action: () => void window.open(saved.url, "_blank", "noopener") });
  } catch (e) {
    const text = `Couldn't save to Google Drive: ${e instanceof Error ? e.message : String(e)}`;
    // Access was taken back at Google (or never given): connecting again asks for it.
    if (e instanceof ApiError && e.data?.connect) toast({ text, actionLabel: "Connect", action: () => leaveFor.to(driveConnectUrl(as)) });
    else toast({ text });
  }
}

/**
 * The dialog: what to save the note as, then save it (or, the first time, go to Google to allow it).
 * `as` picks the format first (coming back from Google); else the last one picked here, else a Doc.
 */
export async function openSaveToDrive(note: Printable, as?: DriveFormat): Promise<void> {
  const status = await api.google().catch(() => null);
  if (!status || status.mode === "off") return toast({ icon: "drive", text: "Google isn't configured on this server" });
  const c = status.connection;
  const ready = !!c?.drive;
  const last = store.get<unknown>("driveFormat", "doc");
  const picked: DriveFormat = as ?? (isFormat(last) ? last : "doc");
  const radios = FORMATS.map((f) =>
    el("label", { class: "drive-choice" }, el("input", { type: "radio", name: "drive-format", value: f.value, checked: f.value === picked }), el("b", {}, f.label), el("span", {}, f.hint)),
  );
  const choices = el("fieldset", { class: "drive-choices" }, el("legend", { class: "sr-only" }, "Save as"), ...radios);
  const where = el("p", {}, "It goes in a folder named Common Ink in your Google Drive", c?.account && ready ? ` (${c.account})` : "", ". Links to other notes become links to them here.");
  const body: Array<string | HTMLElement> = [choices, where];
  if (!ready) body.push("Google will ask you to let Common Ink add files to your Drive. It can see only the files it makes there, nothing else.");
  if (status.mode === "mock") body.push(el("p", { class: "drive-demo" }, "This server has no Google set up, so a stand-in plays Google's part and nothing reaches Drive."));
  const go = await ask({
    title: `Save “${note.title}” to Google Drive`,
    body,
    actions: [{ label: ready ? "Save" : "Continue to Google", value: "go", kind: "primary" }],
  });
  if (go !== "go") return;
  const chosen = choices.querySelector<HTMLInputElement>("input:checked")?.value;
  const format: DriveFormat = isFormat(chosen) ? chosen : "doc";
  store.set("driveFormat", format);
  if (!ready) return leaveFor.to(driveConnectUrl(format));
  await saveToDrive(note, format);
}

const OUTCOMES: Record<string, string> = {
  denied: "Nothing was saved to Google Drive: access wasn't allowed",
  failed: "Couldn't connect Google Drive. Try again.",
};

/** Back from Google (?drive=connected|denied|failed): open the dialog again, or say why not. Returns the format to preselect, if any. */
export function driveOutcome(outcome: string, as: string | null): { again: DriveFormat } | { text: string } | null {
  if (outcome === "connected") return { again: isFormat(as) ? as : "doc" };
  return OUTCOMES[outcome] ? { text: OUTCOMES[outcome] } : null;
}
