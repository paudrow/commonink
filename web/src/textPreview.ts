// Text assets (CSV, JSON, plain text) in the Assets page: the first lines as a grid thumbnail,
// and a preview that reads the file the way it's meant to be read (a table, formatted JSON) or
// as the raw text, whichever you pick.
import { assetUrl, fileUrl } from "./api.ts";
import { el, icon } from "./dom.ts";
import { assetIcon, fmtBytes, textFormat, type TextFormat } from "./assetKinds.ts";
import { compareCells, csvTable, rowFilter } from "./csv.ts";

const MAX_PREVIEW = 5 * 1024 * 1024; // bigger than this: offer the download instead
const MAX_EMBED = 2 * 1024 * 1024; // …and in a note, send people to the Assets page
const MAX_THUMB = 256 * 1024;
const MAX_ROWS = 1000;
const MAX_LINES = 5000;

type Mode = "table" | "formatted" | "raw";
const MODES: Record<TextFormat, Mode[]> = { csv: ["table", "raw"], json: ["formatted", "raw"], plain: ["raw"] };
const LABEL: Record<Mode, string> = { table: "Table", formatted: "Formatted", raw: "Raw" };

const modeKey = (f: TextFormat) => `quire.textMode.${f}`;
function savedMode(f: TextFormat): Mode {
  try {
    const m = localStorage.getItem(modeKey(f)) as Mode | null;
    if (m && MODES[f].includes(m)) return m;
  } catch {}
  return MODES[f][0];
}

/** The preview pane for a text asset. Fills itself in once the file has loaded. */
export function textStage(path: string, size: number): HTMLElement {
  const format = textFormat(path);
  const bar = el("div", { class: "ap-text-bar" });
  const body = el("div", { class: "ap-text-body" }, el("div", { class: "ap-text-note" }, "Loading…"));
  const box = el("div", { class: "ap-text" }, bar, body);
  if (size > MAX_PREVIEW) {
    body.replaceChildren(el("div", { class: "ap-text-note" }, `This file is ${fmtBytes(size)}, too big to preview here. Download it to open it.`));
    return box;
  }
  void fetch(fileUrl(path))
    .then((r) => (r.ok ? r.text() : Promise.reject()))
    .then((text) => {
      let mode = savedMode(format);
      const copy = el("button", { type: "button", class: "ap-text-copy", title: "Copy the whole file" }, icon("copy", 13), "Copy text");
      copy.addEventListener("click", () => void navigator.clipboard.writeText(text).then(() => (copy.lastChild!.textContent = "Copied")));
      const render = () => {
        const seg = el("div", { class: "seg" }, ...modeButtons(format, mode, (m) => ((mode = m), remember(format, m), render())));
        const view = renderText(text, mode);
        bar.replaceChildren(...(MODES[format].length > 1 ? [seg] : []), el("span", { class: "ap-text-meta" }, view.meta), el("span", { class: "spacer" }), copy);
        body.replaceChildren(view.node);
        body.scrollTop = 0;
      };
      render();
    })
    .catch(() => body.replaceChildren(el("div", { class: "ap-text-note" }, "Couldn't load this file.")));
  return box;
}

function renderText(text: string, mode: Mode): { node: HTMLElement; meta: string } {
  return mode === "table" ? tableView(text) : mode === "formatted" ? jsonView(text) : rawView(text);
}

function modeButtons(format: TextFormat, mode: Mode, pick: (m: Mode) => void): HTMLElement[] {
  if (MODES[format].length < 2) return [];
  return MODES[format].map((m) =>
    el("button", { type: "button", class: m === mode ? "is-on" : "", onmousedown: (e: Event) => (e.preventDefault(), pick(m)) }, LABEL[m]),
  );
}

/**
 * `![[data.csv]]` in a note: a card with the file's name and size, the Table | Raw (or
 * Formatted | Raw) toggle, and the contents, scrolling inside the card if they're long.
 */
