// Online-only: Delete my account, from the account menu. It says what goes (your own workspaces,
// with their notes and files), what you leave (teams others are in, which keep their notes) and
// what's in the way (a team you're the only owner of), offers an export first, and asks you to type
// your email. The work is the Worker's (cloud/src/account.ts).
import { api, type Me } from "./api.ts";
import { el, icon } from "./dom.ts";

export async function showDeleteAccount(me: Me["user"], toast: (t: { text: string; icon?: string }) => void, exportAll: () => unknown) {
  document.querySelector("#agents-page")?.remove();
  const body = el("div", { class: "ws-settings" }, el("p", { class: "agents-empty" }, "Loading…"));
  const close = () => (page.remove(), document.removeEventListener("keydown", onKey));
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  const page = el(
    "div",
    { id: "agents-page", onmousedown: (e: Event) => e.target === page && close() },
    el(
      "div",
      { class: "agents-box", role: "dialog", "aria-label": "Delete your account" },
      el("div", { class: "agents-head" }, icon("trash", 16), el("h2", {}, "Delete your account"), el("button", { class: "icon-btn small", type: "button", title: "Close", "aria-label": "Close", onclick: close }, icon("close", 15))),
      body,
    ),
  );
  document.addEventListener("keydown", onKey);
  document.body.append(page);

  const section = (title: string, ...children: HTMLElement[]) => el("section", { class: "ws-section" }, el("h3", {}, title), ...children);
  const list = (items: Array<{ name: string; kind: string }>) => el("ul", { class: "agents-changes" }, ...items.map((w) => el("li", {}, w.kind === "personal" ? `${w.name} (yours)` : w.name)));

  try {
    const plan = await api.deletionPlan();
    if (plan.blocked.length) {
      body.replaceChildren(
        section(
          "First, hand over your teams",
          el("p", { class: "agents-how" }, "You're the only owner of these teams, and other people are in them. Make someone else an owner (in Workspace settings), or delete the team, and come back."),
          list(plan.blocked),
        ),
      );
      return;
    }
    const confirmBox = el("input", { class: "ws-input", placeholder: me.email, autocomplete: "off", "aria-label": "Type your email to delete your account" });
    const go = el("button", { type: "button", class: "qw-btn danger", disabled: true, onclick: async () => {
      go.disabled = true;
      try {
        await api.deleteAccount(confirmBox.value);
        try {
          localStorage.removeItem("commonink.ws");
        } catch {}
        location.href = "/";
      } catch (e) {
        go.disabled = false;
        toast({ text: e instanceof Error ? e.message : "That didn't work" });
      }
    } }, "Delete my account");
    confirmBox.addEventListener("input", () => (go.disabled = confirmBox.value.trim().toLowerCase() !== me.email.toLowerCase()));
    body.replaceChildren(
      section("Deleted, with every note and file in them", list(plan.deletes)),
      ...(plan.leaves.length ? [section("You'll leave these, and they keep what you wrote", list(plan.leaves))] : []),
      section(
        "Also",
        el("p", { class: "agents-how" }, "Your connected agents and the CLI are disconnected, you're signed out everywhere, Google Calendar is disconnected, and notes shared with you are no longer shared. It can't be undone."),
        el("button", { type: "button", class: "qw-btn", onclick: () => exportAll() }, "Export all notes (.zip) first"),
      ),
      section("To confirm, type your email", el("div", { class: "ws-row" }, confirmBox, go)),
    );
  } catch (e) {
    body.replaceChildren(el("p", { class: "agents-empty" }, `Couldn't load what your account holds: ${(e as Error).message}`));
  }
}
