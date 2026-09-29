// A made-up vault for benchmarks: the same files for the same size every time. Notes link to each
// other (a few hubs get most links), carry nested tags, tasks with tokens and repeats, embeds and
// the odd Kanban board, and there are a few very large notes and some assets.

export const TODAY = "2026-09-28";

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "plan launch review draft budget roadmap hiring design research notes meeting follow up customer onboarding pricing release metrics sprint retro garden recipe travel reading health invoice contract email outline backlog bug fix idea sketch essay chapter archive podcast interview".split(" ");
const PEOPLE = ["jane", "sam", "priya", "leo", "mia", "omar", "audrow"];
const RECS = ["weekly", "monthly", "2w", "mon,thu", "1st-tue", "last-day", "after-1m", "daily"];
const TAG_ROOTS = ["work", "home", "health", "reading", "people", "project", "area", "ref", "idea", "travel"];

export interface GeneratedVault {
  files: Record<string, string>;
  /** Binary files, as bytes. */
  assets: Record<string, Uint8Array>;
  /** Note paths, most linked first. */
  hubs: string[];
  tags: string[];
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `notes` markdown notes (plus assets and a few large ones), deterministic for a given size. */
export function generateVault(notes: number, opts: { large?: number } = {}): GeneratedVault {
  const r = rng(notes);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");

  // About a thousand tags at 10k notes, nested up to three deep.
  const tags: string[] = [];
  const tagCount = Math.max(60, Math.round(notes / 10));
  for (let i = 0; i < tagCount; i++) {
    const root = TAG_ROOTS[i % TAG_ROOTS.length];
    const depth = i % 3;
    tags.push(depth === 0 ? `${root}/t${i}` : depth === 1 ? `${root}/g${i % 17}/t${i}` : root);
  }
  const tag = () => tags[Math.floor(Math.pow(r(), 2) * tags.length)];

  const paths: string[] = [];
  const titles: string[] = [];
  for (let i = 0; i < notes; i++) {
    const kind = r();
    const title = `${words(2)} ${i}`.replace(/^\w/, (c) => c.toUpperCase());
    const folder =
      kind < 0.35 ? "Journal" : kind < 0.55 ? `Projects/${pick(["Apollo", "Beacon", "Cedar", "Delta"])}` : kind < 0.7 ? `Areas/${pick(["Work", "Home", "Health"])}` : kind < 0.85 ? "Ideas" : kind < 0.95 ? "Meetings" : "Archive/Projects";
    const name = folder === "Journal" ? addDays(TODAY, -i) : title;
    paths.push(`${folder}/${name}.md`);
    titles.push(folder === "Journal" ? name : title);
  }
  // A few hubs get most of the links.
  const linkTo = () => titles[Math.floor(Math.pow(r(), 3) * titles.length)];
  const assetCount = Math.max(10, Math.round(notes / 100));
  const assetPaths = Array.from({ length: assetCount }, (_, i) => `assets/image-${i}.png`);

  const task = () => {
    const bits = [words(int(2, 6))];
    if (r() < 0.6) bits.push(`due:${addDays(TODAY, int(-30, 60))}`);
    if (r() < 0.15) bits.push(`start:${addDays(TODAY, int(-5, 10))}`);
    if (r() < 0.2) bits.push(`rec:${pick(RECS)}`);
    if (r() < 0.3) bits.push(`@${pick(PEOPLE)}`);
    if (r() < 0.15) bits.push(r() < 0.5 ? "!high" : "!low");
    if (r() < 0.4) bits.push(`#${tag()}`);
    if (r() < 0.15) bits.push(`[[${linkTo()}]]`);
    return `- [${r() < 0.3 ? "x" : " "}] ${bits.join(" ")}`;
  };

  const files: Record<string, string> = {};
  for (let i = 0; i < notes; i++) {
    const lines: string[] = [];
    if (r() < 0.3) lines.push("---", `tags: [${Array.from({ length: int(1, 3) }, tag).join(", ")}]`, "---");
    lines.push(`# ${titles[i]}`, "");
    const sections = int(1, 4);
    for (let s = 0; s < sections; s++) {
      lines.push(`## ${words(2)}`, "");
      for (let p = 0; p < int(1, 3); p++) {
        const para: string[] = [];
        for (let w = 0; w < int(3, 8); w++) {
          const x = r();
          para.push(x < 0.12 ? `[[${linkTo()}]]` : x < 0.2 ? `#${tag()}` : words(int(3, 9)));
        }
        lines.push(`${para.join(" ")}.`, "");
      }
      if (r() < 0.5) {
        for (let t = 0; t < int(1, 6); t++) lines.push(task());
        lines.push("");
      }
      if (r() < 0.1) lines.push(`![[${linkTo()}]]`, "");
      if (r() < 0.08) lines.push(`![[${pick(assetPaths)}]]`, "");
    }
    if (r() < 0.02) {
      lines.push(":::kanban", "## Backlog");
      for (let c = 0; c < int(5, 15); c++) lines.push(task().replace("[x]", "[ ]"));
      lines.push("", "## Doing");
      for (let c = 0; c < int(2, 6); c++) lines.push(task().replace("[x]", "[ ]"));
      lines.push("", "## Done");
      for (let c = 0; c < int(3, 10); c++) lines.push(task().replace("[ ]", "[x]"));
      lines.push(":::", "");
    }
    files[paths[i]] = lines.join("\n");
  }

  // Very large notes: about 1 MB and 20k lines each, full of tasks and links.
  for (let i = 0; i < (opts.large ?? 3); i++) {
    const lines = [`# Big log ${i}`, ""];
    while (lines.length < 20_000) {
      const x = r();
      lines.push(x < 0.4 ? task() : x < 0.55 ? `Met with @${pick(PEOPLE)} about [[${linkTo()}]] #${tag()} ${words(int(4, 8))}` : words(int(6, 12)));
    }
    files[`Logs/Big log ${i}.md`] = lines.join("\n");
  }

  const assets: Record<string, Uint8Array> = {};
  const assetTags: Record<string, string[]> = {};
  for (const [i, p] of assetPaths.entries()) {
    assets[p] = Uint8Array.from({ length: 256 + (i % 7) * 64 }, (_, j) => (j * 31 + i) & 255);
    if (i % 3 === 0) assetTags[p] = [tag()];
  }
  files["assets/.tags.json"] = `${JSON.stringify(assetTags, null, 2)}\n`;

  const inbound = new Map<string, number>();
  for (const text of Object.values(files)) for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) inbound.set(m[1], (inbound.get(m[1]) ?? 0) + 1);
  const links = (i: number) => inbound.get(titles[i]) ?? 0;
  const hubs = paths
    .map((p, i) => ({ p, n: links(i) }))
    .filter((x) => !x.p.startsWith("Archive/"))
    .sort((a, b) => b.n - a.n)
    .map((x) => x.p);
  return { files, assets, hubs: hubs.slice(0, 20), tags };
}
