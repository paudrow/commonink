// CSV rows: the CSV viewer's (web/src/csv.ts) and contact import's (contacts.ts).

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
