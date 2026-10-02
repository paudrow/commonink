// A note someone shared: `/s/<token>` for a link (read-only, no sign-in needed) and
// `/shared/<workspace>/<note id>` for a note shared with you by name. One page with no sidebar:
// the note rendered, what it links or embeds only if that's shared too ("No access" otherwise,
// never its title), and for editors an Edit button. Live updates keep it current.
import { ApiError, useWorkspace, whoAmI, type SharedNote } from "./api.ts";
import { el, icon, timeAgo } from "./dom.ts";
import { renderMarkdown, sandboxFrame } from "./render.ts";
import { NOTE_LINKS, noteTarget } from "./noteLinks.ts";

type Where = { link: string } | { workspace: string; note: string };

/** Which shared view this address is, if any. */
export function sharedRoute(path = location.pathname): Where | null {
  const link = path.match(/^\/s\/([a-f0-9]{64})\/?$/);
  if (link) return { link: link[1] };
  const shared = path.match(/^\/shared\/([a-z0-9]+)\/([a-z2-9]{8})\/?$/);
  return shared ? { workspace: shared[1], note: shared[2] } : null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error ?? r.statusText, r.status, data);
  return data as T;
}

/** Widgets read the rest of the workspace, so a shared view shows where they are, not what they'd show. */
const withoutWidgets = (md: string) => md.replace(/^::(\w+)\{[^}\n]*\}\s*$/gm, (_m, kind: string) => `> *A ${kind} widget: it shows only inside the workspace.*`);

