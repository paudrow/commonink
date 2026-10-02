// Your seals (seals.ts), in a dialog of their own: a grid of firsts worth knowing, earned ones pressed
// in the ink you use and the rest grey with a line on how to earn them, so each points at something to
// try. It's yours, so it opens from your account menu online, from Settings and ⌘K, and from the toast
// that says one was earned. It redraws as seals are earned, and closes if an owner turns rewards off.
import { el, icon } from "./dom.ts";
import { gamified, onGamified } from "./gamify.ts";
import { openModal } from "./modal.ts";
import { sealProgress, sealsFor } from "./seals.ts";
import { onSeals, sealState } from "./sealUnlocks.ts";

function grid(): HTMLElement[] {
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

export function showSeals() {
  if (!gamified()) return;
  const body = el("div", { class: "seal-body" }, ...grid());
  const stop = [onSeals(() => body.replaceChildren(...grid())), onGamified((on) => !on && modal.close())];
  const modal = openModal({
    title: "Your seals",
    icon: "spark",
    content: [body],
    id: "seals-page",
    pageClass: "",
    boxClass: "agents-box",
    headClass: "agents-head",
    titleId: "seals-title",
    onClose: () => stop.forEach((f) => f()),
  });
}
