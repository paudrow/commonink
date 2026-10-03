// Contacts: people are notes in People/ with their details in frontmatter (src/core/contacts.ts).
import { VaultError } from "../paths.ts";
import { fmtContact, fmtContactLine } from "../format.ts";
import { matchContacts } from "../contacts.ts";
import { fmtSync, type GoogleContactsSync } from "../googleContacts.ts";
import { bool, command, list, localFiles, str, type CommandHost } from "./types.ts";

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
  check_in: str({ flag: "check-in", label: "rhythm", describe: 'How often to be in touch: weekly, every 2 weeks, monthly, 3m, yearly ("" for none)' }),
};

/** The fields as a contact has them (check_in is checkIn). */
const fieldsOf = <T extends { check_in?: string }>({ check_in, ...rest }: T) => given({ ...rest, checkIn: check_in });

/** Only the fields given: the rest stay as they are. */
const given = <T extends object>(fields: T) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;

const imported = (r: { created: string[]; updated: string[]; unchanged: string[] }) => {
  const line = (label: string, paths: string[]) => (paths.length ? [`${label} ${paths.length}: ${paths.join(", ")}`] : []);
  return [...line("Created", r.created), ...line("Updated", r.updated), ...line("Unchanged", r.unchanged)].join("\n") || "No contacts in that file.";
};

const googleOf = (h: CommandHost): GoogleContactsSync => {
  if (!h.googleContacts) throw new VaultError("Google Contacts is only in hosted workspaces where Google is set up");
  return h.googleContacts;
};

export const contacts = [
  command({
    cli: "contacts",
    mcp: "list_contacts",
    route: "GET /contacts",
    title: "List contacts",
    summary: "People: notes in People/ with email, phone, company, role, links, aliases and tags, when each was last mentioned, and who's due a check-in",
    description:
      "The people in the workspace: each is a note in People/ whose frontmatter has email, phone, company, role, links, aliases, tags and " +
      "check_in (how often to be in touch). Shows when each was last mentioned in another note, and when a check-in is next due " +
      "(that long after the last mention). check_in_due lists only the people due a check-in by today, the longest overdue first. " +
      "Link to a person with [[People/Name]].",
    examples: ["commonink contacts", "commonink contacts --company acme --tag client", "commonink contacts --q priya --json", "commonink contacts --check-in-due"],
    readOnly: true,
    args: {
      q: str({ label: "words", describe: "Words in their name, an alias, email or company" }),
      tag: str(),
      company: str(),
      check_in_due: bool({ flag: "check-in-due", describe: "Only people due a check-in by today, the longest overdue first" }),
      today: str({ flag: "date", describe: "The day to count from, YYYY-MM-DD; default the user's today" }),
    },
    run: ({ vault }, a) => {
      const all = vault.contacts(a.today);
      const today = a.today ?? vault.day();
      let hits = matchContacts(all, a);
      if (a.check_in_due) hits = hits.filter((c) => c.checkInDue && c.checkInDue <= today).sort((x, y) => x.checkInDue!.localeCompare(y.checkInDue!));
      if (a.check_in_due && !hits.length) return { text: "No one is due a check-in. Give a contact a rhythm with update_contact check_in (CLI: --check-in monthly).", data: hits };
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
      const r = vault.createContact({ ...fieldsOf(rest), name }, source);
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
    examples: ["commonink contact update Jane Doe --role CTO", "commonink contact Jane Doe --phone 555-0100,555-0199", 'commonink contact update Jane Doe --check-in "every 2 weeks"'],
    args: { contact: str({ required: true, pos: "rest", label: "name", describe: WHO }), ...FIELDS },
    run: ({ vault, source }, { contact, ...patch }) => {
      const r = vault.updateContact(contact, fieldsOf(patch), source);
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
  command({
    cli: "contacts google",
    mcp: "google_contacts_status",
    route: "GET /contacts/google",
    title: "Google Contacts status",
    summary: "Whether your Google Contacts are connected here, may be edited, and when they last synced",
    description:
      "Your Google Contacts in this workspace: the Google account, whether Common Ink may edit your contacts (else edits here stay here), " +
      "how many notes in People/ are linked to a contact (their `google:` frontmatter), and when they last synced. Connecting is in the app.",
    examples: ["commonink contacts google", "commonink contacts google --json"],
    readOnly: true,
    needs: "googleContacts",
    args: {},
    run: async (h) => {
      const s = await googleOf(h).status();
      const when = s.lastSync ? new Date(s.lastSync).toISOString().replace(/\.\d+Z$/, "Z") : "never";
      const text = s.connection
        ? `Google Contacts: ${s.connection.account}${s.connection.canWrite ? " (edits here go to Google)" : " (read only: edits here stay here)"}. ${s.linked} linked, last synced ${when}.`
        : "Google Contacts isn't connected. Connect it from the Contacts page in the app.";
      return { text, data: s };
    },
  }),
  command({
    cli: "contacts sync",
    mcp: "sync_google_contacts",
    route: "POST /contacts/google/sync",
    title: "Sync Google Contacts",
    summary: "Bring your Google Contacts into People/, and send edits made here back (when allowed)",
    description:
      "Google Contacts is the truth for how to reach someone: each contact's emails, phones, company, role, links and nicknames go into " +
      "its note in People/ (made if it's new; someone already here with the same email or name is linked, with `google:` in the frontmatter). " +
      "A note's words and tags are never sent to Google. Edits made here to those fields go back to Google when the person allowed editing; " +
      "a field changed on both sides takes Google's value (the note's History keeps the old one). A contact deleted in Google keeps its note.",
    examples: ["commonink contacts sync", "commonink contacts sync --json"],
    needs: "googleContacts",
    args: {},
    run: async (h) => {
      const r = await googleOf(h).sync(h.source);
      return { text: fmtSync(r), data: r };
    },
  }),
];
