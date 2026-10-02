// The Today page's week card (the numbers are worked out in weekRecap.ts), with the 12-week heatmap
// of your writing days under it (streak.ts). It's this week so far; on the first visit of a new week
// it's last week's recap instead, with "Save as journal note", until you save or dismiss it (this
// browser remembers which week that was). A workspace that isn't gamified (gamify.ts) has no card.
import { api, ApiError, type Change } from "./api.ts";
import { el, icon, isSelf } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { COUNTS, heatmap, writingDays } from "./streak.ts";
import { store } from "./store.ts";
import { today } from "./taskChips.ts";
import { toast } from "./toast.ts";
import { lastMonday, noteTitle, recapDue, recapLines, recapMarkdown, recapPath, weekRecap } from "./weekRecap.ts";
import { mondayOf } from "./writingDays.ts";

const KEY = "weekRecap";
const PAGE = 500;
/** At most this many pages of the log; a busier fortnight shows what they hold. */
const MAX_PAGES = 8;

/** The change log back to `from` (a timestamp), newest first. */
async function changesSince(from: number): Promise<Change[]> {
  const out: Change[] = [];
  let before: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await api.history({ limit: PAGE, before });
    out.push(...got);
    const last = got.at(-1);
    if (!last || got.length < PAGE || last.ts < from) break;
    before = last.id;
  }
  return out;
}

/** Last week and this week so far, and your writing days for the heatmap. */
async function load(day: string) {
  const prev = lastMonday(day);
  const [changes, tasks, days] = await Promise.all([changesSince(new Date(`${prev}T00:00:00`).getTime()), api.tasks({ today: day }), writingDays()]);
  return { last: weekRecap(changes, tasks, prev, isSelf), now: weekRecap(changes, tasks, mondayOf(day), isSelf), days };
}

/** Draw the card into `host`; `open` opens a note. Returns its cleanup. */
export function mountWeekRecap(host: HTMLElement, open: (path: string) => void): () => void {
  const body = el("div", { class: "qw-body" }, el("div", { class: "qt-empty" }, "Loading…"));
  const title = el("span", {}, "This week");
  const close = el("span");
  host.replaceChildren(
    el("section", { class: "qw wr-card is-standalone", "aria-labelledby": "wr-heading" }, el("h2", { class: "td-title", id: "wr-heading" }, icon("spark", 14), title, close), body),
  );
  let alive = true;
  let got: Awaited<ReturnType<typeof load>> | null = null;
  const draw = () => {
    if (!got) return;
    const day = today();
    const showLast = recapDue(day, store.get(KEY, ""), got.last);
    const r = showLast ? got.last : got.now;
    const done = () => (store.set(KEY, mondayOf(day)), draw());
    title.textContent = showLast ? `Last week · ${date(r.from)} to ${date(r.to)}` : "This week";
    close.replaceChildren(
      showLast ? el("button", { type: "button", class: "qw-icon wr-close", title: "Dismiss", "aria-label": "Dismiss last week's recap", onclick: done }, icon("close", 14)) : "",
    );
    const save = async () => {
      const path = recapPath(r);
      try {
        await api.create(path, recapMarkdown(r));
      } catch (e) {
        // Already saved (in another browser, say): open that one.
        if (!(e instanceof ApiError && e.status === 409)) return toast({ text: "Couldn't save the recap" });
      }
      done();
      open(path);
    };
    const revisited = r.revisited
      ? el("li", {}, "Came back to most: ", el("button", { type: "button", class: "wr-note", onclick: () => open(r.revisited!.path) }, noteTitle(r.revisited.path)), `, on ${r.revisited.days} days`)
      : null;
    body.replaceChildren(
      el("ul", { class: "wr-lines" }, ...recapLines(r).map((l) => el("li", {}, l)), revisited),
      showLast ? el("div", { class: "wr-actions" }, el("button", { type: "button", class: "qw-btn primary", onclick: () => void save() }, "Save as journal note")) : "",
      heatmap(got.days, day),
      el("p", { class: "wd-what" }, COUNTS),
    );
  };
  const refresh = async () => {
    const next = await load(today()).catch(() => null);
    if (!alive) return;
    if (!next && !got) return body.replaceChildren(el("div", { class: "qt-empty" }, "Couldn't load your week"));
    if (next) got = next;
    draw();
  };
  void refresh();
  // A few seconds after the last change, so typing in a note to the side isn't slowed.
  const off = onVaultChange(() => void refresh(), 4000);
  return () => {
    alive = false;
    off();
  };
}

const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
