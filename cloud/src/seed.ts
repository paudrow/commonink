// What a brand-new workspace starts with.
import start from "../seed/Getting started.md";
import tips from "../seed/Tips.md";
import agents from "../seed/Config/AGENTS.md";
import overview from "../seed/Dashboards/Overview.md";
import margin from "../seed/assets/margin.svg";
import { SETTINGS_NOTE, settingsNote } from "../../src/core/schema.ts";
import { AGENTS_NOTE } from "../../src/core/noteRoles.ts";

export const SEED_NOTES: Record<string, string> = {
  "Getting started.md": start,
  "Tips.md": tips,
  [AGENTS_NOTE]: agents,
  "Dashboards/Overview.md": overview,
  [SETTINGS_NOTE]: settingsNote(),
};

export const SEED_FILES: Record<string, { text: string; mime: string }> = {
  "assets/margin.svg": { text: margin, mime: "image/svg+xml" },
};
