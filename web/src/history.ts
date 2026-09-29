// History: every change, newest first, and what any selection of them did. Click one to see it,
// ⌘-click to add or skip changes, shift-click to take a whole range. The diff on the right is
// note by note; a change left out on the same note splits that note into separate diffs.
import { api, fileUrl, type Change, type DiffFile, type DiffRun } from "./api.ts";
import { $, authorAvatar, authorName, displayName, el, icon, isSelf } from "./dom.ts";
import { diffCounts, renderDiff } from "./diff.ts";
import { assetIcon, assetType, extOf } from "./assetKinds.ts";
import { groupChanges } from "../../src/core/format.ts";

type Item = Change & { count: number; first: number };

interface Hooks {
  open(path: string): void;
  verb(c: Change): string;
  toast(t: { text: string; icon?: string; actionLabel?: string; action?: () => void }): void;
}

const PAGE = 200;

/** Whose changes History shows: everyone's (""), "people", "ai", or one agent's name. Kept per browser. */
const BY_KEY = "quire.history.by";
function savedBy(): string {
  try {
    return localStorage.getItem(BY_KEY) ?? "";
  } catch {
    return "";
  }
}

export class History {
  readonly root = $("#history-view");
  private listEl: HTMLElement;
  private filtersEl: HTMLElement;
  private moreEl: HTMLElement;
  private summaryEl: HTMLElement;
  private filesEl: HTMLElement;
  private raw: Change[] = [];
  private items: Item[] = [];
  private note: string | null = null;
  private by = savedBy();
  /** The agents in the change log, for the per-agent filter. */
  private agentNames: string[] = [];
  /** Selected items, by their latest change id. */
  private selected = new Set<number>();
  private anchor = 0;
  private focus = 0;
  private more = false;
  private seq = 0;
  private diffSeq = 0;
  private diffTimer = 0;

  constructor(private hooks: Hooks) {
    this.filtersEl = el("div", { class: "hist-filters" });
    this.listEl = el("div", { class: "hist-list", role: "listbox", "aria-multiselectable": "true" });
    this.moreEl = el("div", { class: "hist-more" });
    this.summaryEl = el("header", { class: "hist-summary" });
    this.filesEl = el("div", { class: "hist-files" });
    this.root.append(
      el(
        "div",
        { class: "history" },
        el(
          "aside",
          { class: "hist-side" },
          el("div", { class: "hist-head" }, el("h1", {}, "History"), el("p", {}, "Click to see a change · ⌘-click to add or skip · shift-click for a range")),
          this.filtersEl,
          this.listEl,
          this.moreEl,
        ),
        el("section", { class: "hist-main" }, this.summaryEl, this.filesEl),
      ),
    );
    this.root.addEventListener("keydown", (e) => this.key(e));
  }

  get visible() {
    return !this.root.hidden;
  }
  get noteFilter() {
    return this.note;
  }

  /** Open the page, optionally for one note and with a change (by id) selected. */
  async show(opts: { note?: string | null; select?: number } = {}) {
    this.root.hidden = false;
    const note = opts.note ?? null;
    if (note !== this.note || !this.raw.length) {
      this.note = note;
      this.selected.clear();
      await this.load();
    } else {
      await this.refresh(); // pick up anything that happened while the page was closed
    }
    const at = opts.select ? this.visibleItems().findIndex((it) => it.first <= opts.select! && opts.select! <= it.id) : -1;
    if (at >= 0) this.selectOnly(at);
    else if (!this.selected.size && this.visibleItems().length) this.selectOnly(0);
    else this.render();
    this.root.focus({ preventScroll: true });
    this.listEl.querySelector(".hist-row.is-focused")?.scrollIntoView({ block: "nearest" });
  }

  /** New changes arrived: reload the newest page, keeping the selection. */
  refreshSoon = debounce(() => this.visible && void this.refresh().then(() => this.renderList()), 400);

  private async refresh() {
    const fresh = await api.history({ limit: PAGE, path: this.note ?? undefined, by: this.by || undefined }).catch(() => null);
    if (!fresh) return;
    const older = this.raw.filter((c) => c.id < (fresh.at(-1)?.id ?? 0));
    this.raw = [...fresh, ...older];
    this.items = groupChanges(this.raw);
  }

