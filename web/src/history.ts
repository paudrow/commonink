// History: every change, newest first, and what any selection of them did. Click one to see it,
// ⌘-click to add or skip changes, shift-click to take a whole range. The diff on the right is
// note by note; a change left out on the same note splits that note into separate diffs.
// Named versions (labels.ts) stand among the changes as pins: click one to compare it with now or
// with another named version, and to restore to it.
import { api, fileUrl, type Change, type DiffFile, type DiffRun, type Label } from "./api.ts";
import { $, authorAvatar, authorName, displayName, el, icon, isSelf } from "./dom.ts";
import { renderDiff } from "./diff.ts";
import { diffLines } from "diff";
import { entryStat, loadStats, statEl, toRanges } from "./changeStats.ts";
import { assetIcon, assetType, extOf } from "./assetKinds.ts";
import { changeVerb, groupChanges, isRename } from "../../src/core/format.ts";
import { emptyState } from "./emptyState.ts";
import { formatKeys } from "./keys.ts";
import type { ToastSpec } from "./toast.ts";
import { deleteLabel, labeledBy, labelVersion, renameLabel } from "./labels.ts";

type Item = Change & { count: number; first: number };

interface Hooks {
  open(path: string): void;
  toast(t: ToastSpec): void;
  /** The person can read this workspace but not change it: no labeling or restoring. */
  readOnly?: boolean;
}

const PAGE = 200;

