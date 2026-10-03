// Your profile (/profile): who you are, as the account menu shows you, the days you wrote (the
// heatmap from Today's week card, as wide as the page), and Your seals (seals.ts): a grid of firsts
// worth knowing, earned ones pressed in the ink you use and the rest grey with a line on how to earn
// them, so each points at something to try. It opens from your account menu online, from ⌘K, and from
// the toast that says a seal was earned. Locally there's no account, and it's the vault's person: you.
// The seals redraw as they're earned, and leave the page while an owner has rewards off (gamify.ts).
import { el, icon } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { gamified, onGamified } from "./gamify.ts";
import { sealProgress, sealsFor } from "./seals.ts";
import { onSeals, sealState } from "./sealUnlocks.ts";
import { COUNTS, writingDays, writingSummary } from "./writingHeatmap.ts";

/** Who you are, as the account menu says it; null locally. */
export interface Profile {
  name: string;
  email: string;
  picture: string | null;
  workspace: string;
}

function sealGrid(): HTMLElement[] {
  const { online, earned, stats } = sealState();
  const seals = sealsFor(online);
  const got = seals.filter((s) => earned.includes(s.id)).length;
  const items = seals.map((seal) => {
    const open = earned.includes(seal.id);
    const count = open ? null : sealProgress(seal, stats);
    return el(
      "li",
      { class: `seal${open ? " is-earned" : ""}`, title: open ? `${seal.name}: ${seal.earned}` : `${seal.name}: ${seal.how}` },
      el("span", { class: "seal-mark", "aria-hidden": "true" }, icon(seal.icon, 16)),
      el("span", { class: "seal-name" }, seal.name, el("span", { class: "sr-only" }, open ? " (earned)" : "")),
      open ? null : el("span", { class: "seal-how" }, seal.how),
      count ? el("span", { class: "seal-count" }, count) : null,
    );
  });
  return [el("p", { class: "seal-tally" }, `${got} of ${seals.length} earned`), el("ul", { class: "seal-row" }, ...items)];
}

export class ProfilePage {
  readonly root: HTMLElement;
  private days = el("div", { class: "profile-days" }, el("div", { class: "qt-empty" }, "Loading…"));
  private seals = el("section", { class: "profile-section", id: "profile-seals", "aria-labelledby": "profile-seals-title" });
  private sealBody = el("div", { class: "seal-body" });

  constructor(root: HTMLElement, me: Profile | null) {
    this.root = root;
    const face = me?.picture
      ? el("img", { class: "profile-face", src: me.picture, alt: "", referrerpolicy: "no-referrer" })
      : el("span", { class: "profile-face is-initial", "aria-hidden": "true" }, (me?.name ?? "You").slice(0, 1).toUpperCase());
    this.seals.append(el("h2", { id: "profile-seals-title" }, icon("spark", 14), "Your seals"), this.sealBody);
    root.append(
      el(
        "div",
        { class: "page profile-page" },
        el(
          "header",
          { class: "page-head profile-head" },
          face,
          el("div", { class: "profile-who" }, el("h1", {}, me?.name ?? "You"), el("p", { class: "page-sub" }, me ? `${me.email} · ${me.workspace}` : "On this computer")),
        ),
        el("section", { class: "profile-section", "aria-labelledby": "profile-days-title" }, el("h2", { id: "profile-days-title" }, icon("drop", 14), "Writing days"), this.days),
        this.seals,
      ),
    );
    // Kept current while it's open; drawn again when it's next shown.
    onSeals(() => this.visible && this.drawSeals());
    onGamified(() => this.visible && this.drawSeals());
    onVaultChange(() => this.visible && void this.drawDays(), 4000);
  }

  get visible() {
    return !this.root.hidden;
  }

  private drawSeals() {
    this.seals.hidden = !gamified();
    if (gamified()) this.sealBody.replaceChildren(...sealGrid());
  }

  private async drawDays() {
    try {
      const days = await writingDays();
      if (this.visible) this.days.replaceChildren(writingSummary(days), el("p", { class: "wd-what" }, COUNTS));
    } catch {
      if (this.visible) this.days.replaceChildren(el("div", { class: "qt-empty" }, "Couldn't load your writing days"));
    }
  }

  /** Show it; `seals` scrolls to Your seals (the toast's "See seals"). */
  show(opts: { seals?: boolean } = {}) {
    this.root.hidden = false;
    this.drawSeals();
    void this.drawDays();
    if (opts.seals && !this.seals.hidden) this.seals.scrollIntoView({ block: "start" });
    else this.root.scrollTop = 0;
    this.root.focus({ preventScroll: true });
  }
}
