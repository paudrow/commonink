// Ways to organize a vault, for agents to follow: a new workspace picks one, and Settings can change
// it. The pick is the `organizing:` setting in Config/Settings.md (schema.ts), and it writes an
// Organizing section into the agents' instructions (Config/AGENTS.md), between markers, so changing
// it later replaces only that section and leaves the rest of the note as people wrote it.
// No Node imports: the web app uses it too.

export type PresetId = "para" | "zettelkasten" | "journal" | "simple" | "none";

export interface Preset {
  id: PresetId;
  name: string;
  /** One line on what it is, for the picker. */
  summary: string;
  /** The Organizing section's text, for agents. Empty for none. */
  rules: string;
}

export const PRESETS: Preset[] = [
  {
    id: "para",
    name: "PARA",
    summary: "Projects, Areas, Resources, Archive: file by what you're doing with it (Building a Second Brain).",
    rules: [
      "This workspace uses PARA. File each note by how actionable it is:",
      "- `Projects/`: work with a goal and an end (`Projects/Launch site/`). One folder per project.",
      "- `Areas/`: ongoing responsibilities with no end date (`Areas/Health`, `Areas/Team`).",
      "- `Resources/`: topics and reference material worth keeping (`Resources/Typography`).",
      "- `Archive/`: finished projects and inactive areas. Archive a project when it's done instead of deleting it.",
      "When unsure where a note goes, put it in the project it helps most; if none, Resources. Ask before moving many notes.",
    ].join("\n"),
  },
  {
    id: "zettelkasten",
    name: "Zettelkasten",
    summary: "Small linked notes: capture to Inbox, distill into one idea per note, link generously.",
    rules: [
      "This workspace is a Zettelkasten:",
      "- `Inbox/`: quick captures, to be processed. New material lands here first.",
      "- `Notes/`: permanent notes, one idea each, written in the person's words, with a title that states the idea.",
      "- `Sources/`: one note per book, article or talk, with the source's details and what it said.",
      "Link every permanent note to at least one other with `[[...]]`, and say why the link matters. Prefer links over folders and tags.",
    ].join("\n"),
  },
  {
    id: "journal",
    name: "Journal first",
    summary: "The daily note is home: write there, and pull out notes when a topic grows.",
    rules: [
      "This workspace is journal first:",
      "- The day's journal note is the default place for anything new: tasks, meeting notes, ideas, captures.",
      "- `Notes/`: when a topic grows past a few paragraphs or comes up on several days, give it its own note there and link it from the journal.",
      "Don't create folders unless asked. When asked what happened, read the journal notes first.",
    ].join("\n"),
  },
  {
    id: "simple",
    name: "Simple",
    summary: "No folder scheme: a flat list of notes, sorted with tags and links.",
    rules: [
      "This workspace is kept flat:",
      "- Put new notes at the top level. Don't create folders unless asked.",
      "- Group with tags (reuse existing ones from `list_tags`) and with `[[links]]`.",
    ].join("\n"),
  },
  { id: "none", name: "Decide later", summary: "No organizing rules for agents yet. Pick one any time in Settings.", rules: "" },
];

export const presetOf = (id: string | undefined) => PRESETS.find((p) => p.id === id);

const START = "<!-- organizing: written by Settings → Organizing style; edit it freely -->";
const END = "<!-- /organizing -->";
const SECTION = new RegExp(`\\n*${escape(START)}[\\s\\S]*?${escape(END)}\\n?`);

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `agentsMd` with its Organizing section set to `id`'s rules (or removed, for none). The rest stays as it was. */
export function withOrganizing(agentsMd: string, id: PresetId): string {
  const preset = presetOf(id);
  const rest = agentsMd.replace(SECTION, "\n").replace(/\n+$/, "");
  if (!preset?.rules) return rest ? `${rest}\n` : "";
  const section = `${START}\n## Organizing: ${preset.name}\n\n${preset.rules}\n${END}\n`;
  return rest ? `${rest}\n\n${section}` : `# Workspace conventions\n\n${section}`;
}

/** The preset whose section `agentsMd` has, if any. */
export function organizingIn(agentsMd: string): PresetId | null {
  const m = agentsMd.match(SECTION)?.[0].match(/## Organizing: (.+)/);
  return m ? (PRESETS.find((p) => p.name === m[1].trim())?.id ?? null) : null;
}
