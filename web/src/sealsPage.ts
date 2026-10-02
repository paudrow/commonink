// Your seals (seals.ts), in a dialog of their own: a grid of firsts worth knowing, earned ones pressed
// in the ink you use and the rest grey with a line on how to earn them, so each points at something to
// try. It's yours, so it opens from your account menu online, from Settings and ⌘K, and from the toast
// that says one was earned. It redraws as seals are earned, and closes if an owner turns rewards off.
import { el, icon } from "./dom.ts";
import { gamified, onGamified } from "./gamify.ts";
import { trapKeys } from "./modal.ts";
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
  document.querySelector("#seals-page")?.remove();
  if (!gamified()) return;
  const back = document.activeElement as HTMLElement | null;
  const body = el("div", { class: "seal-body" }, ...grid());
  const stop = [onSeals(() => body.replaceChildren(...grid())), onGamified((on) => !on && close())];
  const close = () => {
    stop.forEach((f) => f());
    page.remove();
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const box = el(
    "div",
    { class: "agents-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "seals-title", tabindex: "-1" },
    el(
      "div",
      { class: "agents-head" },
      icon("spark", 16),
      el("h2", { id: "seals-title" }, "Your seals"),
      el("button", { class: "icon-btn small", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: close }, icon("close", 15)),
    ),
    body,
  );
  const page = el("div", { id: "seals-page", onmousedown: (e: Event) => e.target === page && close() }, box);
  trapKeys(page, box, close);
  document.body.append(page);
  box.focus();
}
