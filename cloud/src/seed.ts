// What a brand-new workspace starts with.
import welcome from "../seed/Welcome.md";
import agents from "../seed/AGENTS.md";
import overview from "../seed/Dashboards/Overview.md";
import margin from "../seed/assets/margin.svg";

export const SEED_NOTES: Record<string, string> = {
  "Welcome.md": welcome,
  "AGENTS.md": agents,
  "Dashboards/Overview.md": overview,
};

export const SEED_FILES: Record<string, { text: string; mime: string }> = {
  "assets/margin.svg": { text: margin, mime: "image/svg+xml" },
};
