// Online-only UI: the sign-in screen, and the account menu (workspaces, invites, connected agents, sign out).

import { api, type Me } from "./api.ts";
import { $, el, icon } from "./dom.ts";

const GOOGLE_G =
  '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

/** Full-page sign-in. `next` brings people back where they were (e.g. an invite link). */
export function showSignIn() {
  $("#app").hidden = true;
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  const google = el("a", { class: "google-btn", href: `/auth/google?next=${next}` });
  google.innerHTML = `${GOOGLE_G}<span>Continue with Google</span>`;
  document.body.append(
    el(
      "div",
      { id: "signin" },
      el(
        "div",
        { class: "signin-card" },
        el("span", { class: "brand-mark big", "aria-hidden": "true" }),
        el("h1", {}, "Common Ink"),
        el("p", { class: "signin-tag" }, "Notes and files for you, your team, and your agents."),
        google,
        el("p", { class: "signin-fine" }, "Plain markdown underneath. Any agent can work in it through MCP."),
      ),
      el("p", { class: "signin-legal" }, el("a", { href: "/privacy" }, "Privacy"), el("a", { href: "/terms" }, "Terms")),
    ),
  );
}

const PICKED = "quire.ws";

/** The workspace to open: ?w=… (from an invite or a switch), then the last one used, then your own. */
export function pickWorkspace(me: Me) {
  const fromUrl = new URLSearchParams(location.search).get("w");
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PICKED);
  } catch {}
  const ws = me.workspaces.find((w) => w.id === fromUrl) ?? me.workspaces.find((w) => w.id === saved) ?? me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0];
  try {
    localStorage.setItem(PICKED, ws.id);
  } catch {}
  if (fromUrl) history.replaceState(null, "", location.pathname + location.hash);
  return ws;
}

function switchTo(id: string) {
  try {
    localStorage.setItem(PICKED, id);
  } catch {}
  location.href = "/";
}

/** The account button at the bottom of the sidebar, with its menu. */
export function renderAccount(me: Me, current: Me["workspaces"][number], toast: (t: { text: string; icon?: string }) => void) {
  const face = me.user.picture
    ? el("img", { class: "acct-face", src: me.user.picture, alt: "", referrerpolicy: "no-referrer" })
    : el("span", { class: "acct-face is-initial" }, me.user.name.slice(0, 1).toUpperCase());
  const button = el(
    "button",
    { class: "acct-btn", type: "button", title: me.user.email },
    face,
    el("span", { class: "acct-text" }, el("span", { class: "acct-name" }, me.user.name), el("span", { class: "acct-ws" }, current.name)),
    icon("chevron", 13),
  );
  const menu = el("div", { class: "acct-menu", hidden: true });
  const close = () => (menu.hidden = true);
  const item = (label: string, ico: string, fn: () => void, extra?: string) =>
    el("button", { class: `acct-item${extra ? ` ${extra}` : ""}`, type: "button", onclick: () => (close(), fn()) }, icon(ico, 15), el("span", {}, label));

  menu.append(
    el("div", { class: "acct-section" }, "Workspaces"),
    ...me.workspaces.map((w) =>
      item(`${w.name}${w.kind === "personal" ? " (you)" : ""}`, w.kind === "team" ? "feed" : "file", () => switchTo(w.id), w.id === current.id ? "is-current" : ""),
    ),
    item("New team workspace…", "plus", async () => {
      const name = prompt("Name your team workspace", "My team")?.trim();
      if (!name) return;
      const { id } = await api.createWorkspace(name);
      switchTo(id);
    }),
    ...(current.kind === "team" && current.role === "owner"
      ? [
          item("Copy invite link", "link", async () => {
            const { url } = await api.invite("editor");
            await navigator.clipboard.writeText(url).catch(() => prompt("Invite link (one person, 7 days)", url));
            toast({ icon: "link", text: "Invite link copied. It works once, for 7 days." });
          }),
        ]
      : []),
    item(current.role === "owner" ? "Workspace settings…" : "Members…", "sliders", () => void import("./workspaceSettings.ts").then((m) => m.showWorkspaceSettings(current, me.user, toast))),
    item("Connected agents…", "bot", () => void import("./agentsPage.ts").then((m) => m.showAgents())),
    el("div", { class: "acct-sep" }),
    item("Sign out", "open", () => {
      const form = el("form", { method: "post", action: "/auth/logout" });
      document.body.append(form);
      form.submit();
    }),
    item("Sign out everywhere…", "open", async () => {
      if (!confirm("Sign out of Common Ink on every device and browser, including this one, and disconnect your agents?")) return;
      await api.signOutEverywhere();
      location.href = "/";
    }),
  );
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) close();
  });
  const box = el("div", { class: "acct" }, menu, button);
  $("#sidebar .sidebar-foot").prepend(box);
}