export async function mountSharedView(where: Where) {
  document.title = "Shared note · Common Ink";
  document.head.append(el("meta", { name: "robots", content: "noindex, nofollow" }), el("meta", { name: "referrer", content: "no-referrer" }));
  const base = "link" in where ? `/api/s/${where.link}` : `/api/w/${where.workspace}/shared`;
  // Embedded images resolve through the shared routes (render.ts builds their URLs from here).
  useWorkspace(base, "link" in where ? "" : `${base}/live`);
  const who = await whoAmI().catch(() => undefined);
  const me = who?.me ?? null;
  if (!("link" in where) && !me) return location.assign(who?.devLogin ? `/auth/dev?next=${encodeURIComponent(location.pathname)}` : `/auth/google?next=${encodeURIComponent(location.pathname)}`);

  $app().hidden = true;
  const title = el("h1", { class: "sv-title" });
  const badge = el("span", { class: "sv-badge" });
  const actions = el("div", { class: "sv-actions" });
  const body = el("article", { class: "sv-body" });
  const status = el("div", { class: "sv-status", role: "status" });
  const page = el(
    "div",
    { class: "sv" },
    el("header", { class: "sv-head" }, el("a", { class: "sv-brand", href: me ? "/" : "https://commonink.app" }, icon("feed", 16), "Common Ink"), el("span", { class: "spacer" }), actions),
    el("main", { class: "sv-main" }, el("div", { class: "sv-meta" }, badge, status), title, body),
  );
  document.body.append(page);

  let note: SharedNote;
  const show = (id?: string) => call<SharedNote>(`${base}/note?id=${encodeURIComponent(id ?? ("note" in where ? where.note : ""))}`);
  try {
    // A link to a folder has no note of its own: open its first, and list the rest.
    const first = "link" in where ? new URLSearchParams(location.search).get("note") ?? (await call<SharedNote[]>(`${base}/list`))[0]?.id : undefined;
    note = await show(first);
  } catch (e) {
    title.textContent = "This note isn't available";
    body.replaceChildren(el("p", {}, e instanceof ApiError && e.status === 404 ? "The link doesn't work any more, or the note isn't shared with you." : "Couldn't load it. Try again in a moment."));
    return;
  }

  let editing = false;
  const render = () => {
    document.title = `${note.title} · Common Ink`;
    title.textContent = note.title;
    badge.replaceChildren(icon(note.role === "editor" ? "edit" : "open", 13), note.role === "editor" ? "Can edit" : "View only");
    if (editing) return;
    if (note.kind === "html") return body.replaceChildren(sandboxFrame(note.content ?? "", { autoHeight: true, title: note.title }));
    if (note.kind === "asset") return body.replaceChildren(el("p", {}, note.path));
    body.innerHTML = renderMarkdown(withoutWidgets(note.content ?? ""), note.id);
    // The note's own title heading is the page's title already.
    const h1 = body.querySelector("h1");
    if (h1 && h1 === body.firstElementChild && h1.textContent?.trim() === note.title) h1.remove();
    void hydrate(body);
  };

  /** Links and embeds to notes: followable if shared too; otherwise "No access" (embeds) or plain text (links). */
  async function hydrate(root: HTMLElement) {
    for (const img of root.querySelectorAll("img")) img.addEventListener("error", () => img.replaceWith(noAccess()), { once: true });
    for (const a of root.querySelectorAll<HTMLAnchorElement>(NOTE_LINKS)) {
      const target = noteTarget(a.getAttribute("href")!)!.split("#")[0];
      const embed = a.textContent?.startsWith("↳ ");
      const hit = await call<SharedNote | { noAccess: true; busy?: boolean }>(`${base}/resolve?target=${encodeURIComponent(target)}&from=${note.id}`).catch((e) => ({ noAccess: true as const, busy: e instanceof ApiError && e.status === 429 }));
      if ("noAccess" in hit) {
        // Too many requests from this network isn't "not shared": say to come back later.
        const why = hit.busy ? "Couldn't check this link just now. Try again later." : "Not shared with you";
        a.replaceWith(embed ? (hit.busy ? el("div", { class: "sv-noaccess" }, why) : noAccess()) : el("span", { class: "sv-dead", title: why }, a.textContent ?? ""));
        continue;
      }
      a.href = "link" in where ? `/s/${where.link}?note=${hit.id}` : `/shared/${"workspace" in where ? where.workspace : ""}/${hit.id}`;
      if (embed) a.textContent = `↳ ${hit.title}`;
    }
  }
  const noAccess = () => el("div", { class: "sv-noaccess" }, icon("lock", 14), "No access");

  const signIn = () => location.assign(who?.devLogin ? `/auth/dev?next=${encodeURIComponent(location.pathname)}` : `/auth/google?next=${encodeURIComponent(location.pathname)}`);
  const keep = el("button", { type: "button", class: "qw-btn primary", onclick: async () => {
    if (!me) return signIn();
    const r = await call<{ workspace: string; note: string | null }>(`${base}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (r) location.assign(`/shared/${r.workspace}/${r.note ?? note.id}`);
  } }, me ? "Keep in Shared with me" : "Sign in");
  const edit = el("button", { type: "button", class: "qw-btn", onclick: () => startEdit() }, icon("edit", 14), "Edit");
  const yourNotes = el("a", { class: "qw-btn", href: "/" }, "Your notes");
  // While editing: Done saves; if editing was taken away meanwhile, Leave goes back to the note unsaved.
  let done: HTMLElement | null = null;
  const leave = el("button", { type: "button", class: "qw-btn", onclick: async () => {
    editing = false;
    note = await show(note.id).catch(() => note);
    render();
    renderActions();
  } }, "Leave without saving");
  const renderActions = () => {
    if ("link" in where) return actions.replaceChildren(keep);
    const canEdit = note.role === "editor" && note.kind === "md";
    if (editing) return actions.replaceChildren(canEdit && done ? done : leave);
    actions.replaceChildren(...(canEdit ? [edit] : []), ...(me ? [yourNotes] : []));
  };
  renderActions();

  function startEdit() {
    editing = true;
    const box = el("textarea", { class: "sv-editor", spellcheck: "true", "aria-label": `${note.title}, as markdown` }) as HTMLTextAreaElement;
    box.value = note.content ?? "";
    const save = async () => {
      status.textContent = "Saving…";
      const r = await call<{ version: string }>(`${base}/note`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, content: box.value, baseVersion: note.version }) }).catch((e: Error) => e);
      if (r instanceof Error) {
        status.textContent = r instanceof ApiError && r.status === 409 ? "Someone changed it meanwhile. Copy your text, then reload." : `Couldn't save: ${r.message}`;
        return false;
      }
      note = { ...note, content: box.value, version: r.version };
      status.textContent = `Saved ${timeAgo(Date.now())}`;
      return true;
    };
    done = el("button", { type: "button", class: "qw-btn primary", onclick: async () => {
      if (!(await save())) return;
      editing = false;
      render();
      renderActions();
    } }, "Done");
    box.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") (e.preventDefault(), void save());
    });
    renderActions();
    body.replaceChildren(box);
    box.focus();
  }

  render();
  if (!("link" in where)) listen();

  /** The page can't show the note any more: say why, and keep nothing of it on screen. */
  function end(heading: string, why: string, ...more: HTMLElement[]) {
    editing = false;
    document.title = "Shared note · Common Ink";
    title.textContent = heading;
    badge.replaceChildren();
    status.textContent = "";
    body.replaceChildren(el("p", {}, why));
    actions.replaceChildren(...more);
  }

  /**
   * The live connection closed. Sharing changing closes it on purpose (4003), as does signing out
   * (4001); a network blip does too. Ask again what's shared, then listen again, or end the page.
   */
  async function recheck() {
    const now = await show(note.id).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (now instanceof ApiError && now.status === 401) return end("You're signed out", "Sign in again to see this note.", el("button", { type: "button", class: "qw-btn primary", onclick: signIn }, "Sign in"));
    if (now instanceof ApiError && now.status === 404) return end("This note isn't shared with you any more", "Whoever shared it stopped, or the share ran out.", ...(me ? [yourNotes] : []));
    if (now instanceof Error) return void setTimeout(recheck, 3000);
    const was = note.role;
    // While editing, keep the version the edit started from: saving checks against it.
    note = editing ? { ...now, content: note.content, version: note.version } : now;
    if (note.role !== was) status.textContent = note.role === "editor" ? "You can edit this now." : editing ? "You can only view this now, so your changes can't be saved. Copy anything you want to keep." : "You can only view this now.";
    if (editing && note.role !== "editor") body.querySelector<HTMLTextAreaElement>(".sv-editor")!.readOnly = true;
    render();
    renderActions();
    listen();
  }

  /** Someone else changed the note: show it (or, while editing, say so). */
  function listen() {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${base}/live`);
    ws.addEventListener("message", async (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; path?: string; version?: string; content?: string | null; source?: string };
      if (m.type !== "note" || m.path !== note.path || m.version === note.version) return;
      if (editing) return void (status.textContent = `${m.source ?? "Someone"} changed it just now. Save to see if yours still applies.`);
      note = { ...note, content: m.content ?? note.content, version: m.version ?? note.version };
      status.textContent = `Updated by ${m.source ?? "someone"} ${timeAgo(Date.now())}`;
      render();
    });
    ws.addEventListener("close", (e) => void setTimeout(recheck, e.code === 4003 ? 0 : 3000), { once: true });
  }
}

const $app = () => document.querySelector("#app") as HTMLElement;
