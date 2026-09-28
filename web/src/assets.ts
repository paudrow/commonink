// Assets: every image, PDF, video, audio clip and document in the workspace, as a grid you can
// filter by type, sort, and search (with suggestions as you type). Drop files anywhere on the
// page to upload them; click one for a big preview, where it's used, and what you can do with it.
import { api, fileUrl, isArchived, type NoteMeta } from "./api.ts";
import { $, el, icon } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { ASSET_ICON, ASSET_LABEL, assetType, extOf, fmtBytes, type AssetType } from "./assetKinds.ts";

type Filter = AssetType | "all";
type Sort = "newest" | "oldest" | "name" | "size" | "type";

interface Hooks {
  notes(): NoteMeta[];
  upload(files: File[]): Promise<string[]>;
  open(path: string): void;
  archive(path: string): Promise<void>;
  embedName(path: string): string;
  toast(t: { text: string; icon?: string }): void;
}

const TYPES: AssetType[] = ["image", "pdf", "video", "audio", "other"];

export class Assets {
  readonly root = $("#assets-view");
  private grid: HTMLElement;
  private chips: HTMLElement;
  private input: HTMLInputElement;
  private suggest: HTMLElement;
  private sortSel: HTMLSelectElement;
  private countEl: HTMLElement;
  private picker: HTMLInputElement;
  private filter: Filter = "all";
  private sort: Sort = "newest";
  private shown: NoteMeta[] = [];
  private active = 0;
  private uploading: string[] = [];
  private previewing: string | null = null;

