// Note templates: notes in Templates/ with {{placeholders}}, and notes made from them.
import { fmtTemplate } from "../format.ts";
import { command, pairs, str } from "./types.ts";

export const templates = [
  command({
    cli: "templates",
    mcp: "list_templates",
    route: "GET /templates",
    title: "List templates",
    summary: "Note templates: notes in Templates/ with {{placeholders}}",
    description:
      "The note templates: notes in Templates/ with {{placeholders}}. {{ask:Label}} is a question to fill in; applies_to says which " +
      "folders' new notes start from it. Use create_from_template to make a note from one.",
    examples: ["quire templates", "quire templates --json"],
    readOnly: true,
    args: {},
    run: ({ quire }) => {
      const list = quire.templates();
      return { text: list.length ? list.map(fmtTemplate).join("\n") : "No templates yet. A template is any note in Templates/.", data: list };
    },
  }),
  command({
    cli: "new",
    mcp: "create_from_template",
    route: "POST /notes/from-template",
    title: "Create a note from a template",
    summary: "A note from a template; --var answers its {{ask:Label}} questions",
    description:
      "Make a new note from a template (a meeting note from Templates/Meeting…), with {{date}}, {{time}} and {{title}} filled in and " +
      "`variables` answering its {{ask:Label}} questions by label. The note goes in the template's folder unless you give one. " +
      "The reply says what's still unfilled, so you can ask the person or fill it in with edit_note.",
    examples: ['quire new --template Meeting --var Client=Acme --var "Attendees=Sam, Lee"', "quire new --template Meeting --title Retro --folder Meetings/Team"],
    args: {
      template: str({ required: true, describe: "Its name (Meeting) or path", label: "name", missing: "new needs --template <name>" }),
      title: str({ describe: "The note's title, if not the template's" }),
      folder: str({ describe: "Where the note goes, if not the template's folder" }),
      variables: pairs({
        flag: "var",
        label: "Label=value",
        describe:
          "Answers to its {{ask:Label}} questions, by label: a people question takes @handles on a task line or names, a date YYYY-MM-DD, a choice one of its options",
      }),
    },
    run: ({ quire, source }, a) => {
      const r = quire.createFromTemplate(a.template, { title: a.title, folder: a.folder, answers: a.variables }, source);
      const from = quire.templates().find((t) => t.name.toLowerCase() === a.template.toLowerCase() || t.path === a.template)?.path ?? a.template;
      const text = quire.files.read(r.path) ?? "";
      const where = (u: string) => `{{${u}}} (line ${text.split("\n").findIndex((l) => l.includes(`{{${u}}}`)) + 1})`;
      return { text: `Created ${r.path} from ${from}.${r.unfilled.length ? ` Still to fill in: ${r.unfilled.map(where).join(", ")}.` : ""}`, data: r };
    },
  }),
];
