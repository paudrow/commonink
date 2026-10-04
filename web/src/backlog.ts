// The Backlog's settings: how long a task sits idle before it goes there on its own
// (`auto_backlog_days:` in Config/Settings.md; 0 is never), and the tag that keeps one out
// (`backlog_exempt_tag:`). The moving itself is the core's (Vault.autoBacklog); a task there carries
// `backlog:` on its line (src/core/tasks.ts).
import { api } from "./api.ts";
import { AUTO_BACKLOG_MAX, backlogSettings, SETTINGS_NOTE, settingsNote, withSetting, type WorkspaceSettings } from "../../src/core/schema.ts";
import { cleanTag } from "../../src/core/tags.ts";

export interface BacklogSettings {
  days: number;
  tag: string;
}

/** What the workspace's settings say, or the defaults where they say nothing. */
export async function loadBacklog(): Promise<BacklogSettings> {
  const file = await api.note(SETTINGS_NOTE).catch(() => null);
  return backlogSettings(file?.content ?? null);
}

/** The days typed into Settings, or null if that isn't a count of days ("" and "off" are 0: never). */
export function daysFrom(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s*days?$/, "");
  if (t === "" || t === "off" || t === "never") return 0;
  return /^\d{1,4}$/.test(t) && Number(t) <= AUTO_BACKLOG_MAX ? Number(t) : null;
}

/** The tag typed into Settings, without its #, or null if it isn't one. */
export const tagFrom = (text: string): string | null => cleanTag(text.trim().replace(/^#/, ""));

/** Save one of them into Config/Settings.md (made if there's none), keeping the rest of it. */
export async function saveBacklog<K extends "auto_backlog_days" | "backlog_exempt_tag">(key: K, value: NonNullable<WorkspaceSettings[K]>, gamified: boolean): Promise<void> {
  const file = await api.note(SETTINGS_NOTE).catch(() => null);
  if (file) await api.save(SETTINGS_NOTE, withSetting(file.content, key, value), file.version);
  else await api.create(SETTINGS_NOTE, settingsNote({ gamified, [key]: value }));
}
