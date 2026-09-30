// Contacts: people are notes in People/ with their details in frontmatter (src/core/contacts.ts).
import { VaultError } from "../paths.ts";
import { fmtContact, fmtContactLine } from "../format.ts";
import { matchContacts } from "../contacts.ts";
import { command, list, localFiles, str } from "./types.ts";

const WHO = "Their name or their note's path";

/** A contact's details, as create_contact and update_contact take them. */
const FIELDS = {
  email: list({ label: "a,b", describe: "Email addresses" }),
  phone: list({ label: "p,q", describe: "Phone numbers" }),
  company: str(),
  role: str(),
  links: list({ flag: "link", label: "url,…", describe: "URLs: a profile, a site, a repo" }),
  aliases: list({ flag: "alias", label: "a,b", describe: "Other names they go by" }),
  tags: list({ flag: "tag", label: "t,u", describe: "Tags, without #" }),
};

/** Only the fields given: the rest stay as they are. */
const given = <T extends object>(fields: T) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;

const imported = (r: { created: string[]; updated: string[]; unchanged: string[] }) => {
  const line = (label: string, paths: string[]) => (paths.length ? [`${label} ${paths.length}: ${paths.join(", ")}`] : []);
  return [...line("Created", r.created), ...line("Updated", r.updated), ...line("Unchanged", r.unchanged)].join("\n") || "No contacts in that file.";
};

export const contacts = [
  command({
    cli: "contacts",
    mcp: "list_contacts",
    route: "GET /contacts",
    title: "List contacts",
    summary: "People: notes in People/ with email, phone, company, role, links, aliases and tags, and when each was last mentioned",
    description:
      "The people in the vault: each is a note in People/ whose frontmatter has email, phone, company, role, links, aliases and tags. " +
      "Shows when each was last mentioned in another note. Link to a person with [[People/Name]].",
    examples: ["commonink contacts", "commonink contacts --company acme --tag client", "commonink contacts --q priya --json"],
    readOnly: true,
    args: {
      q: str({ label: "words", describe: "Words in their name, an alias, email or company" }),
      tag: str(),
      company: str(),
    },
    run: ({ vault }, a) => {
      const hits = matchContacts(vault.contacts(), a);
      return { text: hits.length ? hits.map(fmtContactLine).join("\n") : "No contacts match. People are notes in People/; `commonink contact add <name>` makes one.", data: hits };
    },
  }),
  command({
    cli: "contact",
    mcp: "read_contact",
    route: "GET /contact",
    title: "Read a contact",
    summary: "One person: how to reach them, and the notes that mention them",
    description: "One person: how to reach them, and the notes that mention them, newest first. read_note shows their note's own words.",
    examples: ['commonink contact "Jane Doe"', "commonink contact Jane Doe --json"],
    readOnly: true,
    args: { contact: str({ required: true, pos: "rest", label: "name", describe: WHO }) },
    run: ({ vault }, a) => {
      const c = vault.contact(a.contact);
      return { text: fmtContact(c), data: c };
    },
  }),
  command({
    cli: "contact add",
    mcp: "create_contact",
    route: "POST /contacts",
    title: "Create a contact",
    summary: "Add a person: People/<name>.md with their details",
    description: "Add a person: a note People/<name>.md with their details in its frontmatter, and `notes` under their name.",
    examples: ["commonink contact add Jane Doe --email jane@acme.com --company Acme --tag client"],
    args: {
      name: str({ required: true, pos: "rest" }),
      ...FIELDS,
      notes: str({ describe: "What goes under their name in the note" }),
    },
    run: ({ vault, source }, { name, ...rest }) => {
      const r = vault.createContact({ ...given(rest), name }, source);
      return { text: `Created ${r.path}. Link to them with [[${r.path.replace(/\.md$/, "")}]].`, data: { path: r.path } };
    },
  }),
  command({
    cli: "contact update",
    mcp: "update_contact",
    route: "POST /contacts/update",
    title: "Update a contact",
    summary: "Change a person's details; a list replaces that list (also: contact <name> --role …)",
    description: "Change a person's details. Each field given replaces what's there (send the whole list to add to one); the rest stay.",
    examples: ["commonink contact update Jane Doe --role CTO", "commonink contact Jane Doe --phone 555-0100,555-0199"],
    args: { contact: str({ required: true, pos: "rest", label: "name", describe: WHO }), ...FIELDS },
    run: ({ vault, source }, { contact, ...patch }) => {
      const r = vault.updateContact(contact, given(patch), source);
      return { text: r.change ? `Updated ${r.path} → version ${r.version}` : `${r.path} already says that`, data: { path: r.path, version: r.version } };
    },
  }),
  command({
    cli: "contacts merge",
    mcp: "merge_contacts",
    route: "POST /contacts/merge",
    title: "Merge contacts",
    summary: "One person with two notes: <drop>'s details and links move to <keep>, and <drop> goes to Trash",
    description:
      "Two notes for one person: `keep` gains what `drop` has that it doesn't (emails, phones, links, tags, its name as an alias, and its " +
      "notes under a heading), links to `drop` are pointed at `keep`, and `drop` goes to Trash.",
    examples: ['commonink contacts merge "Jane Doe" "J. Doe"'],
    destructive: true,
    args: {
      keep: str({ required: true, pos: 0, describe: WHO }),
      drop: str({ required: true, pos: 1, describe: WHO }),
    },
    run: ({ vault, source }, a) => {
      const r = vault.mergeContacts(a.keep, a.drop, source);
      return {
        text: `Merged ${r.trashed[0].path} into ${r.path} (it's in Trash). Links updated in ${r.updated.length} note${r.updated.length === 1 ? "" : "s"}.`,
        data: { path: r.path, updated: r.updated, trashed: r.trashed.map((t) => t.path) },
      };
    },
  }),
  command({
    cli: "contacts import",
    mcp: "import_contacts",
    route: "POST /contacts/import",
    title: "Import contacts",
    summary: "Add people from a vCard or CSV export; ones already here (same email or name) get what's new",
    description:
      "Contacts from a vCard (.vcf) or CSV export (Google, Outlook, Apple or your own columns: Name or First/Last Name, Email, Phone, " +
      "Company, Title, Tags…). Someone already here (same email or name) gains what's new; everyone else becomes a contact.",
    examples: ["commonink contacts import contacts.vcf", "commonink contacts import export.txt --format csv"],
    args: {
      file: localFiles({ required: true, pos: 0, describe: "A .vcf or .csv file on this computer" }),
      text: str({ required: true, only: "mcp", describe: "The file's text" }),
      format: str({ enum: ["vcard", "csv"], mcpRequired: true, describe: "vcard or csv (on the CLI, from the file's name when left out)" }),
    },
    run: ({ vault, source }, a) => {
      const file = a.file?.[0];
      const format = a.format ?? (file && /\.vcf$/i.test(file.name) ? "vcard" : file && /\.csv$/i.test(file.name) ? "csv" : undefined);
      if (format !== "vcard" && format !== "csv") throw new VaultError("Say --format vcard or csv: the file's name doesn't tell");
      const text = a.text ?? new TextDecoder().decode(file?.bytes);
      const r = vault.importContacts(text, format, source);
      return { text: imported(r), data: r };
    },
  }),
];