export function dataEmbed(target: string, from: string | undefined, opts: { actions?: HTMLElement[]; settle?: () => void } = {}): HTMLElement {
  const name = target.split("#")[0];
  const format = textFormat(name);
  const settle = opts.settle ?? (() => {});
  const meta = el("span", { class: "embed-meta" });
  const seg = el("div", { class: "seg embed-seg" });
  const body = el("div", { class: "embed-body embed-data is-loading" }, el("div", { class: "skeleton" }), el("div", { class: "skeleton short" }));
  const wrap = el(
    "div",
    { class: "cm-embed is-data" },
    el("div", { class: "embed-head" }, icon(assetIcon(name), 14), el("span", { class: "embed-title" }, name.split("/").pop()!), meta, el("span", { class: "spacer" }), seg, ...(opts.actions ?? [])),
    body,
  );
  // Filtering, sorting and the view toggle change the card's height; the editor has to know.
  let shown = false;
  const ro = new ResizeObserver(() => {
    if (wrap.isConnected) (shown = true), settle();
    else if (shown) ro.disconnect();
  });
  ro.observe(wrap);
  const note = (text: string) => {
    body.classList.remove("is-loading");
    body.replaceChildren(el("div", { class: "embed-missing" }, icon(assetIcon(name), 15), text));
    settle();
  };
  void fetch(assetUrl(name, from))
    .then(async (r) => {
      if (!r.ok) return note(`Can't find ${name}`);
      if (Number(r.headers.get("Content-Length") ?? 0) > MAX_EMBED) return note(`${name} is too big to show in a note. Open it from Assets.`);
      const text = await r.text();
      let mode = savedMode(format);
      const render = () => {
        const v = renderText(text, mode);
        body.classList.remove("is-loading");
        body.replaceChildren(v.node);
        meta.textContent = v.meta;
        seg.replaceChildren(...modeButtons(format, mode, (m) => ((mode = m), remember(format, m), render())));
        settle();
      };
      render();
    })
    .catch(() => note(`Couldn't load ${name}`));
  return wrap;
}

/**
 * Rendered markdown shows `![[data.csv]]` as a "↳ data.csv" link; swap those for data cards
 * (in expanded note cards and in notes embedded in notes).
 */
export function hydrateDataEmbeds(root: HTMLElement, from: string, settle?: () => void) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="quire:"]')) {
    if (!a.textContent?.startsWith("↳ ")) continue; // an embed, not an ordinary link
    const target = decodeURIComponent(a.getAttribute("href")!.slice(6));
    if (!/\.(csv|json|txt)$/i.test(target.split("#")[0])) continue;
    const card = dataEmbed(target, from, { settle });
    const p = a.parentElement;
    if (p?.tagName === "P" && p.childNodes.length === 1) p.replaceWith(card);
    else a.replaceWith(card);
  }
}

function remember(f: TextFormat, m: Mode) {
  try {
    localStorage.setItem(modeKey(f), m);
  } catch {}
}

/** The text as it is: line numbers down the side, long files cut short. */
function rawView(text: string): { node: HTMLElement; meta: string } {
  const lines = text.replace(/\n$/, "").split("\n");
  const shown = lines.slice(0, MAX_LINES);
  const node = el(
    "div",
    { class: "ap-raw" },
    el("pre", { class: "ap-raw-gutter", "aria-hidden": "true" }, shown.map((_, i) => i + 1).join("\n")),
    el("pre", { class: "ap-raw-text" }, shown.join("\n")),
  );
  const cut = lines.length > MAX_LINES ? el("div", { class: "ap-text-note" }, `Showing the first ${MAX_LINES.toLocaleString()} of ${lines.length.toLocaleString()} lines.`) : null;
  return { node: cut ? el("div", {}, node, cut) : node, meta: `${lines.length.toLocaleString()} line${lines.length === 1 ? "" : "s"}` };
}

function jsonView(text: string): { node: HTMLElement; meta: string } {
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    const raw = rawView(pretty);
    return { node: raw.node, meta: raw.meta };
  } catch {
    const raw = rawView(text);
    return { node: el("div", {}, el("div", { class: "ap-text-note is-warn" }, "This isn't valid JSON, so it's shown as it is."), raw.node), meta: raw.meta };
  }
}

/**
 * A CSV as a table you can sort and filter: first row as the header, the original row numbers down
 * the side, the first MAX_ROWS matching rows. Click a header to sort (up, down, back to file order).
 */
