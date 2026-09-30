// Labels: named versions of a note ("v1", "Sent to Alex") to compare with or go back to.
import { fmtLabels, fmtVersionDiff, fmtWrite } from "../format.ts";
import { command, num, str } from "./types.ts";

const LABEL = "A label: its ID, or its name on the note";

export const labels = [
  command({
    cli: "label",
    mcp: "label_version",
    route: "POST /labels",
    title: "Label a version",
    summary: 'Name the note\'s version ("v1", "Sent to Alex"), now or right after a change, to compare with or go back to later',
    description:
      "Give the note's current version a name (\"v1\", \"Before the rewrite\"), so anyone can compare with it or go back to it later. " +
      "With `at`, label the version right after that change instead (a change ID from recent_changes). Label before a large rewrite. " +
      "Names are unique per note; the label keeps that version's text.",
    examples: ['commonink label Spec "v1"', 'commonink label Spec Sent to Alex --at 42 --description "The copy in the email"'],
    args: {
      path: str({ required: true, pos: 0, label: "note" }),
      name: str({ required: true, pos: "rest", missing: 'Name the version: commonink label <note> "v1"', describe: 'Short, one line: "v1", "Sent to Alex"' }),
      description: str({ describe: "Why this version matters" }),
      at: num({ min: 1, label: "change-id", describe: "A past change to this note: label the version right after it" }),
    },
    run: ({ vault, source }, a) => {
      const m = vault.label(a.path, a.name, source, { description: a.description, at: a.at });
      return { text: `Labeled ${m.path} as "${m.name}" [${m.id}]${m.change_id ? `, after change #${m.change_id}` : ""}.`, data: m };
    },
  }),
  command({
    cli: "labels",
    mcp: "list_labels",
    route: "GET /labels",
    title: "List labels",
    summary: "A note's labels (or every note's), newest first, with their IDs",
    description:
      "A note's labels (named versions like \"v1\" or \"Sent to Alex\", which people and agents label to come back to), or every note's " +
      "when `path` is left out. Newest first, each with its name, ID, who labeled it and when.",
    examples: ["commonink labels Spec", "commonink labels --json"],
    readOnly: true,
    args: { path: str({ pos: 0, label: "note", describe: "A note (path, name or ID); leave out for every note's labels" }) },
    run: ({ vault }, a) => {
      const list = vault.labels(a.path);
      return { text: fmtLabels(list, a.path), data: list };
    },
  }),
  command({
    cli: "label-diff",
    mcp: "diff_versions",
    route: "GET /labels/compare",
    title: "Compare versions",
    summary: "What changed since a label, or between two, as a unified diff (also: diff <note> --from <label>)",
    description: "What changed between a label and the note now, or between two labels of it, as a unified diff.",
    examples: ["commonink label-diff Spec --from v1", "commonink diff Spec --from v1 --to v2"],
    readOnly: true,
    args: {
      path: str({ pos: 0, label: "note", describe: "The note, when `from` or `to` is a name" }),
      from: str({ required: true, label: "label", describe: LABEL }),
      to: str({ label: "label", describe: 'Another label of the same note, or "now" (the default)' }),
    },
    run: ({ vault }, a) => {
      const c = vault.compareLabels(a.from, a.to ?? "now", a.path);
      const text = fmtVersionDiff(c.path, { label: c.from.label.name, text: c.from.text }, { label: c.to.label ? `"${c.to.label.name}"` : "now", text: c.to.text });
      return { text, data: { path: c.path, from: c.from.label, to: c.to.label, diff: text } };
    },
  }),
  command({
    cli: "label-restore",
    mcp: "restore_label",
    route: "POST /labels/restore",
    title: "Restore a label",
    summary: "Put the note back to a label: one change, undoable (also: restore <note> --to <label>)",
    description:
      "Put a note back to a label. It's one change like any other: History shows it, and it can be undone. " +
      "Pass base_version (from read_note) so it fails instead of overwriting edits you haven't seen.",
    examples: ["commonink label-restore Spec --to v1", "commonink restore Spec --to v1"],
    destructive: true,
    args: {
      path: str({ pos: 0, label: "note", describe: "The note, when `label` is a name" }),
      label: str({ required: true, flag: "to", describe: LABEL }),
      base_version: str({ flag: "base", describe: "The note's version as read: refuse if it changed since" }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.restoreLabel(a.label, source, { target: a.path, baseVersion: a.base_version });
      return { text: r.change ? fmtWrite(r, `Restored to "${r.label.name}":`) : `${r.path} is already at "${r.label.name}".`, data: r };
    },
  }),
  command({
    cli: "label-rename",
    mcp: { none: "renaming and taking off labels is for people, in History or the CLI; agents label, compare and restore" },
    route: "POST /labels/rename",
    title: "Rename a label",
    summary: "Give a label a new name (or description)",
    examples: ['commonink label-rename v1 Agreed v1 --note Spec', 'commonink label-rename k3m9x2pq v2 --description "After review"'],
    args: {
      label: str({ required: true, pos: 0, describe: LABEL }),
      name: str({ required: true, pos: "rest", missing: "label-rename needs the new name" }),
      note: str({ describe: "The note, when <label> is a name" }),
      description: str({ nullable: true, describe: "Why this version matters" }),
    },
    run: ({ vault }, a) => {
      const m = vault.renameLabel(a.label, a.name, { target: a.note, description: a.description });
      return { text: `Renamed the label to "${m.name}" [${m.id}]`, data: m };
    },
  }),
  command({
    cli: "label-rm",
    mcp: { none: "renaming and taking off labels is for people, in History or the CLI; agents label, compare and restore" },
    route: "POST /labels/delete",
    title: "Remove a label",
    summary: "Take a name off a version (the note stays as it is)",
    examples: ["commonink label-rm v1 --note Spec"],
    destructive: true,
    args: {
      label: str({ required: true, pos: 0, describe: LABEL }),
      note: str({ describe: "The note, when <label> is a name" }),
    },
    run: ({ vault }, a) => {
      const m = vault.deleteLabel(a.label, a.note);
      return { text: `Deleted the label "${m.name}" from ${m.path ?? "a note in Trash"}; the note is as it was`, data: m };
    },
  }),
];
