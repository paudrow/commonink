// Quick capture (#18): the screen a share from another app lands on. The phone's share sheet posts
// to /share; the service worker (web/public/sw.js) keeps what came and opens /capture?share=<id>,
// which reads it back from there. /capture?title=…&text=…&url=… fills the screen too (handy on a
// desktop, or from a bookmark). Nothing is saved until you press Save: then it goes at the end of the
// note's Captured section (src/core/capture.ts), through the same API, and the same role checks, as
// any other edit.
import { api, ApiError, type NoteMeta } from "./api.ts";
import { el, icon } from "./dom.ts";
import { today } from "./taskChips.ts";
import { captureBlock, withCaptured, type Shared } from "../../src/core/capture.ts";

/** Where the service worker keeps shares (see web/public/sw.js). */
const SHARES = "commonink-shares";
const INBOX = "Inbox.md";
/** The last place picked, kept per browser: today's journal unless you chose otherwise. */
const WHERE = "commonink.capture";

export type Where = { kind: "today" } | { kind: "inbox" } | { kind: "note"; name: string };

/** A share the service worker kept: what it said, and its images as files. Null if it's gone. */
export async function readShare(id: string): Promise<{ shared: Shared; files: File[] } | null> {
  if (!/^[a-z0-9]{1,40}$/.test(id) || typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARES);
    const meta = await cache.match(`/shares/${id}`);
    if (!meta) return null;
    const m = (await meta.json()) as { title: string; text: string; url: string; files: Array<{ name: string; type: string }> };
    const files: File[] = [];
    for (const [i, f] of m.files.entries()) {
      const res = await cache.match(`/shares/${id}/${i}`);
      if (res) files.push(new File([await res.blob()], f.name, { type: f.type }));
    }
    return { shared: { title: m.title, text: m.text, url: m.url }, files };
  } catch {
    return null;
  }
}

/**
 * Register the service worker (web/public/sw.js): what makes Common Ink installable, and what
 * receives shares. Browsers without service workers get the app as a page, as before.
 */
export function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

/** Let a share go, saved or not. */
export async function forgetShare(id: string) {
  if (!/^[a-z0-9]{1,40}$/.test(id) || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(SHARES);
    for (const req of await cache.keys()) if (new URL(req.url).pathname.startsWith(`/shares/${id}`)) await cache.delete(req);
  } catch {}
}

export interface CaptureHooks {
  /** A viewer's workspace: nothing can be added. */
  readOnly(): boolean;
  notes(): NoteMeta[];
  /** Upload images; resolves to the names to embed them by. */
  upload(files: File[]): Promise<string[]>;
  /** Saved: show the note at the capture. */
  saved(path: string, line: number): void;
  /** Discarded: go on to Notes. */
  discarded(): void;
}

/** Save a capture in the chosen note, made if it's missing. Resolves to where it went. */
export async function saveCapture(where: Where, shared: Shared, files: File[], hooks: Pick<CaptureHooks, "upload" | "notes">): Promise<{ path: string; line: number }> {
  // Nothing to save: say so before making a note or uploading anything.
  if (!captureBlock(shared, files.map((f) => f.name)).length) throw new Error("There's nothing to save: add some text, a link or an image.");
  const path = await target(where, hooks.notes());
  const embeds = files.length ? await hooks.upload(files) : [];
  const block = captureBlock(shared, embeds);
  // Someone (or an agent) may change the note meanwhile: read it again and put the capture in again.
  for (let attempt = 0; ; attempt++) {
    const note = await api.note(path);
    const next = withCaptured(note.content, block);
    try {
      await api.save(path, next.content, note.version);
      return { path, line: next.line };
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409) || attempt >= 2) throw e;
    }
  }
}

async function target(where: Where, notes: NoteMeta[]): Promise<string> {
  if (where.kind === "today") return (await api.dailyNote(today())).path;
  const name = where.kind === "inbox" ? INBOX : where.name.trim().replace(/\.md$/i, "");
  if (!name) throw new Error("Pick a note to add it to.");
  const found = where.kind === "inbox" ? notes.find((n) => n.path === INBOX)?.path : ((await api.resolve(name).catch(() => null)) ?? undefined);
  if (found) return found;
  // A note that isn't there yet is made, like a [[link]] to a new note.
  const path = where.kind === "inbox" ? INBOX : `${name.replace(/[\\:*?"<>|#^[\]]/g, "").trim()}.md`;
  try {
    return (await api.create(path, `# ${path.replace(/\.md$/i, "").split("/").pop()}\n`)).path;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return path; // made meanwhile
    throw e;
  }
}

function lastWhere(): Where {
  try {
    const w = JSON.parse(localStorage.getItem(WHERE) ?? "null");
    if (w?.kind === "inbox" || w?.kind === "today") return { kind: w.kind };
    if (w?.kind === "note" && typeof w.name === "string") return { kind: "note", name: w.name };
  } catch {}
  return { kind: "today" };
}

/** The capture screen, in the page's stage. */
export class CapturePage {
  constructor(
    private host: HTMLElement,
    private hooks: CaptureHooks,
  ) {}

