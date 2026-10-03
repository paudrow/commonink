// Property types: what each property of the workspace's notes is (text, number, checkbox, date, list,
// people), as the app's properties table shows and changes it. Declared ones live in Config/Settings.md.
import { fmtNoteProperties, fmtProperties, noteProperties, propertiesInUse, setPropertyType, TYPE_CHOICES } from "../properties.ts";
import { SETTINGS_NOTE } from "../schema.ts";
import { command, str } from "./types.ts";

export const properties = [
  command({
    cli: "properties",
    mcp: "list_properties",
    route: "GET /properties",
    title: "List properties",
    summary: "The properties notes have, each with its type (declared, built in or guessed) and how many notes have it",
    description:
      `The front matter properties the workspace's notes have, each with its type and where that comes from: "declared" in ${SETTINGS_NOTE} (properties:), ` +
      `"built in" (one of Common Ink's own, like tags or date), or "guessed" from its values. With a note, that note's properties and their values. ` +
      "Write a property's value to suit its type: a checkbox is true or false, a date YYYY-MM-DD, a list [a, b], people links to contacts.",
    examples: ["commonink properties", "commonink properties 'Weekly sync' --json"],
    readOnly: true,
    args: { note: str({ pos: 0, describe: "Only this note's properties: a path, a [[wikilink]] name or a note ID" }) },
    run: ({ vault }, a) => {
      if (a.note) {
        const r = noteProperties(vault, a.note);
        return { text: fmtNoteProperties(r), data: r };
      }
      const list = propertiesInUse(vault);
      return { text: fmtProperties(list), data: list };
    },
  }),
  command({
    cli: "property type",
    mcp: "set_property_type",
    route: "POST /properties/type",
    title: "Set a property's type",
    summary: "Declare what type a property is, for every note in the workspace (auto: guess it again)",
    description:
      `Declare a property's type for every note in the workspace: text, number, checkbox, date, list or people. It's written to ${SETTINGS_NOTE} ` +
      "(properties:), the same as picking a type in a note's properties table, and changes how the app shows and checks it; notes' values aren't rewritten. " +
      "auto removes the declaration, so its type is guessed from each value again. Common Ink's own properties (tags, date, people, …) keep theirs.",
    examples: ["commonink property type priority number", "commonink property type due date", "commonink property type priority auto"],
    args: {
      name: str({ required: true, pos: 0, describe: "The property's name, as written in front matter" }),
      type: str({ required: true, pos: 1, enum: TYPE_CHOICES, describe: `${TYPE_CHOICES.join(", ")}` }),
    },
    run: ({ vault, source }, a) => {
      const r = setPropertyType(vault, a.name, a.type, source);
      const what = a.type === "auto" ? `${a.name}'s type is guessed from its values now` : `${a.name} is a ${a.type} in every note now`;
      return { text: r ? `${what} (${SETTINGS_NOTE}).` : `Nothing to change: ${what.replace(" now", "")}.`, data: { name: a.name, type: a.type, path: SETTINGS_NOTE, version: r?.version ?? null } };
    },
  }),
];
