// Online-only: a workspace's settings. Everyone sees who's in it and can leave a team; owners also
// rename it, change roles, remove people, make and revoke invite links, turn Unlock as you go
// (gamify.ts) on and off, read what changed, and delete a team workspace (typing its name first).
import { api, type Me, type WorkspaceInvite, type WorkspaceLogEntry, type WorkspaceMember } from "./api.ts";
import { el, icon, timeAgo } from "./dom.ts";
import { ask, copyLink, openModal } from "./modal.ts";
import { gamified, setGamified } from "./gamify.ts";

type Workspace = Me["workspaces"][number];

/** Go to your own workspace (after leaving or deleting this one). */
function goHome() {
  try {
    localStorage.removeItem("commonink.ws");
  } catch {}
  location.href = "/";
}

const ROLE_NOTE = { owner: "can do everything, including inviting and removing people", editor: "can read and edit notes", viewer: "can read notes" };

export async function showWorkspaceSettings(ws: Workspace, me: Me["user"], toast: (t: { text: string; icon?: string }) => void) {
  const owner = ws.role === "owner";
  const team = ws.kind === "team";
  const body = el("div", { class: "ws-settings" }, el("p", { class: "agents-empty" }, "Loading…"));
  const { page } = openModal({ title: ws.name, icon: "sliders", content: [body], id: "agents-page", pageClass: "", boxClass: "agents-box", headClass: "agents-head" });

  const failed = (e: unknown) => toast({ text: e instanceof Error ? e.message : "That didn't work" });

  const render = async () => {
    const [members, invites, log] = await Promise.all([api.members(), owner && team ? api.invites() : Promise.resolve([]), owner ? api.workspaceLog() : Promise.resolve([])]);
    body.replaceChildren(
      ...(owner ? [nameSection(), gameSection()] : []),
      section("Members", el("div", { class: "ws-list" }, ...members.map((m) => memberRow(m)))),
      ...(owner && team ? [section("Invite links", inviteSection(invites))] : []),
      ...(owner && log.length ? [section("Activity", el("ul", { class: "agents-changes ws-log" }, ...log.slice(0, 15).map(logLine)))] : []),
      ...(team ? [leaveSection(members)] : []),
      ...(owner && team ? [deleteSection()] : []),
    );
  };

  const section = (title: string, ...children: HTMLElement[]) => el("section", { class: "ws-section" }, el("h3", {}, title), ...children);

  function nameSection() {
    const input = el("input", { class: "ws-input", value: ws.name, maxlength: "80", "aria-label": "Workspace name" });
    const save = el("button", { type: "button", class: "qw-btn", onclick: async () => {
      const name = input.value.trim();
      if (!name || name === ws.name) return;
      const r = await api.renameWorkspace(name).catch(failed);
      if (!r) return;
      ws.name = r.name;
      page.querySelector(".agents-head h2")!.textContent = r.name;
      document.querySelector(".acct-ws")!.textContent = r.name;
      toast({ icon: "check", text: `Renamed to ${r.name}` });
      await render();
    } }, "Rename");
    input.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
    return section("Name", el("div", { class: "ws-row" }, input, save));
  }

  /** Unlock as you go, for everyone here: the same setting as Settings → Workspace. */
  function gameSection() {
    const box = el("input", { type: "checkbox", id: "ws-gamified", checked: gamified(), onchange: async () => {
      box.disabled = true;
      await setGamified(box.checked).then(
        () => toast({ icon: "check", text: `${box.checked ? "Unlock as you go is on" : "Everything is unlocked"} for everyone here, from their next visit` }),
        failed,
      );
      box.checked = gamified();
      box.disabled = false;
    } });
    return section(
      "Unlock as you go",
      el(
        "label",
        { class: "ws-row", for: "ws-gamified" },
        box,
        el("span", { class: "agents-how" }, "On, the sidebar grows as people use it, inks are earned, tips teach shortcuts and clearing Today gets a small celebration. Off, everyone has everything from the start, with nothing to unlock and no celebrations."),
      ),
    );
  }

  function memberRow(m: WorkspaceMember) {
    const self = m.id === me.id;
    const role = owner
      ? el(
          "select",
          { class: "ws-role", "aria-label": `${m.name}'s role`, onchange: async (e: Event) => {
            const to = (e.target as HTMLSelectElement).value as WorkspaceMember["role"];
            const ok = await api.setRole(m.id, to).catch(failed);
            if (ok) toast({ text: `${m.name} ${ROLE_NOTE[to]} now. Their connected agents were disconnected.` });
            await render();
          } },
          ...(["owner", "editor", "viewer"] as const).map((r) => el("option", { value: r, selected: r === m.role }, r[0].toUpperCase() + r.slice(1))),
        )
      : el("span", { class: "ws-badge" }, m.role);
    const remove =
      owner && !self
        ? el("button", { type: "button", class: "qw-btn danger", title: `Remove ${m.name}`, onclick: async () => {
            const ok = await ask({ title: `Remove ${m.name}?`, body: [`They lose access to ${ws.name} at once, and so do agents they connected to it. Their past changes stay.`], actions: [{ label: "Remove", value: "yes", kind: "danger" }] });
            if (!ok) return;
            // `failed` answers with nothing, so only a removal that happened says so.
            if (await api.removeMember(m.id).then(() => true, failed)) toast({ text: `Removed ${m.name}` });
            await render();
          } }, "Remove")
        : null;
    return el("div", { class: "ws-member" }, el("div", { class: "agents-main" }, el("strong", {}, self ? `${m.name} (you)` : m.name), el("span", { class: "agents-meta" }, `${m.email} · joined ${timeAgo(m.joinedAt)}`)), role, remove);
  }

  function inviteSection(invites: WorkspaceInvite[]) {
    const role = el("select", { class: "ws-role", "aria-label": "New link's role" }, el("option", { value: "editor" }, "Editor"), el("option", { value: "viewer" }, "Viewer"));
    const make = el("button", { type: "button", class: "qw-btn primary", onclick: async () => {
      const r = await api.invite(role.value as "editor" | "viewer").catch(failed);
      if (!r) return;
      if (await copyLink(r.url, { title: "Invite link", note: "It works once, for one person, for 7 days." })) toast({ icon: "link", text: "Invite link copied. It works once, for 7 days." });
      await render();
    } }, icon("link", 14), "Copy a new link");
    const now = Date.now();
    const rows = invites.map((i) => {
      const status = i.usedAt ? `Used by ${i.usedBy ?? "someone who's gone"} ${timeAgo(i.usedAt)}` : i.expiresAt < now ? "Expired" : `Active · expires ${new Date(i.expiresAt).toLocaleDateString()}`;
      const revoke =
        !i.usedAt && i.expiresAt >= now
          ? el("button", { type: "button", class: "qw-btn danger", onclick: async () => {
              if (await api.revokeInvite(i.id).then(() => true, failed)) toast({ text: "Revoked. That link doesn't work any more." });
              await render();
            } }, "Revoke")
          : null;
      return el("div", { class: "ws-member" }, el("div", { class: "agents-main" }, el("strong", {}, `${i.role[0].toUpperCase()}${i.role.slice(1)} link`), el("span", { class: "agents-meta" }, `Made by ${i.createdBy ?? "someone"} ${timeAgo(i.createdAt)} · ${status}`)), revoke);
    });
    return el("div", {}, el("div", { class: "ws-row" }, role, make), el("div", { class: "ws-list" }, ...(rows.length ? rows : [el("p", { class: "agents-empty" }, "No invite links yet.")])));
  }

  function logLine(l: WorkspaceLogEntry) {
    const who = l.actor ?? "Someone";
    const text = {
      rename: `${who} renamed the workspace (${l.detail})`,
      role: `${who} changed ${l.target ?? "someone"}'s role (${l.detail})`,
      remove: `${who} removed ${l.target ?? "someone"}`,
      leave: `${who} left`,
      invite: `${who} made a${l.detail === "editor" ? "n" : ""} ${l.detail} invite link`,
      "revoke-invite": `${who} revoked a${l.detail === "editor" ? "n" : ""} ${l.detail} invite link`,
      settings: `${who} changed the workspace's settings (${l.detail})`,
    }[l.action];
    return el("li", {}, el("span", {}, text), el("span", { class: "agents-when" }, timeAgo(l.at)));
  }

  function leaveSection(members: WorkspaceMember[]) {
    const onlyOwner = owner && members.filter((m) => m.role === "owner").length === 1;
    return section(
      "Leave",
      el("p", { class: "agents-how" }, onlyOwner ? "You're its only owner: make someone else an owner first, or delete the workspace." : `You'll lose access to ${ws.name}, and so will agents you connected to it.`),
      el("button", { type: "button", class: "qw-btn danger", disabled: onlyOwner, onclick: async () => {
        const ok = await ask({ title: `Leave ${ws.name}?`, body: ["You'd need a new invite link to come back."], actions: [{ label: "Leave", value: "yes", kind: "danger" }] });
        if (!ok) return;
        if (await api.leave().catch(failed)) goHome();
      } }, "Leave workspace"),
    );
  }

  function deleteSection() {
    const confirmBox = el("input", { class: "ws-input", placeholder: ws.name, "aria-label": "Type the workspace's name to delete it" });
    const go = el("button", { type: "button", class: "qw-btn danger", disabled: true, onclick: async () => {
      if (await api.deleteWorkspace(confirmBox.value).catch(failed)) goHome();
    } }, "Delete workspace");
    confirmBox.addEventListener("input", () => (go.disabled = confirmBox.value.trim() !== ws.name));
    return section(
      "Delete workspace",
      el("p", { class: "agents-how" }, `This deletes every note and file in ${ws.name} for everyone, disconnects its agents and removes its members. It can't be undone. There's no export yet, so copy out anything you want to keep first. To confirm, type its name.`),
      el("div", { class: "ws-row" }, confirmBox, go),
    );
  }

  await render().catch((e) => body.replaceChildren(el("p", { class: "agents-empty" }, `Couldn't load the settings: ${(e as Error).message}`)));
}