  /** Show a share: `share` names one the service worker kept ("none": it couldn't); `fields` fill it in otherwise. */
  async show(o: { share?: string | null; fields?: Shared }) {
    const kept = o.share && o.share !== "none" ? await readShare(o.share) : null;
    const shared: Shared = kept?.shared ?? o.fields ?? {};
    const files = kept?.files ?? [];
    const note =
      o.share === "none" ? "Common Ink couldn't read that share: it was still setting itself up. Share it again."
      : o.share && !kept ? "This share was saved or discarded already. Anything you type here is new."
      : null;
    this.render(shared, files, o.share ?? null, note);
  }

  private render(shared: Shared, files: File[], share: string | null, notice: string | null) {
    const readOnly = this.hooks.readOnly();
    const title = el("input", { class: "ws-input", id: "cap-title", value: shared.title ?? "", placeholder: "Title (optional)", autocomplete: "off" });
    const text = el("textarea", { class: "ws-input cap-text", id: "cap-text", rows: 4, placeholder: "Text" });
    text.value = shared.text ?? "";
    const url = el("input", { class: "ws-input", id: "cap-url", type: "url", value: shared.url ?? "", placeholder: "https://…", autocomplete: "off" });
    let keep = [...files];
    const thumbs = el("div", { class: "cap-images" });
    const drawThumbs = () =>
      thumbs.replaceChildren(
        ...keep.map((f, i) => {
          const img = el("img", { alt: f.name, src: URL.createObjectURL(f) });
          const drop = el("button", { type: "button", class: "icon-btn small", title: `Leave out ${f.name}`, "aria-label": `Leave out ${f.name}` }, icon("close", 14));
          drop.addEventListener("click", () => {
            keep = keep.filter((_, j) => j !== i);
            drawThumbs();
          });
          return el("figure", { class: "cap-image" }, img, drop);
        }),
      );
    drawThumbs();

    const last = lastWhere();
    const radio = (kind: Where["kind"], label: string, detail?: string) =>
      el(
        "label",
        { class: "cap-choice" },
        el("input", { type: "radio", name: "cap-where", value: kind, checked: last.kind === kind }),
        el("span", {}, label),
        detail ? el("span", { class: "cap-detail" }, detail) : null,
      );
    const list = el("datalist", { id: "cap-notes" }, ...this.hooks.notes().filter((n) => n.kind === "md").slice(0, 500).map((n) => el("option", { value: n.title })));
    const other = el("input", { class: "ws-input", id: "cap-note", list: "cap-notes", placeholder: "A note's name", value: last.kind === "note" ? last.name : "", autocomplete: "off", "aria-label": "Note to add it to" });
    other.addEventListener("focus", () => ((form.querySelector("input[value=note]") as HTMLInputElement).checked = true));
    const where = el(
      "fieldset",
      { class: "cap-where" },
      el("legend", {}, "Add it to"),
      radio("today", "Today's journal", `Journal/${today()}, under Captured`),
      radio("inbox", "Inbox", "Inbox, under Captured"),
      el("div", { class: "cap-choice cap-other" }, radio("note", "Another note"), other, list),
    );
    const error = el("p", { class: "cap-error", role: "alert" });
    const save = el("button", { type: "submit", class: "qw-btn primary", disabled: readOnly }, "Save");
    const discard = el("button", { type: "button", class: "qw-btn" }, "Discard");
    const form = el(
      "form",
      { class: "capture", "aria-labelledby": "cap-heading" },
      el("div", { class: "tr-head" }, el("div", { class: "tr-title" }, el("h1", { id: "cap-heading" }, "Capture")), el("p", {}, "From your share sheet. Check it over, then pick where it goes.")),
      notice ? el("p", { class: "cap-notice" }, notice) : null,
      readOnly ? el("p", { class: "cap-notice" }, "You can view this workspace but not add to it.") : null,
      el("label", { class: "cap-field" }, el("span", {}, "Title"), title),
      el("label", { class: "cap-field" }, el("span", {}, "Text"), text),
      el("label", { class: "cap-field" }, el("span", {}, "Link"), url),
      thumbs,
      where,
      error,
      el("div", { class: "cap-actions" }, discard, save),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (readOnly) return;
      const kind = (form.querySelector("input[name=cap-where]:checked") as HTMLInputElement | null)?.value ?? "today";
      const choice: Where = kind === "note" ? { kind: "note", name: other.value } : { kind: kind as "today" | "inbox" };
      error.textContent = "";
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const r = await saveCapture(choice, { title: title.value, text: text.value, url: url.value }, keep, this.hooks);
        try {
          localStorage.setItem(WHERE, JSON.stringify(choice));
        } catch {}
        if (share) await forgetShare(share);
        this.hooks.saved(r.path, r.line);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Couldn't save it. Try again.";
        save.disabled = false;
        save.textContent = "Save";
      }
    });
    discard.addEventListener("click", async () => {
      if (share) await forgetShare(share);
      this.hooks.discarded();
    });
    this.host.replaceChildren(form);
    (text.value || url.value ? save : text).focus({ preventScroll: true });
  }
}