/** Whose changes History shows: everyone's (""), "people", "ai", or one agent's name. Kept per browser. */
const BY_KEY = "commonink.history.by";
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
  /** The labels shown: this note's, or every note's. */
  private labels: Label[] = [];
  /** A label picked in the list: the right side compares it instead of showing changes. */
  private label: Label | null = null;
  /** What the picked label is compared with: "now", or another label's ID. */
  private compareTo = "now";
  private items: Item[] = [];
  private note: string | null = null;
  private by = savedBy();
  /** Only changes after this change id ("While you were away" opens History on that span), or 0 for all. */
  private since = 0;
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
          el("div", { class: "hist-head" }, el("h1", {}, "History"), el("p", {}, `Click to see a change · ${formatKeys("Mod-click")} to add or skip · shift-click for a range`)),
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

  /**
   * Open the page, optionally for one note and with a change (by id) selected. `since` (a change id)
   * shows only agents' changes after it, all selected, so the right side shows everything they did.
   */
  async show(opts: { note?: string | null; select?: number; label?: string; since?: number } = {}) {
    this.root.hidden = false;
    const note = opts.note ?? null;
    if (opts.since) {
      [this.since, this.by, this.note, this.label] = [opts.since, "ai", null, null];
      await this.load();
      this.selected = new Set(this.items.map((it) => it.id));
      this.focus = this.anchor = 0;
      this.render();
      this.root.focus({ preventScroll: true });
      return;
    }
    if (note !== this.note || !this.raw.length || this.since) {
      this.since = 0;
      this.note = note;
      this.selected.clear();
      this.label = null;
      await this.load();
    } else {
      await this.refresh(); // pick up anything that happened while the page was closed
    }
    const picked = opts.label ? this.labels.find((m) => m.id === opts.label) : undefined;
    const at = opts.select ? this.visibleItems().findIndex((it) => it.first <= opts.select! && opts.select! <= it.id) : -1;
    if (picked) this.pickLabel(picked);
    else if (at >= 0) this.selectOnly(at);
    else if (!this.selected.size && this.visibleItems().length) this.selectOnly(0);
    else this.render();
    this.root.focus({ preventScroll: true });
    this.listEl.querySelector(".hist-row.is-focused")?.scrollIntoView({ block: "nearest" });
  }

  /** New changes arrived: reload the newest page, keeping the selection. */
  refreshSoon = debounce(() => this.visible && void this.refresh().then(() => this.renderList()), 400);

  private async refresh() {
    const [fresh, labels] = await Promise.all([api.history({ limit: PAGE, path: this.note ?? undefined, by: this.by || undefined, after: this.since || undefined }).catch(() => null), api.labels(this.note ?? undefined).catch(() => null)]);
    if (labels) this.setLabels(labels);
    if (!fresh) return;
    const older = this.raw.filter((c) => c.id < (fresh.at(-1)?.id ?? 0));
    this.raw = [...fresh, ...older];
    this.items = groupChanges(this.raw);
  }

  private async load(older = false) {
    const seq = ++this.seq;
    const before = older ? this.raw.at(-1)?.id : undefined;
    const [page, labels] = await Promise.all([
      api.history({ limit: PAGE, before, path: this.note ?? undefined, by: this.by || undefined, after: this.since || undefined }).catch(() => null),
      older ? null : api.labels(this.note ?? undefined).catch(() => null),
    ]);
    if (labels) this.setLabels(labels);
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

  /** Back from the "While you were away" span to the whole timeline. */
  private async clearSince() {
    this.since = 0;
    this.by = savedBy();
    this.selected.clear();
    await this.load();
    if (this.items.length) this.selectOnly(0);
    else this.render();
  }

  /** New labels from the server; a picked label that's gone (deleted elsewhere) is let go. */
  private setLabels(labels: Label[]) {
    this.labels = labels;
    if (this.label) this.label = labels.find((m) => m.id === this.label!.id) ?? null;
    if (this.compareTo !== "now" && !labels.some((m) => m.id === this.compareTo)) this.compareTo = "now";
  }

  // ---------------------------------------------------------------- selection

  /** Pick a label: the right side compares it (with now, to start with). */
  private pickLabel(m: Label) {
    this.label = m;
    this.compareTo = "now";
    this.selected.clear();
    this.render();
  }

  private selectOnly(i: number) {
    const it = this.visibleItems()[i];
    if (!it) return;
    this.label = null;
    this.selected = new Set([it.id]);
    this.anchor = this.focus = i;
    this.render();
  }

  private toggle(i: number) {
    const it = this.visibleItems()[i];
    if (!it) return;
    this.label = null;
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
      el("button", { type: "button", class: `chip${this.by === by ? " is-on" : ""}`, "aria-pressed": String(this.by === by), onclick: () => void this.setBy(by) }, ico ? icon(ico, 12) : null, label);
    const agentPick = el(
      "select",
      { class: `hist-agent${this.agentNames.includes(this.by) ? " is-on" : ""}`, title: "One agent's changes", "aria-label": "One agent's changes", onchange: (e: Event) => void this.setBy((e.target as HTMLSelectElement).value) },
      el("option", { value: "", disabled: true, selected: !this.agentNames.includes(this.by) }, "One agent…"),
      ...this.agentNames.map((a) => el("option", { value: a, selected: a === this.by }, a)),
    );
    const note = this.note;
    this.filtersEl.replaceChildren(
      ...(this.since
        ? [el("span", { class: "chip is-on hist-note-chip" }, icon("clock", 12), "While you were away", el("button", { type: "button", title: "Show every change", onclick: () => void this.clearSince() }, icon("close", 12)))]
        : []),
      ...(note
        ? [el("span", { class: "chip is-on hist-note-chip" }, icon("file", 12), displayName(note), el("button", { type: "button", title: "Show every note", onclick: () => void this.show({ note: null }) }, icon("close", 12)))]
        : []),
      ...(note && !this.hooks.readOnly
        ? [el("button", { type: "button", class: "chip hist-label-btn", title: "Name the note as it is now, to compare with or go back to later", onclick: () => void labelVersion(note, { toast: this.hooks.toast }).then((l) => l && this.afterLabel(l)) }, icon("label", 12), "Name this version…")]
        : []),
      el("span", { class: "hist-by", role: "group", "aria-label": "Whose changes" }, chip("", "Everyone"), chip("people", "Humans", "user"), chip("ai", "Agents", "bot")),
      ...(this.agentNames.length > 1 ? [agentPick] : []),
    );
    let day = "";
    const rows: HTMLElement[] = [];
    // Labels stand just above the change they label the version after (or by time, if the log has none).
    const pins = [...this.labels].sort((a, b) => (b.change_id ?? 0) - (a.change_id ?? 0) || b.ts - a.ts);
    let pin = 0;
    const pinsBefore = (it: Item | null) => {
      while (pin < pins.length) {
        const m = pins[pin];
        if (it && !(m.change_id !== null ? m.change_id >= it.first : m.ts >= it.ts)) break;
        rows.push(this.pinRow(m));
        pin++;
      }
    };
    items.forEach((it, i) => {
      const d = dayLabel(it.ts);
      if (d !== day) rows.push(el("div", { class: "hist-day" }, (day = d)));
      pinsBefore(it);
      const stat = entryStat(it, it.count > 1 ? toRanges(this.idsOf(it)) : "");
      const on = this.selected.has(it.id);
      const row = el(
        "div",
        { class: `hist-row${on ? " is-selected" : ""}${i === this.focus ? " is-focused" : ""}`, role: "option", "aria-selected": String(on) },
        el("span", { class: "hist-check" }, icon("check", 11)),
        authorAvatar(it, 22),
        el(
          "div",
          { class: "hist-body" },
          el("div", { class: "hist-line" }, el("b", {}, authorName(it)), ` ${changeVerb(it)} `, el("span", { class: "hist-note" }, displayName(it.path))),
          el(
            "div",
            { class: "hist-meta" },
            stat ? statEl(stat) : null,
            it.count > 1 ? el("span", {}, `${it.count} saves`) : null,
            el("span", {}, clock(it.ts)),
          ),
        ),
      );
      row.addEventListener("mousedown", (e) => e.shiftKey && e.preventDefault()); // no text selection on shift-click
      row.addEventListener("click", (e) => this.click(i, e));
      rows.push(row);
    });
    if (!this.more) pinsBefore(null); // labels older than every change shown (or with no changes to show)
    this.listEl.replaceChildren(...(rows.length ? rows : [this.empty()]));
    void loadStats(items.filter((it) => it.count > 1).map((it) => toRanges(this.idsOf(it)))).then((fresh) => fresh && this.renderList());
    this.moreEl.replaceChildren(
      ...(this.more ? [el("button", { type: "button", class: "link-btn", onclick: () => void this.load(true) }, "Load older changes")] : []),
    );
  }

  /** A label, as a pin among the changes. */
  private pinRow(m: Label): HTMLElement {
    const on = this.label?.id === m.id;
    return el(
      "button",
      { type: "button", class: `hist-label${on ? " is-selected" : ""}`, "aria-pressed": String(on), title: `Compare “${m.name}” with now, or restore to it`, onclick: () => this.pickLabel(m) },
      icon("label", 14),
      el(
        "span",
        { class: "hist-label-body" },
        el("span", { class: "hist-label-line" }, el("b", {}, m.name), m.current ? el("span", { class: "hist-label-now" }, "now") : null, this.note ? null : el("span", { class: "hist-note" }, m.path ? displayName(m.path) : "in Trash")),
        el("span", { class: "hist-meta" }, `Named ${labeledBy(m)}`),
        m.description ? el("span", { class: "hist-label-desc" }, m.description) : null,
      ),
    );
  }

  private empty(): HTMLElement {
    if (this.by) {
      return emptyState({ icon: "history", title: "No changes like that yet", text: ["History can show everyone's changes, or just humans', agents' or one agent's."], action: { label: "Show every change", run: () => void this.setBy("") } });
    }
    return emptyState({
      icon: "history",
      title: "No changes yet",
      text: ["Edit a note and its changes show up here, with who made them, a person or an agent. You can put any note back the way it was."],
    });
  }

  private renderSummary(files: DiffFile[] | null) {
    if (this.label) return this.renderLabelSummary(this.label);
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
        files?.some((f) => !isAsset(f.path)) ? statEl(totalsOf(files.flatMap((f) => f.runs))) : null,
      ),
      el("span", { class: "spacer" }),
      el("span", { class: "hist-who" }, ...who.slice(0, 5).map((it) => authorAvatar(it, 20))),
      ...(picked.length > 1 ? [el("button", { type: "button", class: "qw-btn", onclick: () => this.selectOnly(this.focus) }, "Clear")] : []),
    );
  }

  /** The picked label: its name, note and who labeled it, and what to do with it. */
  private renderLabelSummary(m: Label) {
    const others = this.labels.filter((x) => x.note_id === m.note_id && x.id !== m.id);
    const compare = el(
      "select",
      { class: "hist-compare", "aria-label": "Compare with", onchange: (e: Event) => ((this.compareTo = (e.target as HTMLSelectElement).value), void this.loadDiff()) },
      el("option", { value: "now", selected: this.compareTo === "now" }, "the note now"),
      ...others.map((x) => el("option", { value: x.id, selected: this.compareTo === x.id }, `“${x.name}”`)),
    );
    const canEdit = !this.hooks.readOnly && !!m.path;
    const restore = canEdit && !m.current ? el("button", { type: "button", class: "qw-btn primary", onclick: () => void this.restoreLabel(m) }, icon("reset", 13), "Restore to this version") : null;
    const parts = [
      el(
        "div",
        { class: "hist-sum-text hist-label-sum" },
        icon("label", 15),
        el("b", {}, m.name),
        m.path ? el("button", { type: "button", class: "link-btn", title: "Open this note", onclick: () => this.hooks.open(m.path!) }, displayName(m.path)) : el("span", {}, "in Trash"),
        el("span", {}, `Named ${labeledBy(m)}`),
      ),
      el("span", { class: "spacer" }),
      el("label", { class: "hist-compare-label" }, "Compare with ", compare),
      restore,
      canEdit ? el("button", { type: "button", class: "icon-btn small", title: "Rename", "aria-label": "Rename this version", onclick: () => void this.renameLabel(m) }, icon("edit", 14)) : null,
      canEdit ? el("button", { type: "button", class: "icon-btn small", title: "Remove this name", "aria-label": "Remove this name", onclick: () => void this.deleteLabel(m) }, icon("trash", 14)) : null,
    ].filter((n): n is HTMLElement => !!n);
    this.summaryEl.replaceChildren(...parts);
  }

  /** The picked label beside the note now or another label, as the usual diff: the older version first, so it reads forward in time. */
  private async loadLabelDiff(m: Label) {
    const seq = ++this.diffSeq;
    this.filesEl.classList.add("is-loading");
    const other = this.labels.find((x) => x.id === this.compareTo);
    const older = other && ((other.change_id ?? 0) - (m.change_id ?? 0) || other.ts - m.ts) < 0;
    const c = await (older ? api.compareLabels(other.id, m.id) : api.compareLabels(m.id, this.compareTo)).catch(() => null);
    if (seq !== this.diffSeq) return;
    this.filesEl.classList.remove("is-loading");
    if (!c) return this.filesEl.replaceChildren(el("div", { class: "hist-hint" }, "Couldn't load this version."));
    const to = "now" in c.to ? "now" : `“${c.to.name}”`;
    this.filesEl.replaceChildren(
      el(
        "section",
        { class: "hist-file" },
        el("header", { class: "hist-file-head" }, icon("file", 14), el("span", { class: "hist-file-name" }, c.path), statEl(lineTotals(c.from.text, c.to.text)), el("span", { class: "spacer" }), el("span", { class: "hist-compare-what" }, `“${c.from.name}” → ${to}`)),
        m.description ? el("p", { class: "hist-label-note" }, m.description) : null,
        c.from.text === c.to.text ? el("div", { class: "cv-note" }, `No differences: the note ${to === "now" ? "is at this version now" : `is the same at “${c.from.name}” and ${to}`}.`) : renderDiff(c.from.text, c.to.text),
      ),
    );
  }

  private async restoreLabel(m: Label) {
    const r = await api.restoreLabel(m.id).catch(() => null);
    if (!r) return this.hooks.toast({ text: `Couldn't restore “${m.name}”` });
    const change = r.change;
    const said = { icon: "reset", text: `Restored ${displayName(r.path)} to “${m.name}”` };
    this.hooks.toast(change ? { ...said, actionLabel: "Undo", action: () => void api.restore(change).then(() => this.refresh().then(() => this.render())) } : said);
    await this.refresh();
    this.render();
  }

  private async renameLabel(m: Label) {
    const next = await renameLabel(m, this.hooks.toast);
    if (!next) return;
    this.labels = this.labels.map((x) => (x.id === next.id ? next : x));
    this.label = next;
    this.render();
  }

  private async deleteLabel(m: Label) {
    if (!(await deleteLabel(m, this.hooks.toast))) return;
    this.labels = this.labels.filter((x) => x.id !== m.id);
    this.label = null;
    if (this.visibleItems().length) this.selectOnly(0);
    else this.render();
  }

  private async loadDiff() {
    if (this.label) return this.loadLabelDiff(this.label);
    const picked = this.visibleItems().filter((it) => this.selected.has(it.id));
    if (!picked.length) {
      this.filesEl.replaceChildren(el("div", { class: "hist-hint" }, `Select changes on the left to see what they did. Shift-click selects a range; ${formatKeys("Mod-click")} adds or skips one.`));
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
        `${m.op === "move" ? (isRename(m.from, m.to) ? "Renamed" : "Moved") : m.op === "archive" ? "Archived" : "Unarchived"} `,
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
        c ? statEl(c) : null,
        el("span", { class: "spacer" }),
        el("button", { type: "button", class: "icon-btn small", title: "Open this note", onclick: () => this.hooks.open(f.path) }, icon("open", 14)),
      ),
      ...moves,
      ...f.runs.map((r) => this.run(f, r)),
    );
  }

  private run(f: DiffFile, r: DiffRun): HTMLElement {
    const split = f.runs.length > 1;
    const restore = r.op !== "create" && r.before !== null && !this.hooks.readOnly
      ? el("button", { type: "button", class: "hist-restore", title: "Put the note back the way it was before these changes (later changes to it are undone too)" }, icon("reset", 13), "Restore to before")
      : null;
    // Name the version these changes left the note at ("that one was the good one").
    const label = r.after !== null && r.op !== "delete" && !isAsset(f.path) && !this.hooks.readOnly
      ? el("button", { type: "button", class: "hist-restore", title: "Give the version right after these changes a name, to come back to", onclick: () => void labelVersion(f.path, { toast: this.hooks.toast }, r.to).then((l) => l && this.afterLabel(l)) }, icon("label", 13), "Name this version…")
      : null;
    restore?.addEventListener("click", async () => {
      const res = await api.restore(r.from).catch(() => null);
      if (!res) return this.hooks.toast({ text: "Couldn't restore that version" });
      const said = { icon: "reset", text: `Restored ${displayName(res.path)}` };
      const change = res.change;
      // Undo only while the note is as the restore left it: an edit made since stays.
      const undo = () => api.restore(change!, res.version).catch(() => this.hooks.toast({ text: `${displayName(res.path)} changed since, so the restore stays` }));
      this.hooks.toast(change ? { ...said, actionLabel: "Undo", action: () => void undo() } : said);
    });
    return el(
      "div",
      { class: "hist-run" },
      split || r.skipped || restore || label
        ? el(
            "div",
            { class: "hist-run-head" },
            r.skipped ? el("span", { class: "hist-skip", title: "Changes to this note you left out of the selection" }, `${r.skipped} save${r.skipped > 1 ? "s" : ""} skipped`) : null,
            split ? el("span", {}, `${r.count} save${r.count > 1 ? "s" : ""} · ${clock(r.tsFrom)}${r.tsTo !== r.tsFrom ? `–${clock(r.tsTo)}` : ""}`) : null,
            el("span", { class: "spacer" }),
            label,
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

  /** A version was just labeled (from a change's run, or elsewhere): show its pin, picked. */
  async afterLabel(m: Label) {
    const labels = await api.labels(this.note ?? undefined).catch(() => null);
    if (labels) this.setLabels(labels);
    this.pickLabel(this.labels.find((x) => x.id === m.id) ?? m);
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

const totalsOf = (runs: DiffRun[]) => runs.reduce((t, r) => ({ add: t.add + (r.stat?.add ?? 0), del: t.del + (r.stat?.del ?? 0) }), { add: 0, del: 0 });

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

/** Lines added and removed between two texts, for a label's comparison. */
function lineTotals(before: string, after: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const p of diffLines(before, after)) {
    if (p.added) add += p.count ?? 0;
    else if (p.removed) del += p.count ?? 0;
  }
  return { add, del };
}
