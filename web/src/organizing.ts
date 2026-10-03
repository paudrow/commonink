// How the vault is organized, for agents (src/core/presets.ts): a new workspace is asked once, and
// Settings → Workspace → Organizing style changes it. Either way the pick goes in Config/Settings.md
// as `organizing:`, and its rules into the Organizing section of the agents' instructions.
import { api } from "./api.ts";
import { el } from "./dom.ts";
import { store } from "./store.ts";
import { PRESETS, withOrganizing, type PresetId } from "../../src/core/presets.ts";
import { readSettings, SETTINGS_NOTE, settingsNote, withSetting } from "../../src/core/schema.ts";
import { AGENTS_NOTE, ROOT_AGENTS_NOTE } from "../../src/core/noteRoles.ts";

const read = (path: string) => api.note(path).catch(() => null);

/** The workspace's pick, or null if it hasn't made one. */
export async function organizing(): Promise<PresetId | null> {
  const file = await read(SETTINGS_NOTE);
  return (file && readSettings(file.content).organizing) || null;
}

/** Save a pick: the setting, then the agents' rules (in Config/AGENTS.md, or the root AGENTS.md of a vault from before Config/). */
export async function setOrganizing(id: PresetId, gamified: boolean): Promise<void> {
  const file = await read(SETTINGS_NOTE);
  if (file) await api.save(SETTINGS_NOTE, withSetting(file.content, "organizing", id), file.version);
  else await api.create(SETTINGS_NOTE, settingsNote({ gamified, organizing: id }));
  const agents = (await read(AGENTS_NOTE)) ?? (await read(ROOT_AGENTS_NOTE));
  const next = withOrganizing(agents?.content ?? "", id);
  if (agents && next !== agents.content) await api.save(agents.path, next, agents.version);
  else if (!agents && next) await api.create(AGENTS_NOTE, next);
}

/** A workspace with only what it started with: the time to ask how it'll be organized. */
const FRESH = 8;

/**
 * Ask a new workspace, once, how it likes to organize. Not asked if the workspace has more than a
 * handful of notes, already picked, or this browser was asked and closed it without picking.
 */
export async function askOrganizingIfNew(o: { workspace: string; notes: number; canEdit: boolean; gamified: boolean; done(id: PresetId): void }) {
  const key = `organizingAsked.${o.workspace}`;
  if (!o.canEdit || o.notes > FRESH || store.get(key, false) || (await organizing())) return;
  store.set(key, true);
  const id = await pickPreset();
  if (!id) return;
  await setOrganizing(id, o.gamified);
  o.done(id);
}

/** The picker: one button per way to organize, each with a line on what it means. */
function pickPreset(): Promise<PresetId | null> {
  return new Promise((resolve) => {
    const done = (v: PresetId | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    const options = PRESETS.map((p) =>
      el("button", { type: "button", class: "org-option", onclick: () => done(p.id) }, el("strong", {}, p.name), el("span", {}, p.summary)),
    );
    const overlay = el(
      "div",
      { class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && done(null) },
      el(
        "div",
        { class: "ask-box org-box", role: "dialog", "aria-modal": "true", "aria-label": "How do you like to organize?" },
        el("h2", {}, "How do you like to organize?"),
        el("p", {}, "Your agents will file notes this way. It's written into Config/AGENTS.md, where you can change it, and Settings can switch it later."),
        el("div", { class: "org-options" }, ...options),
      ),
    );
    document.body.append(overlay);
    document.addEventListener("keydown", onKey, true);
    options[0].focus();
  });
}
