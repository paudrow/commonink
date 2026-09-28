// Text assets (CSV, JSON, plain text) in the Assets page: the first lines as a grid thumbnail,
// and a preview that reads the file the way it's meant to be read (a table, formatted JSON) or
// as the raw text, whichever you pick.
import { fileUrl } from "./api.ts";
import { el, icon } from "./dom.ts";
import { fmtBytes, textFormat, type TextFormat } from "./assetKinds.ts";

const MAX_PREVIEW = 5 * 1024 * 1024; // bigger than this: offer the download instead
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
        const seg = el(
          "div",
          { class: "seg" },
          ...MODES[format].map((m) =>
            el("button", { type: "button", class: m === mode ? "is-on" : "", onclick: () => ((mode = m), remember(format, m), render()) }, LABEL[m]),
          ),
        );
        const view = mode === "table" ? tableView(text) : mode === "formatted" ? jsonView(text) : rawView(text);
        bar.replaceChildren(...(MODES[format].length > 1 ? [seg] : []), el("span", { class: "ap-text-meta" }, view.meta), el("span", { class: "spacer" }), copy);
        body.replaceChildren(view.node);
        body.scrollTop = 0;
      };
      render();
    })
    .catch(() => body.replaceChildren(el("div", { class: "ap-text-note" }, "Couldn't load this file.")));
  return box;
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

/** A CSV as a table: first row as the header, row numbers, the first MAX_ROWS rows. */
function tableView(text: string): { node: HTMLElement; meta: string } {
  const rows = parseCsv(text);
  if (!rows.length) return { node: el("div", { class: "ap-text-note" }, "This file is empty."), meta: "" };
  const [head, ...data] = rows;
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (tag: "th" | "td", v: string | undefined) => el(tag, { title: v && v.length > 40 ? v : undefined }, v ?? "");
  const table = el(
    "table",
    { class: "ap-table" },
    el("thead", {}, el("tr", {}, el("th", { class: "ap-rownum" }, ""), ...Array.from({ length: cols }, (_, i) => cell("th", head[i])))),
    el(
      "tbody",
      {},
      ...data.slice(0, MAX_ROWS).map((r, n) => el("tr", {}, el("td", { class: "ap-rownum" }, String(n + 1)), ...Array.from({ length: cols }, (_, i) => cell("td", r[i])))),
    ),
  );
  const cut = data.length > MAX_ROWS ? el("div", { class: "ap-text-note" }, `Showing the first ${MAX_ROWS.toLocaleString()} of ${data.length.toLocaleString()} rows.`) : null;
  return { node: el("div", { class: "ap-table-wrap" }, table, cut), meta: `${data.length.toLocaleString()} row${data.length === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"}` };
}

/** RFC 4180-ish: commas, quoted fields, doubled quotes, and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      (row = []), (field = "");
    } else field += c;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.length > 1 || r[0] !== "");
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