function tableView(text: string): { node: HTMLElement; meta: string } {
  const table = csvTable(text);
  if (!table) return { node: el("div", { class: "ap-text-note" }, "This file is empty."), meta: "" };
  const { headers, data, numeric } = table;
  const cols = headers.length;
  let sort: { col: number; dir: 1 | -1 } | null = null;

  const input = el("input", { class: "dt-filter", placeholder: "Filter rows…   city:London   signups:>100", spellcheck: "false", autocomplete: "off", "aria-label": "Filter rows" });
  const count = el("span", { class: "dt-count" });
  const thead = el("thead");
  const tbody = el("tbody");
  const cut = el("div", { class: "ap-text-note", hidden: true });
  const cell = (v: string | undefined, c: number) => el("td", { class: numeric[c] ? "is-num" : undefined, title: v && v.length > 40 ? v : undefined }, v ?? "");

  const draw = () => {
    const keep = rowFilter(input.value, headers, numeric);
    const shown = data.map((r, i) => ({ r, i })).filter(({ r }) => keep(r));
    if (sort) {
      const { col, dir } = sort;
      shown.sort((a, b) => compareCells(a.r[col], b.r[col], numeric[col], dir) || a.i - b.i);
    }
    thead.replaceChildren(
      el(
        "tr",
        {},
        el("th", { class: "ap-rownum" }, ""),
        ...headers.map((h, c) => {
          const on = sort?.col === c;
          return el(
            "th",
            {
              class: `dt-sort${on ? " is-sorted" : ""}${numeric[c] ? " is-num" : ""}`,
              title: on ? (sort!.dir === 1 ? "Sorted ascending: click for descending" : "Sorted descending: click for file order") : `Sort by ${h}`,
              "aria-sort": on ? (sort!.dir === 1 ? "ascending" : "descending") : "none",
              onmousedown: (e: Event) => e.preventDefault(),
              onclick: () => {
                sort = !on ? { col: c, dir: 1 } : sort!.dir === 1 ? { col: c, dir: -1 } : null;
                draw();
              },
            },
            h,
            el("span", { class: "dt-arrow" }, on ? (sort!.dir === 1 ? "↑" : "↓") : "↕"),
          );
        }),
      ),
    );
    tbody.replaceChildren(
      ...(shown.length
        ? shown.slice(0, MAX_ROWS).map(({ r, i }) => el("tr", {}, el("td", { class: "ap-rownum" }, String(i + 1)), ...headers.map((_, c) => cell(r[c], c))))
        : [el("tr", {}, el("td", { class: "dt-none", colspan: String(cols + 1) }, "No rows match."))]),
    );
    count.textContent = input.value.trim() ? `${shown.length.toLocaleString()} of ${data.length.toLocaleString()} rows` : "";
    cut.hidden = shown.length <= MAX_ROWS;
    cut.textContent = `Showing the first ${MAX_ROWS.toLocaleString()} of ${shown.length.toLocaleString()} rows.`;
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.preventDefault();
      e.stopPropagation();
      input.value = "";
      draw();
    }
  });
  draw();
  return {
    node: el("div", { class: "ap-table-wrap" }, el("label", { class: "dt-bar" }, icon("search", 13), input, count), el("table", { class: "ap-table" }, thead, tbody), cut),
    meta: `${data.length.toLocaleString()} row${data.length === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"}`,
  };
}

/** A grid thumbnail showing the file's first lines (fetched once the card scrolls into view). */
export function textThumb(path: string, size: number, fallback: HTMLElement): HTMLElement {
  if (size > MAX_THUMB || size === 0) return fallback;
  const pre = el("pre", { class: "as-text" });
  const box = el("div", { class: `as-textthumb is-${textFormat(path)}` }, pre);
  const load = () =>
    void fetch(fileUrl(path))
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        const lines = t.split("\n").slice(0, 12).map((l) => (l.length > 64 ? `${l.slice(0, 64)}…` : l));
        pre.textContent = textFormat(path) === "csv" ? lines.map((l) => l.replace(/,/g, "  ")).join("\n") : lines.join("\n");
      })
      .catch(() => box.replaceWith(fallback));
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      load();
    }
  });
  io.observe(box);
  return box;
}