  private async load(older = false) {
    const seq = ++this.seq;
    const before = older ? this.raw.at(-1)?.id : undefined;
    const page = await api.history({ limit: PAGE, before, path: this.note ?? undefined, by: this.by || undefined }).catch(() => null);
    if (!older) void api.changeAgents().then((a) => ((this.agentNames = a), this.renderList()), () => {});
    if (!page || seq !== this.seq) return;
    this.raw = older ? [...this.raw, ...page] : page;
    this.more = page.length === PAGE;
    this.items = groupChanges(this.raw);
    if (older) this.renderList();
  }

  /**
   * The change ids behind a row. On the full timeline that's every id from first to last; with a
   * note filter, the row can span other notes' changes, so only this note's ids count.
   */
  private idsOf(it: Item): number[] {
    return this.raw.filter((c) => c.id >= it.first && c.id <= it.id).map((c) => c.id);
  }

  private visibleItems(): Item[] {
    return this.items;
  }

  /** Show only people's changes, any agent's, or one agent's (filtered by the server, so long histories stay quick). */
  private async setBy(by: string) {
    this.by = by;
    try {
      localStorage.setItem(BY_KEY, by);
    } catch {}
    this.selected.clear();
    await this.load();
    if (this.items.length) this.selectOnly(0);
    else this.render();
  }

  // ---------------------------------------------------------------- selection

  private selectOnly(i: number) {
    const it = this.visibleItems()[i];
    if (!it) return;
    this.selected = new Set([it.id]);
    this.anchor = this.focus = i;
    this.render();
  }

  private toggle(i: number) {
    const it = this.visibleItems()[i];
    if (!it) return;
    if (this.selected.has(it.id)) this.selected.delete(it.id);
    else this.selected.add(it.id);
    this.anchor = this.focus = i;
    this.render();
  }

  private extendTo(i: number) {
    const items = this.visibleItems();
    const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
    for (let k = a; k <= b; k++) if (items[k]) this.selected.add(items[k].id);
    this.focus = i;
    this.render();
  }

  private click(i: number, e: MouseEvent) {
    if (e.shiftKey) this.extendTo(i);
    else if (e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest(".hist-check")) this.toggle(i);
    else this.selectOnly(i);
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    this.renderList();
    this.renderSummary(null);
    clearTimeout(this.diffTimer);
    this.diffTimer = window.setTimeout(() => void this.loadDiff(), 90);
  }

