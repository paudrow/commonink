// CSV as a sortable, filterable table: parsing, column types, sorting and the filter language.
// No DOM here, so it runs (and is tested) under Node too.

export interface CsvTable {
  /** One per column: the first row's cell, or "Column N" where that's blank or missing. */
  headers: string[];
  /** Every row after the first. Rows can be shorter or longer than the header. */
  data: string[][];
  /** Whether each column holds only numbers (blanks aside). */
  numeric: boolean[];
}

/** RFC 4180-ish: commas, quoted fields, doubled quotes, and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel's byte-order mark
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

/** The first row as the header and the rest as data, or null for an empty file. */
export function csvTable(text: string): CsvTable | null {
  const rows = parseCsv(text);
  if (!rows.length) return null;
  const [head, ...data] = rows;
  // A loop, not Math.max(...lengths): spreading a few hundred thousand rows overflows the stack.
  let cols = 0;
  for (const r of rows) cols = Math.max(cols, r.length);
  const headers = Array.from({ length: cols }, (_, i) => head[i]?.trim() || `Column ${i + 1}`);
  return { headers, data, numeric: headers.map((_, c) => isNumericColumn(data, c)) };
}

/** "$1,200", "15%", "-3.5" → numbers; anything else → NaN. */
export const toNumber = (v: string) => (/^[-+]?[$€£]?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*%?$/.test(v.trim()) ? Number(v.replace(/[,$€£%\s]/g, "")) : NaN);

function isNumericColumn(rows: string[][], c: number): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r[c]?.trim();
    if (!v) continue;
    if (Number.isNaN(toNumber(v))) return false;
    seen++;
  }
  return seen > 0;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Blank cells sort last whichever way you sort. */
export function compareCells(a = "", b = "", numeric: boolean, dir: 1 | -1): number {
  const ea = !a.trim();
  const eb = !b.trim();
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  return dir * (numeric ? toNumber(a) - toNumber(b) : collator.compare(a, b));
}

/** A column by its name, or failing that by the start of its name; -1 if none. */
function columnNamed(headers: string[], name: string): number {
  const exact = headers.findIndex((h) => h.toLowerCase() === name);
  return exact >= 0 ? exact : headers.findIndex((h) => h.toLowerCase().startsWith(name));
}

/**
 * The filter box: words match any cell; `col:value` matches one column (the column can be the
 * start of its name); numeric columns take `>`, `<`, `>=`, `<=`, `=`; quotes keep spaces
 * (`city:"New York"`); a leading `-` excludes. Every term has to hold.
 */
export function rowFilter(query: string, headers: string[], numeric: boolean[]): (row: string[]) => boolean {
  const unquote = (s: string) => s.replace(/^"(.*)"$/, "$1").toLowerCase();
  const terms = (query.match(/-?(?:[^\s:"]+:)?(?:"[^"]*"|\S+)/g) ?? []).map((raw) => {
    const negate = raw.startsWith("-") && raw.length > 1;
    const t = negate ? raw.slice(1) : raw;
    const m = t.match(/^([^:"]+):(.+)$/);
    const c = m ? columnNamed(headers, m[1].toLowerCase()) : -1;
    let test: (row: string[]) => boolean;
    if (m && c >= 0) {
      const value = unquote(m[2]);
      const cmp = numeric[c] ? value.match(/^(>=|<=|>|<|=)\s*(.+)$/) : null;
      if (cmp && !Number.isNaN(toNumber(cmp[2]))) {
        const want = toNumber(cmp[2]);
        test = (row) => {
          const n = toNumber(row[c] ?? "");
          if (Number.isNaN(n)) return false;
          return { ">": n > want, "<": n < want, ">=": n >= want, "<=": n <= want, "=": n === want }[cmp[1]]!;
        };
      } else test = (row) => (row[c] ?? "").toLowerCase().includes(value);
    } else {
      const value = unquote(t);
      test = (row) => row.some((v) => v.toLowerCase().includes(value));
    }
    return negate ? (row: string[]) => !test(row) : test;
  });
  return (row) => terms.every((t) => t(row));
}
