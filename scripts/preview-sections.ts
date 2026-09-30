// What each PR asks you to try on its Preview, read from examples/preview/:
//
//   examples/preview/<slug>.md      one PR's section: frontmatter `pr: 52` and `title: Recurring tasks`,
//                                   then numbered steps that link [[Demo notes]]
//   examples/preview/<slug>/**      that section's demo notes and files, made under Try/<title>/ in
//                                   the Preview (a `_root/` folder in it goes to the vault's root
//                                   instead, for things like Templates/)
//   <Note>.versions/<n> <name>.md    earlier versions of the demo note <Note>.md, oldest first: each is
//                                   saved in turn and marked with its name (a marked version), and
//                                   then the note itself is saved on top
//
// Demo notes can say `{{date}}`, `{{date:+3d}}`, `{{date:-2d}}` or `{{date:+1w}}`, filled in with ISO
// dates on the day it's seeded, so due dates make sense whenever the Preview deploys. `{{!date}}`
// leaves a literal `{{date}}` (for a template that fills it in itself).
import fs from "node:fs";
import path from "node:path";

export interface Section {
  slug: string;
  pr: number | null;
  title: string;
  /** The steps, as markdown. */
  body: string;
  /** Demo files: where each goes in the workspace, and where it is here, with any marked versions to save first. */
  files: Array<{ to: string; from: string; versions?: Array<{ name: string; from: string }> }>;
}

/** The day `n` days after `day` (both YYYY-MM-DD). */
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Fill in `{{date}}` placeholders as of `today`; `{{!date}}` becomes a literal `{{date}}`. */
export function fillDates(text: string, today: string): string {
  return text
    .replace(/\{\{date(?::([+-]\d+)([dw]))?\}\}/g, (_m, n?: string, unit?: string) => (n ? addDays(today, Number(n) * (unit === "w" ? 7 : 1)) : today))
    .replace(/\{\{!date\}\}/g, "{{date}}");
}

/** Every section in `dir`, by file name; none if the folder isn't there. */
export function readSections(dir: string): Section[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const slug = f.slice(0, -3);
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      const field = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, "m"))?.[1].replace(/^["']|["']$/g, "");
      const title = field("title") ?? slug;
      const files: Section["files"] = [];
      const walk = (rel: string) => {
        for (const ent of fs.readdirSync(path.join(dir, slug, rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${ent.name}` : ent.name;
          if (ent.isDirectory() && ent.name.endsWith(".versions")) continue; // a note's earlier versions: read with the note
          if (ent.isDirectory()) walk(r);
          else {
            const from = path.join(dir, slug, r);
            const versionsDir = from.replace(/\.md$/, ".versions");
            const versions = r.endsWith(".md") && fs.existsSync(versionsDir)
              ? fs.readdirSync(versionsDir).filter((v) => v.endsWith(".md")).sort().map((v) => ({ name: v.replace(/^\d+\s+/, "").replace(/\.md$/, ""), from: path.join(versionsDir, v) }))
              : undefined;
            files.push({ to: r.startsWith("_root/") ? r.slice(6) : `Try/${title}/${r}`, from, ...(versions ? { versions } : {}) });
          }
        }
      };
      if (fs.existsSync(path.join(dir, slug))) walk("");
      return { slug, pr: Number(field("pr")) || null, title, body: text.slice(fm?.[0].length ?? 0).trim(), files };
    });
}

/** This PR's section first, then the others (from the PRs this one is stacked on). */
export function orderSections(sections: Section[], pr: number | null): { mine: Section[]; others: Section[] } {
  const mine = sections.filter((s) => pr !== null && s.pr === pr);
  return { mine, others: sections.filter((s) => !mine.includes(s)) };
}

/** The sections as they go in "Try this PR": this PR's under its own heading, the rest under "Also in this branch". */
export function sectionsMarkdown(sections: Section[], pr: number | null): string[] {
  const { mine, others } = orderSections(sections, pr);
  const tag = (s: Section) => (s.pr ? ` (#${s.pr})` : "");
  return [
    ...mine.flatMap((s) => [`## ${s.title}${tag(s)}`, "", s.body, ""]),
    ...(others.length ? ["## Also in this branch", "", ...others.flatMap((s) => [`### ${s.title}${tag(s)}`, "", s.body, ""])] : []),
  ];
}