  constructor(private hooks: Hooks) {
    this.input = el("input", { placeholder: "Find an asset…", spellcheck: "false", autocomplete: "off", role: "combobox", "aria-expanded": "false" });
    this.suggest = el("div", { class: "as-suggest", role: "listbox", hidden: true });
    this.chips = el("div", { class: "as-chips" });
    this.sortSel = el(
      "select",
      { class: "as-sort", "aria-label": "Sort" },
      ...(
        [
          ["newest", "Newest"],
          ["oldest", "Oldest"],
          ["name", "Name"],
          ["size", "Largest"],
          ["type", "Type"],
        ] as const
      ).map(([v, t]) => el("option", { value: v }, t)),
    );
    this.picker = el("input", { type: "file", multiple: true, hidden: true });
    this.countEl = el("span", { class: "as-count" });
    this.grid = el("div", { class: "as-grid" });
    this.root.append(
      el(
        "div",
        { class: "assets" },
        el(
          "header",
          { class: "as-head" },
          el("div", { class: "as-title" }, el("h1", {}, "Assets"), this.countEl),
          el("button", { type: "button", class: "qw-btn primary", onclick: () => this.picker.click() }, icon("upload", 14), "Upload"),
          this.picker,
        ),
        el(
          "div",
          { class: "as-tools" },
          el("label", { class: "feed-search as-search" }, icon("search", 16), this.input, this.suggest),
          this.sortSel,
        ),
        this.chips,
        this.grid,
        el("div", { class: "as-drop" }, el("div", {}, icon("upload", 28), el("b", {}, "Drop to upload"), el("span", {}, "Files go in assets/"))),
      ),
    );

    this.input.addEventListener("input", () => ((this.active = 0), this.render()));
    this.input.addEventListener("keydown", (e) => this.searchKey(e));
    this.input.addEventListener("blur", () => setTimeout(() => this.closeSuggest(), 120));
    this.sortSel.addEventListener("change", () => ((this.sort = this.sortSel.value as Sort), this.render()));
    this.picker.addEventListener("change", () => {
      const files = [...(this.picker.files ?? [])];
      this.picker.value = "";
      if (files.length) void this.upload(files);
    });
    // Drop files anywhere on the page.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    this.root.addEventListener("dragenter", (e) => hasFiles(e) && (depth++, this.root.classList.add("is-dropping")));
    this.root.addEventListener("dragleave", (e) => hasFiles(e) && --depth <= 0 && ((depth = 0), this.root.classList.remove("is-dropping")));
    this.root.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
    this.root.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.root.classList.remove("is-dropping");
      void this.upload([...(e.dataTransfer?.files ?? [])]);
    });
  }

  get visible() {
    return !this.root.hidden;
  }

  show(opts: { open?: string } = {}) {
    this.root.hidden = false;
    this.render();
    if (opts.open) this.preview(opts.open);
    else this.root.focus({ preventScroll: true });
  }

  /** The list of files changed (upload, rename, archive, agent edits). */
  refresh() {
    if (this.visible) this.render();
  }

  private all(): NoteMeta[] {
    return this.hooks.notes().filter((n) => n.kind === "asset" && !isArchived(n.path));
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    const all = this.all();
    const counts = Object.fromEntries(TYPES.map((t) => [t, all.filter((n) => assetType(n.path) === t).length])) as Record<AssetType, number>;
    this.countEl.textContent = all.length ? `${all.length}` : "";
    this.chips.replaceChildren(
      ...(["all", ...TYPES] as Filter[])
        .filter((f) => f === "all" || counts[f as AssetType])
        .map((f) =>
          el(
            "button",
            { type: "button", class: `chip${f === this.filter ? " is-on" : ""}`, onclick: () => ((this.filter = f), this.render()) },
            f === "all" ? null : icon(ASSET_ICON[f], 13),
            f === "all" ? "All" : ASSET_LABEL[f],
            el("span", { class: "n" }, String(f === "all" ? all.length : counts[f])),
          ),
        ),
    );
    const q = this.input.value.trim();
    let list = all.filter((n) => this.filter === "all" || assetType(n.path) === this.filter);
    if (q) {
      list = list
        .map((n) => ({ n, s: Math.max(fuzzyScore(q, n.path.split("/").pop()!), fuzzyScore(q, n.path) - 30) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.n);
    } else {
      const by: Record<Sort, (a: NoteMeta, b: NoteMeta) => number> = {
        newest: (a, b) => b.mtime - a.mtime,
        oldest: (a, b) => a.mtime - b.mtime,
        name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
        size: (a, b) => b.size - a.size,
        type: (a, b) => TYPES.indexOf(assetType(a.path)) - TYPES.indexOf(assetType(b.path)) || extOf(a.path).localeCompare(extOf(b.path)) || nameOf(a).localeCompare(nameOf(b)),
      };
      list.sort(by[this.sort]);
    }
    this.shown = list;
    this.grid.replaceChildren(
      ...this.uploading.map((name) => el("div", { class: "as-card is-uploading" }, el("div", { class: "as-thumb" }, el("span", { class: "as-spinner" })), el("div", { class: "as-name" }, name), el("div", { class: "as-meta" }, "Uploading…"))),
      ...list.map((n) => this.card(n)),
      ...(!list.length && !this.uploading.length
        ? [
            el(
              "div",
              { class: "as-empty" },
              icon("upload", 26),
              el("b", {}, all.length ? "Nothing matches" : "No assets yet"),
              el("span", {}, all.length ? "Try another type or search." : "Drop images, PDFs, audio or video here, or paste an image into any note."),
            ),
          ]
        : []),
    );
    this.renderSuggest(q);
  }

  private card(n: NoteMeta): HTMLElement {
    const type = assetType(n.path);
    const folder = n.path.split("/").slice(0, -1).join("/");
    return el(
      "button",
      { type: "button", class: `as-card is-${type}`, title: n.path, onclick: () => this.preview(n.path) },
      el("div", { class: "as-thumb" }, thumb(n.path, type)),
      el("div", { class: "as-name" }, nameOf(n)),
      el("div", { class: "as-meta" }, el("span", { class: "as-ext" }, extOf(n.path)), fmtBytes(n.size), folder && folder !== "assets" ? el("span", { class: "as-folder" }, folder) : null),
    );
  }

  // ---------------------------------------------------------------- search suggestions

  private renderSuggest(q: string) {
    const top = q ? this.shown.slice(0, 6) : [];
    this.suggest.hidden = !top.length || document.activeElement !== this.input;
    this.input.setAttribute("aria-expanded", String(!this.suggest.hidden));
    this.active = Math.min(this.active, Math.max(0, top.length - 1));
    this.suggest.replaceChildren(
      ...top.map((n, i) =>
        el(
          "div",
          { class: `as-sug${i === this.active ? " is-active" : ""}`, role: "option", onmousedown: (e: Event) => (e.preventDefault(), this.preview(n.path)) },
          el("span", { class: "as-sug-thumb" }, assetType(n.path) === "image" ? el("img", { src: fileUrl(n.path), alt: "", loading: "lazy" }) : icon(ASSET_ICON[assetType(n.path)], 14)),
          el("span", { class: "as-sug-name" }, nameOf(n)),
          el("span", { class: "as-sug-meta" }, n.path.split("/").slice(0, -1).join("/") || extOf(n.path)),
        ),
      ),
    );
  }

  private closeSuggest() {
    this.suggest.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
  }

  private searchKey(e: KeyboardEvent) {
    const n = Math.min(6, this.shown.length);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!n) return;
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      this.renderSuggest(this.input.value.trim());
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = this.shown[this.active];
      if (hit) this.preview(hit.path);
    } else if (e.key === "Escape") {
      if (this.input.value) {
        e.preventDefault();
        this.input.value = "";
        this.render();
      } else this.input.blur();
    }
  }

  // ---------------------------------------------------------------- uploading

  private async upload(files: File[]) {
    this.uploading.push(...files.map((f) => f.name));
    this.render();
    const done = await this.hooks.upload(files);
    this.uploading = this.uploading.filter((n) => !files.some((f) => f.name === n));
    this.render();
    if (done.length) this.hooks.toast({ icon: "upload", text: done.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${done.length} files` });
  }

  // ---------------------------------------------------------------- preview

  preview(path: string) {
    const meta = this.all().find((n) => n.path === path) ?? this.hooks.notes().find((n) => n.path === path);
    if (!meta) return;
    this.closeSuggest();
    this.previewing = path;
    document.querySelector("#asset-preview")?.remove();
    const type = assetType(path);
    const src = fileUrl(path);
    const stage =
      type === "image"
        ? el("img", { src, alt: nameOf(meta) })
        : type === "video"
          ? el("video", { src, controls: true, autoplay: true })
          : type === "audio"
            ? el("div", { class: "ap-audio" }, icon("audio", 48), el("audio", { src, controls: true, autoplay: true }))
            : type === "pdf"
              ? el("iframe", { src, title: nameOf(meta) })
              : el("div", { class: "ap-file" }, el("span", { class: "ap-ext" }, extOf(path)), el("span", {}, "No preview for this kind of file"));
    const usedIn = el("div", { class: "ap-used" }, el("div", { class: "ap-label" }, "Used in"), el("div", { class: "ap-muted" }, "…"));
    const embed = `![[${this.hooks.embedName(path)}]]`;
    const close = () => {
      overlay.remove();
      this.previewing = null;
      document.removeEventListener("keydown", onKey, true);
    };
    const step = (d: number) => {
      const i = this.shown.findIndex((n) => n.path === path);
      const next = this.shown[(i + d + this.shown.length) % this.shown.length];
      if (next && next.path !== path) this.preview(next.path);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const box = el(
      "div",
      { class: `ap-box is-${type}`, role: "dialog", "aria-label": nameOf(meta) },
      el("div", { class: "ap-stage" }, stage),
      el(
        "aside",
        { class: "ap-info" },
        el("div", { class: "ap-top" }, el("h2", {}, nameOf(meta)), el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", onclick: close }, icon("close", 16))),
        el(
          "dl",
          { class: "ap-facts" },
          el("dt", {}, "Type"),
          el("dd", {}, type === "pdf" || type === "other" ? extOf(path) : `${ASSET_LABEL[type].replace(/s$/, "")} · ${extOf(path)}`),
          el("dt", {}, "Size"),
          el("dd", {}, fmtBytes(meta.size)),
          el("dt", {}, "Added"),
          el("dd", {}, new Date(meta.mtime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })),
          el("dt", {}, "Path"),
          el("dd", { class: "ap-path" }, path),
        ),
        el(
          "div",
          { class: "ap-actions" },
          el(
            "button",
            {
              type: "button",
              class: "qw-btn primary",
              title: embed,
              onclick: () => void navigator.clipboard.writeText(embed).then(() => this.hooks.toast({ icon: "copy", text: `Copied ${embed}` })),
            },
            icon("copy", 14),
            "Copy embed",
          ),
          el("a", { class: "qw-btn", href: src, target: "_blank", rel: "noopener" }, icon("open", 14), "Open"),
          el("a", { class: "qw-btn", href: src, download: nameOf(meta) }, icon("download", 14), "Download"),
          el(
            "button",
            { type: "button", class: "qw-btn", onclick: async () => (close(), await this.hooks.archive(path)) },
            icon("archive", 14),
            "Archive",
          ),
        ),
        usedIn,
        this.shown.length > 1 ? el("div", { class: "ap-nav" }, el("kbd", {}, "←"), el("kbd", {}, "→"), " to browse") : null,
      ),
    );
    const overlay = el("div", { id: "asset-preview", onmousedown: (e: MouseEvent) => e.target === overlay && close() }, box);
    document.body.append(overlay);
    document.addEventListener("keydown", onKey, true);

    void api
      .backlinks(path)
      .then((links) => {
        if (this.previewing !== path) return;
        const notes = [...new Map(links.map((l) => [l.path, l])).values()];
        usedIn.replaceChildren(
          el("div", { class: "ap-label" }, "Used in"),
          ...(notes.length
            ? notes.map((l) => el("button", { type: "button", class: "ap-link", onclick: () => (close(), this.hooks.open(l.path)) }, icon("file", 13), l.title))
            : [el("div", { class: "ap-muted" }, "Not embedded in any note yet.")]),
        );
      })
      .catch(() => usedIn.remove());
  }
}

const nameOf = (n: NoteMeta) => n.path.split("/").pop()!;

function thumb(path: string, type: AssetType): HTMLElement {
  if (type === "image") return el("img", { src: fileUrl(path), alt: "", loading: "lazy", decoding: "async" });
  if (type === "video") {
    return el("div", { class: "as-video" }, el("video", { src: `${fileUrl(path)}#t=0.5`, preload: "metadata", muted: true, playsinline: true }), el("span", { class: "as-play" }, icon("play", 16)));
  }
  return el("div", { class: "as-tile" }, icon(ASSET_ICON[type], 30), el("span", {}, extOf(path)));
}

