// The share dialog (online): who a note or folder is shared with outside its workspace, adding
// people by email (members and past recipients suggested), their roles, and general access:
// Restricted, or anyone with the link, which can run out. Workspace viewers see it read-only.
// It's the "Share with people…" entry a Share menu can hold alongside other ways to share. The
// workspace's own people come from the same member list and roles as Workspace settings (#76).
import { api, ApiError, type Share, type ShareList, type ShareTarget, type WorkspaceMember } from "./api.ts";
import { displayName, el, icon } from "./dom.ts";

const EXPIRY: Array<[label: string, days: number | null]> = [
  ["Doesn't expire", null],
  ["For 1 day", 1],
  ["For 7 days", 7],
  ["For 30 days", 30],
];

export async function showShareDialog(
  target: ShareTarget,
  opts: { canShare: boolean; toast(t: { text: string; icon?: string }): void; changed(): void; workspaceSettings(): void },
) {
  document.querySelector("#share-dialog")?.remove();
  const name = "folder" in target ? `the folder ${displayName(target.folder)}` : displayName(target.path);
  const body = el("div", { class: "sh-body" }, el("p", { class: "agents-empty" }, "Loading…"));
  const close = () => (overlay.remove(), document.removeEventListener("keydown", onKey, true));
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const overlay = el(
    "div",
    { id: "share-dialog", class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && close() },
    el(
      "div",
      { class: "ask-box sh-box", role: "dialog", "aria-modal": "true", "aria-label": `Share ${name}` },
      el("div", { class: "agents-head" }, icon("link", 16), el("h2", {}, `Share ${name}`), el("button", { class: "icon-btn small", type: "button", title: "Close", "aria-label": "Close", onclick: close }, icon("close", 15))),
      body,
    ),
  );
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);

  const failed = (e: unknown) => opts.toast({ text: e instanceof ApiError ? e.message : "That didn't work" });
  const members: WorkspaceMember[] = await api.members().catch(() => []);
  // Suggest members, and anyone this workspace has shared with before.
  const past = (await api.shares().catch(() => null))?.shares.filter((s) => s.email).map((s) => ({ name: s.name ?? s.email!, email: s.email! })) ?? [];
  const people = [...new Map([...members, ...past].map((p) => [p.email.toLowerCase(), { name: p.name, email: p.email }])).values()];
  let list: ShareList | null = null;

  const reload = async () => {
    list = await api.shares(target).catch((e) => (failed(e), null));
    render();
    opts.changed();
  };

  const roleSelect = (value: Share["role"], onChange: (r: Share["role"]) => void, label: string) =>
    el(
      "select",
      { class: "ws-role", "aria-label": label, disabled: !opts.canShare, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as Share["role"]) },
      el("option", { value: "viewer", selected: value === "viewer" }, "Viewer"),
      el("option", { value: "editor", selected: value === "editor" }, "Editor"),
    );

  function addRow() {
    const input = el("input", { class: "ws-input", type: "email", placeholder: "Add people by email", list: "sh-people", autocomplete: "off", "aria-label": "Email address" });
    const role = roleSelect("viewer", () => {}, "Their role");
    const add = el("button", { type: "button", class: "qw-btn primary", onclick: async () => {
      const email = input.value.trim();
      if (!email) return input.focus();
      const r = await api.share(target, { email, role: role.value as Share["role"] }).catch(failed);
      if (!r) return;
      const known = people.some((p) => p.email.toLowerCase() === email.toLowerCase());
      opts.toast({ icon: "link", text: known ? `Shared with ${email}` : `Shared with ${email}. They'll see it when they sign in with that address; send them the link.` });
      await reload();
    } }, "Share");
    input.addEventListener("keydown", (e) => e.key === "Enter" && add.click());
    return el("div", { class: "ws-row" }, input, el("datalist", { id: "sh-people" }, ...people.map((p) => el("option", { value: p.email }, p.name))), role, add);
  }

  function personRow(s: Share, inherited: boolean) {
    const who = s.name ? `${s.name}` : (s.email ?? "");
    const meta = [s.name ? s.email : "By email: whoever signs in with this address", s.expiresAt ? `until ${new Date(s.expiresAt).toLocaleDateString()}` : null, inherited && s.folder ? `through the folder ${s.folder}` : null].filter(Boolean).join(" · ");
    const role = inherited ? el("span", { class: "ws-badge" }, s.role) : roleSelect(s.role, (r) => void api.updateShare(s.id, { role: r }).then(reload, failed), `${who}'s role`);
    const remove =
      !inherited && opts.canShare
        ? el("button", { type: "button", class: "icon-btn small", title: `Stop sharing with ${who}`, "aria-label": `Stop sharing with ${who}`, onclick: () => void api.unshare(s.id).then(reload, failed) }, icon("close", 14))
        : null;
    return el("div", { class: "ws-member" }, el("div", { class: "agents-main" }, el("strong", {}, who), el("span", { class: "agents-meta" }, meta)), role, remove);
  }

  function generalAccess(link: Share | undefined) {
    const access = el(
      "select",
      { class: "ws-role", "aria-label": "General access", disabled: !opts.canShare, onchange: async (e: Event) => {
        const on = (e.target as HTMLSelectElement).value === "link";
        const r = on ? await api.share(target, { link: true, role: "viewer" }).catch(failed) : await api.unshare(link!.id).catch(failed);
        if (r) await reload();
      } },
      el("option", { value: "restricted", selected: !link }, "Restricted"),
      el("option", { value: "link", selected: !!link }, "Anyone with the link"),
    );
    const explain = el("span", { class: "agents-meta" }, link ? "Anyone with the link can open it, signed in or not." : "Only the people above (and the workspace's members) can open it.");
    const extra: HTMLElement[] = [];
    if (link) {
      const url = `${location.origin}${link.url}`;
      const expiry = el(
        "select",
        { class: "ws-role", "aria-label": "Link expiry", disabled: !opts.canShare, onchange: (e: Event) => {
          const days = Number((e.target as HTMLSelectElement).value) || null;
          void api.updateShare(link.id, { expiresAt: days ? Date.now() + days * 86_400_000 : null }).then(reload, failed);
        } },
        ...EXPIRY.map(([label, days]) => el("option", { value: String(days ?? ""), selected: !days && !link.expiresAt }, label)),
        ...(link.expiresAt ? [el("option", { value: "", selected: true, disabled: true }, `Until ${new Date(link.expiresAt).toLocaleDateString()}`)] : []),
      );
      extra.push(
        el(
          "div",
          { class: "ws-row" },
          roleSelect(link.role, (r) => void api.updateShare(link.id, { role: r }).then(reload, failed), "Link role"),
          expiry,
          el("button", { type: "button", class: "qw-btn primary", onclick: () => void navigator.clipboard.writeText(url).then(() => opts.toast({ icon: "copy", text: "Link copied" }), () => prompt("The link", url)) }, icon("copy", 14), "Copy link"),
        ),
        el("p", { class: "agents-meta sh-note" }, link.role === "editor" ? "Signed-in people who open it can keep it and edit." : "People who open it can read it; signed in, they can keep it in Shared with me."),
      );
    }
    return el("section", { class: "ws-section" }, el("h3", {}, "General access"), el("div", { class: "ws-row" }, icon(link ? "globe" : "lock", 16), access, explain), ...extra);
  }

  function render() {
    if (!list) return body.replaceChildren(el("p", { class: "agents-empty" }, "Couldn't load who it's shared with."));
    const people = list.shares.filter((s) => s.kind !== "link");
    const link = list.shares.find((s) => s.kind === "link");
    const inherited = list.inherited.filter((s) => s.kind !== "link");
    body.replaceChildren(
      ...(opts.canShare ? [addRow()] : [el("p", { class: "agents-how" }, "You can see who this is shared with. Editors and owners change it.")]),
      el(
        "section",
        { class: "ws-section" },
        el("h3", {}, "People with access"),
        el("div", { class: "ws-list" }, ...people.map((s) => personRow(s, false)), ...inherited.map((s) => personRow(s, true))),
        el(
          "div",
          { class: "ws-member sh-members" },
          el("div", { class: "agents-main" }, el("strong", {}, `Everyone in this workspace (${members.length})`), el("span", { class: "agents-meta" }, members.map((m) => `${m.name} (${m.role})`).join(", "))),
          el("button", { type: "button", class: "qw-btn", onclick: () => (close(), opts.workspaceSettings()) }, "Members…"),
        ),
      ),
      generalAccess(link),
    );
  }

  await reload();
  body.querySelector<HTMLInputElement>("input")?.focus();
}