  private renderList() {
    const items = this.visibleItems();
    const chip = (by: string, label: string, ico?: string) =>
      el("button", { type: "button", class: `chip${this.by === by ? " is-on" : ""}`, onclick: () => void this.setBy(by) }, ico ? icon(ico, 12) : null, label);
    const agentPick = el(
      "select",
      { class: `hist-agent${this.agentNames.includes(this.by) ? " is-on" : ""}`, title: "One agent's changes", "aria-label": "One agent's changes", onchange: (e: Event) => void this.setBy((e.target as HTMLSelectElement).value) },
      el("option", { value: "", disabled: true, selected: !this.agentNames.includes(this.by) }, "One agent…"),
      ...this.agentNames.map((a) => el("option", { value: a, selected: a === this.by }, a)),
    );
    this.filtersEl.replaceChildren(
      ...(this.note
        ? [el("span", { class: "chip is-on hist-note-chip" }, icon("file", 12), displayName(this.note), el("button", { type: "button", title: "Show every note", onclick: () => void this.show({ note: null }) }, icon("close", 12)))]
        : []),
      el("span", { class: "hist-by", role: "group", "aria-label": "Whose changes" }, chip("", "Everyone"), chip("people", "People", "user"), chip("ai", "AI", "bot")),
      ...(this.agentNames.length > 1 ? [agentPick] : []),
    );
    let day = "";
    const rows: HTMLElement[] = [];
    items.forEach((it, i) => {
      const d = dayLabel(it.ts);
      if (d !== day) rows.push(el("div", { class: "hist-day" }, (day = d)));
      const [add, del] = (it.summary ?? "").match(/^\+(\d+) −(\d+)$/)?.slice(1) ?? [];
      const on = this.selected.has(it.id);
      const row = el(
        "div",
        { class: `hist-row${on ? " is-selected" : ""}${i === this.focus ? " is-focused" : ""}`, role: "option", "aria-selected": String(on) },
        el("span", { class: "hist-check" }, icon("check", 11)),
        authorAvatar(it, 22),
        el(
          "div",
          { class: "hist-body" },
          el("div", { class: "hist-line" }, el("b", {}, authorName(it)), ` ${this.hooks.verb(it)} `, el("span", { class: "hist-note" }, displayName(it.path))),
          el(
            "div",
            { class: "hist-meta" },
            add !== undefined ? el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${add}`), el("span", { class: "del" }, `−${del}`)) : null,
            it.count > 1 ? el("span", {}, `${it.count} saves`) : null,
            el("span", {}, clock(it.ts)),
          ),
        ),
      );
      row.addEventListener("mousedown", (e) => e.shiftKey && e.preventDefault()); // no text selection on shift-click
      row.addEventListener("click", (e) => this.click(i, e));
      rows.push(row);
    });
    this.listEl.replaceChildren(...(rows.length ? rows : [el("div", { class: "hist-empty" }, this.by ? "No changes like that yet." : "No changes yet.")]));
    this.moreEl.replaceChildren(
      ...(this.more ? [el("button", { type: "button", class: "link-btn", onclick: () => void this.load(true) }, "Load older changes")] : []),
    );
  }

  private renderSummary(files: DiffFile[] | null) {
    const picked = this.visibleItems().filter((it) => this.selected.has(it.id));
    const saves = picked.reduce((n, it) => n + it.count, 0);
    const who = [...new Map(picked.map((it) => [it.source, it])).values()];
    this.summaryEl.replaceChildren(
      el(
        "div",
        { class: "hist-sum-text" },
        picked.length
          ? el("b", {}, `${picked.length} change${picked.length > 1 ? "s" : ""}`)
          : el("b", {}, "Nothing selected"),
        picked.length && saves > picked.length ? el("span", {}, `${saves} saves`) : null,
        files ? el("span", {}, `${files.length} note${files.length === 1 ? "" : "s"}`) : null,
        files?.some((f) => !isAsset(f.path)) ? totals(files) : null,
      ),
      el("span", { class: "spacer" }),
      el("span", { class: "hist-who" }, ...who.slice(0, 5).map((it) => authorAvatar(it, 20))),
      ...(picked.length > 1 ? [el("button", { type: "button", class: "qw-btn", onclick: () => this.selectOnly(this.focus) }, "Clear")] : []),
    );
  }

  private async loadDiff() {
    const picked = this.visibleItems().filter((it) => this.selected.has(it.id));
    if (!picked.length) {
      this.filesEl.replaceChildren(el("div", { class: "hist-hint" }, "Select changes on the left to see what they did. Shift-click selects a range; ⌘-click adds or skips one."));
      return;
    }
    const seq = ++this.diffSeq;
    this.filesEl.classList.add("is-loading");
    const files = await api.diffs(toRanges(picked.flatMap((it) => this.idsOf(it)))).catch(() => null);
    if (seq !== this.diffSeq) return;
    this.filesEl.classList.remove("is-loading");
    if (!files) {
      this.filesEl.replaceChildren(el("div", { class: "hist-hint" }, "Couldn't load these changes."));
      return;
    }
    this.renderSummary(files);
    this.filesEl.replaceChildren(...files.map((f) => this.file(f)));
  }

  private file(f: DiffFile): HTMLElement {
    const c = isAsset(f.path) ? null : totalsOf(f.runs);
    const moves = f.moves.map((m) =>
      el(
        "div",
        { class: "hist-move" },
        icon(m.op === "archive" ? "archive" : m.op === "unarchive" ? "unarchive" : "move", 13),
        `${m.op === "move" ? "Moved" : m.op === "archive" ? "Archived" : "Unarchived"} `,
        el("code", {}, m.from ?? "?"),
        " → ",
        el("code", {}, m.to),
        el("span", { class: "hist-move-who" }, `${isSelf(m.source) ? "you" : m.source} · ${clock(m.ts)}`),
      ),
    );
    return el(
      "section",
      { class: "hist-file" },
      el(
        "header",
        { class: "hist-file-head" },
        icon("file", 14),
        el("button", { type: "button", class: "hist-file-name", title: "Open this note", onclick: () => this.hooks.open(f.path) }, f.path),
        c ? el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${c.add}`), el("span", { class: "del" }, `−${c.del}`)) : null,
        el("span", { class: "spacer" }),
        el("button", { type: "button", class: "icon-btn small", title: "Open this note", onclick: () => this.hooks.open(f.path) }, icon("open", 14)),
      ),
      ...moves,
      ...f.runs.map((r) => this.run(f, r)),
    );
  }

  private run(f: DiffFile, r: DiffRun): HTMLElement {
    const split = f.runs.length > 1;
    const restore = r.op !== "create" && r.before !== null
      ? el("button", { type: "button", class: "hist-restore", title: "Put the note back the way it was before these changes (later changes to it are undone too)" }, icon("reset", 13), "Restore to before")
      : null;
    restore?.addEventListener("click", async () => {
      const res = await api.restore(r.from).catch(() => null);
      if (!res) return this.hooks.toast({ text: "Couldn't restore that version" });
      this.hooks.toast({
        icon: "reset",
        text: `Restored ${displayName(res.path)}`,
        actionLabel: res.change ? "Undo" : undefined,
        action: res.change ? () => void api.restore(res.change!) : undefined,
      });
    });
    return el(
      "div",
      { class: "hist-run" },
      split || r.skipped || restore
        ? el(
            "div",
            { class: "hist-run-head" },
            r.skipped ? el("span", { class: "hist-skip", title: "Changes to this note you left out of the selection" }, `${r.skipped} save${r.skipped > 1 ? "s" : ""} skipped`) : null,
            split ? el("span", {}, `${r.count} save${r.count > 1 ? "s" : ""} · ${clock(r.tsFrom)}${r.tsTo !== r.tsFrom ? `–${clock(r.tsTo)}` : ""}`) : null,
            el("span", { class: "spacer" }),
            restore,
          )
        : null,
      isAsset(f.path)
        ? assetRun(f.path, r)
        : r.before === null || r.after === null
        ? el("div", { class: "cv-note" }, "The text of these changes isn't available any more.")
        : r.before === r.after
          ? el("div", { class: "cv-note" }, "No text changed overall.")
          : renderDiff(r.before, r.after),
    );
  }

  // ---------------------------------------------------------------- keyboard

  private key(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea")) return;
    const n = this.visibleItems().length;
    const move = (d: number) => {
      const i = Math.max(0, Math.min(n - 1, this.focus + d));
      if (e.shiftKey) this.extendTo(i);
      else this.selectOnly(i);
      this.listEl.querySelector(".hist-row.is-focused")?.scrollIntoView({ block: "nearest" });
    };
    const act: Record<string, () => void> = {
      j: () => move(1),
      J: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      K: () => move(-1),
      ArrowUp: () => move(-1),
      x: () => this.toggle(this.focus),
      " ": () => this.toggle(this.focus),
      a: () => {
        this.visibleItems().forEach((it) => this.selected.add(it.id));
        this.render();
      },
      Escape: () => this.selectOnly(this.focus),
      Enter: () => {
        const it = this.visibleItems()[this.focus];
        if (it) this.hooks.open(it.path);
      },
    };
    const fn = act[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }
}

const isAsset = (p: string) => !/\.(md|markdown|html?)$/i.test(p);

/** Files have no text diff: show the file itself and what happened to it. */
function assetRun(path: string, r: DiffRun): HTMLElement {
  const type = assetType(path);
  return el(
    "div",
    { class: "hist-asset" },
    el("span", { class: "hist-asset-thumb" }, type === "image" ? el("img", { src: fileUrl(path), alt: "", loading: "lazy" }) : icon(assetIcon(path), 20)),
    el("div", {}, el("b", {}, `${r.op === "create" ? "Uploaded" : "Replaced"} ${extOf(path)}`), r.summary ? el("span", {}, r.summary) : null),
  );
}

/** Change ids as compact ranges for the URL: [12, 13, 14, 20] → "12-14,20". */
function toRanges(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return out.join(",");
}

function totalsOf(runs: DiffRun[]) {
  let add = 0;
  let del = 0;
  for (const r of runs) {
    if (r.before === null || r.after === null) continue;
    const c = diffCounts(r.before, r.after);
    add += c.add;
    del += c.del;
  }
  return { add, del };
}

function totals(files: DiffFile[]) {
  const t = files.reduce((acc, f) => {
    const c = totalsOf(f.runs);
    return { add: acc.add + c.add, del: acc.del + c.del };
  }, { add: 0, del: 0 });
  return el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${t.add}`), el("span", { class: "del" }, `−${t.del}`));
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function debounce(fn: () => unknown, ms: number) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}
