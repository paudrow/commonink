// Google Contacts as the ground truth for People/ (#22). A person's Google contact owns how to reach
// them: emails, phones, company, role, links and nicknames (aliases). Their note owns everything
// else: its words, its tags, any other frontmatter. A synced note says which contact it is:
//
//   ---
//   email: jane@acme.com
//   company: Acme
//   google: people/c1234567890
//   ---
//   # Jane Doe
//   What we talked about…              ← never sent to Google
//
// Syncing is a three-way merge per field against what both sides last agreed on (kept per person in
// `google_contacts`): a field only one side changed takes that side's change, and a field both changed
// takes Google's (the overwritten value stays in the note's History). A list merges item by item, so
// an email added here and a phone added in Google both survive. Edits made here go back to Google only
// when the person allowed writing (the `contacts` scope); otherwise they stay here and are kept.
// A contact deleted in Google keeps its note, without the `google:` line. No I/O but the database and
// the vault: the host hands in Google (PeopleApi), the real API or a stand-in.
import { contactFromNote, contactNote, emptyContact, samePerson, type ContactFields, type ContactNote } from "./contacts.ts";
import { frontmatterEntries, frontmatterText, scalarOf } from "./frontmatter.ts";
import { VaultError } from "./paths.ts";
import type { SqlDb } from "./store.ts";
import type { Vault } from "./vault.ts";

/** The frontmatter key that links a note to its Google contact. */
export const GOOGLE_KEY = "google";

// ---------------------------------------------------------------- Google's side

/** The parts of a People API person we read and write (https://developers.google.com/people/api/rest/v1/people). */
export interface GooglePerson {
  resourceName: string;
  etag?: string;
  metadata?: { deleted?: boolean };
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string; unstructuredName?: string }>;
  emailAddresses?: Array<{ value?: string; type?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string; department?: string }>;
  urls?: Array<{ value?: string; type?: string }>;
  nicknames?: Array<{ value?: string }>;
  biographies?: Array<{ value?: string; contentType?: string }>;
}

/** The person fields a sync asks Google for. */
export const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,urls,nicknames,biographies,metadata";
/** The fields a push may change: never names (a note's name is its file) or biographies (notes stay here). */
export const UPDATE_FIELDS = "emailAddresses,phoneNumbers,organizations,urls,nicknames";

/** What syncing needs from Google: the People API (cloud/src/google-people.ts) or a stand-in. */
export interface PeopleApi {
  /**
   * The person's contacts changed since `syncToken` (all of them without one, and then `full` is
   * true), and the token for next time. Deleted contacts come back with metadata.deleted. An
   * expired token throws a PeopleError with status 410: start again without one.
   */
  changes(syncToken: string | null): Promise<{ people: GooglePerson[]; syncToken: string; full: boolean }>;
  /** Change `fields` (UPDATE_FIELDS) of a contact last seen at `person.etag`. A 409 means it changed since. */
  update(person: GooglePerson, fields: string): Promise<GooglePerson>;
}

export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Who's syncing: their Google account, and whether they let Common Ink edit their contacts. */
export interface ContactsConnection {
  account: string;
  canWrite: boolean;
}

// ---------------------------------------------------------------- fields

/** The fields Google owns. */
export const SYNCED = ["email", "phone", "company", "role", "links", "aliases"] as const;
type Synced = Pick<ContactFields, (typeof SYNCED)[number]>;
const LIST_FIELDS = ["email", "phone", "links", "aliases"] as const;
type ListKey = (typeof LIST_FIELDS)[number];
type ScalarKey = "company" | "role";

const clean = (xs: Array<{ value?: string } | undefined> | undefined) => (xs ?? []).map((x) => x?.value?.trim() ?? "").filter((v, i, all) => v && all.indexOf(v) === i);

/** A person's name as a note's: Google's display name, else one from their email or company. */
export function nameOf(p: GooglePerson): string {
  const n = p.names?.[0];
  const raw = n?.displayName || n?.unstructuredName || [n?.givenName, n?.familyName].filter(Boolean).join(" ") || p.emailAddresses?.[0]?.value || p.organizations?.[0]?.name || "";
  // A note's name can't hold / or \ or start with a dot.
  return raw.replace(/[/\\\x00-\x1f]+/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
}

/** The fields Google owns, as Google has them. */
export function syncedOf(p: GooglePerson): Synced {
  const org = p.organizations?.[0];
  return {
    email: clean(p.emailAddresses),
    phone: clean(p.phoneNumbers),
    company: org?.name?.trim() ?? "",
    role: org?.title?.trim() ?? "",
    links: clean(p.urls),
    aliases: clean(p.nicknames),
  };
}

const pick = (c: ContactFields): Synced => ({ email: c.email, phone: c.phone, company: c.company, role: c.role, links: c.links, aliases: c.aliases });

/**
 * `p` with the given fields written in. An entry whose value stays keeps what Google knew about it
 * (its type: "work", "mobile"…), so a push changes only what changed.
 */
export function withSynced(p: GooglePerson, f: Synced): GooglePerson {
  const keep = <T extends { value?: string }>(had: T[] | undefined, values: string[]): T[] =>
    values.map((v) => had?.find((h) => h.value?.trim().toLowerCase() === v.toLowerCase()) ?? ({ value: v } as T));
  const org = { ...(p.organizations?.[0] ?? {}), name: f.company || undefined, title: f.role || undefined };
  return {
    ...p,
    emailAddresses: keep(p.emailAddresses, f.email),
    phoneNumbers: keep(p.phoneNumbers, f.phone),
    organizations: org.name || org.title || org.department ? [org, ...(p.organizations ?? []).slice(1)] : (p.organizations ?? []).slice(1),
    urls: keep(p.urls, f.links),
    nicknames: keep(p.nicknames, f.aliases),
  };
}

// ---------------------------------------------------------------- merging

const key = (field: ListKey, v: string) => (field === "phone" ? v.replace(/[^\d+]/g, "") : v.trim().toLowerCase());
const has = (field: ListKey, xs: string[], v: string) => xs.some((x) => key(field, x) === key(field, v));
const sameList = (field: ListKey, a: string[], b: string[]) => a.length === b.length && a.every((x, i) => key(field, x) === key(field, b[i]));

/** A field both sides changed, differently: Google's value won. */
export interface Conflict {
  field: ScalarKey;
  note: string;
  google: string;
}

/**
 * The merge of one person's fields: `base` (what both last agreed on; null the first time they're
 * linked), the note's and Google's. Lists merge item by item: Google's, plus what the note added,
 * less what the note removed. A scalar one side changed takes that change; both, Google's.
 */
export function mergeSynced(base: Synced | null, note: Synced, google: Synced): { merged: Synced; conflicts: Conflict[] } {
  const b = base ?? { email: [], phone: [], company: "", role: "", links: [], aliases: [] };
  const merged = { ...google };
  const conflicts: Conflict[] = [];
  for (const f of LIST_FIELDS) {
    const added = note[f].filter((v) => !has(f, b[f], v) && !has(f, google[f], v));
    const removed = b[f].filter((v) => !has(f, note[f], v));
    merged[f] = [...google[f].filter((v) => !has(f, removed, v)), ...added];
  }
  for (const f of ["company", "role"] as const) {
    const n = note[f].trim();
    const g = google[f].trim();
    if (n === g || n === b[f].trim()) merged[f] = g; // agreed, or only Google changed
    else if (g === b[f].trim()) merged[f] = n; // only the note changed (or, linking, Google has none)
    else if (n) conflicts.push({ field: f, note: n, google: g }); // both changed: Google is the truth
  }
  return { merged, conflicts };
}

export const sameSynced = (a: Synced, b: Synced) =>
  LIST_FIELDS.every((f) => sameList(f, a[f], b[f])) && a.company.trim() === b.company.trim() && a.role.trim() === b.role.trim();

// ---------------------------------------------------------------- a note's link

/** The Google contact a note is linked to (`google: people/c…`), or null. */
export function linkOf(md: string): string | null {
  const v = scalarOf(frontmatterEntries(md).entries.find((e) => e.key === GOOGLE_KEY));
  return /^people\/[\w-]+$/.test(v) ? v : null;
}

/** `md` linked to `resource` (or unlinked, with null). The rest of the note stays as it is. */
export function withLink(md: string, resource: string | null): string {
  const { entries, body } = frontmatterEntries(md);
  const out = entries.filter((e) => e.key !== GOOGLE_KEY);
  if (resource) out.push({ key: GOOGLE_KEY, lines: [`${GOOGLE_KEY}: ${resource}`] });
  return frontmatterText(out) + body;
}

/** A contact's page on Google Contacts. */
export const googleUrl = (resource: string) => `https://contacts.google.com/person/${resource.replace(/^people\//, "")}`;

// ---------------------------------------------------------------- syncing

export interface SyncResult {
  account: string;
  /** Notes made for contacts that weren't here. */
  created: string[];
  /** Notes Google's changes reached. */
  updated: string[];
  /** Notes newly linked to a contact (the same email or name). */
  linked: string[];
  /** Notes whose contact was deleted in Google: they stay, unlinked. */
  unlinked: string[];
  /** Contacts whose edits here went to Google. */
  pushed: string[];
  /** Notes with edits here that stay here, because writing to Google isn't allowed (or Google refused). */
  kept: string[];
  /** Fields both sides changed: Google's value is in the note now, the note's is in its History. */
  conflicts: Array<Conflict & { path: string }>;
  /** Contacts with nothing to name a note by. */
  skipped: number;
  /** Whether Google listed everything (the first sync, or after its token expired). */
  full: boolean;
}

export interface SyncStatus {
  connection: ContactsConnection | null;
  /** When this person last synced this workspace, or null. */
  lastSync: number | null;
  /** How many notes are linked to their contacts. */
  linked: number;
}

interface Row {
  resource: string;
  /** The contact as Google last sent it (with its etag), for pushing an edit made here when Google hasn't changed. */
  person: string;
  path: string;
  /** What both sides last agreed on. */
  base: string;
}

/**
 * One person's Google Contacts in one workspace. The host makes it per request with their
 * connection and Google; what both sides last agreed on lives in the workspace's database.
 */
export class GoogleContactsSync {
  constructor(
    private db: SqlDb,
    private vault: Vault,
    private owner: string,
    private connection: () => Promise<ContactsConnection | null>,
    private api: () => PeopleApi,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS google_contacts(owner TEXT NOT NULL, resource TEXT NOT NULL, person TEXT NOT NULL, path TEXT NOT NULL, base TEXT NOT NULL, PRIMARY KEY(owner, resource))`);
    db.exec(`CREATE TABLE IF NOT EXISTS google_contacts_state(owner TEXT PRIMARY KEY, sync_token TEXT, synced_at INTEGER)`);
  }

  async status(): Promise<SyncStatus> {
    const state = this.db.get<{ synced_at: number | null }>("SELECT synced_at FROM google_contacts_state WHERE owner = ?", this.owner);
    const linked = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM google_contacts WHERE owner = ?", this.owner)?.n ?? 0;
    return { connection: await this.connection(), lastSync: state?.synced_at ?? null, linked };
  }

  /** Forget what was synced (they disconnected): notes keep their details and their `google:` lines. */
  forget() {
    this.db.run("DELETE FROM google_contacts WHERE owner = ?", this.owner);
    this.db.run("DELETE FROM google_contacts_state WHERE owner = ?", this.owner);
  }

  async sync(source: string): Promise<SyncResult> {
    const conn = await this.connection();
    if (!conn) throw new VaultError("Google Contacts isn't connected: connect it from the Contacts page");
    const api = this.api();
    const token = this.db.get<{ sync_token: string | null }>("SELECT sync_token FROM google_contacts_state WHERE owner = ?", this.owner)?.sync_token ?? null;
    let got: Awaited<ReturnType<PeopleApi["changes"]>>;
    try {
      got = await api.changes(token);
    } catch (e) {
      if (!(e instanceof PeopleError && e.status === 410)) throw asVaultError(e);
      got = await api.changes(null).catch((e2) => Promise.reject(asVaultError(e2)));
    }

    const r: SyncResult = { account: conn.account, created: [], updated: [], linked: [], unlinked: [], pushed: [], kept: [], conflicts: [], skipped: 0, full: got.full };
    const rows = new Map(this.db.all<Row>("SELECT resource, person, path, base FROM google_contacts WHERE owner = ?", this.owner).map((x) => [x.resource, x]));
    const notes = this.vault.contacts().map((c) => ({ ...c, link: linkOf(this.vault.files.read(c.path) ?? "") }));
    const claimed = new Set(notes.flatMap((n) => (n.link ? [n.path] : [])));
    const seen = new Set<string>();

    for (const person of got.people) {
      seen.add(person.resourceName);
      const row = rows.get(person.resourceName);
      const note = notes.find((n) => n.link === person.resourceName) ?? (row ? notes.find((n) => n.path === row.path) : undefined);
      if (person.metadata?.deleted) {
        if (note) this.unlink(note.path, source, r);
        this.db.run("DELETE FROM google_contacts WHERE owner = ? AND resource = ?", this.owner, person.resourceName);
        continue;
      }
      const google = syncedOf(person);
      // Not linked yet: someone here with an email or a name in common, else a new note.
      const target = note ?? notes.find((n) => !claimed.has(n.path) && samePerson(n, { ...emptyContact(nameOf(person)), ...google }));
      if (!target) {
        const name = nameOf(person);
        if (!name) {
          r.skipped++;
          continue;
        }
        const path = this.create(name, google, person, source);
        if (!path) {
          r.skipped++;
          continue;
        }
        r.created.push(path);
        claimed.add(path);
        this.remember(person, path, google);
        continue;
      }
      claimed.add(target.path);
      await this.reconcile(api, conn, person, target, row ? (JSON.parse(row.base) as Synced) : null, source, r);
    }

    // Only what changed in Google came back: notes edited here whose contact didn't change go to Google too.
    if (!got.full) {
      for (const row of rows.values()) {
        const note = seen.has(row.resource) ? undefined : notes.find((n) => n.link === row.resource);
        const base = JSON.parse(row.base) as Synced;
        if (note && !sameSynced(pick(note), base)) await this.reconcile(api, conn, JSON.parse(row.person) as GooglePerson, note, base, source, r);
      }
    }

    // Listing everything: a contact we knew that isn't there any more was deleted.
    if (got.full) {
      for (const row of rows.values()) {
        if (seen.has(row.resource)) continue;
        const note = notes.find((n) => n.link === row.resource) ?? notes.find((n) => n.path === row.path);
        if (note) this.unlink(note.path, source, r);
        this.db.run("DELETE FROM google_contacts WHERE owner = ? AND resource = ?", this.owner, row.resource);
      }
    }
    this.db.run(
      "INSERT INTO google_contacts_state(owner, sync_token, synced_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET sync_token = excluded.sync_token, synced_at = excluded.synced_at",
      this.owner, got.syncToken, Date.now(),
    );
    return r;
  }

  /** Bring one linked (or newly matched) note and its contact together. */
  private async reconcile(api: PeopleApi, conn: ContactsConnection, person: GooglePerson, note: ContactNote & { link: string | null }, base: Synced | null, source: string, r: SyncResult) {
    const google = syncedOf(person);
    const mine = pick(note);
    const { merged, conflicts } = mergeSynced(base, mine, google);
    r.conflicts.push(...conflicts.map((c) => ({ ...c, path: note.path })));

    const before = this.vault.files.read(note.path) ?? "";
    let after = before;
    if (!sameSynced(merged, mine)) after = contactNote({ ...contactFromNote(note.path, before), ...merged }, before);
    if (note.link !== person.resourceName) after = withLink(after, person.resourceName);
    if (after !== before) {
      this.vault.save(note.path, after, { source, baseVersion: this.vault.meta(note.path)?.version });
      if (note.link !== person.resourceName) r.linked.push(note.path);
      else r.updated.push(note.path);
    }

    // What both now agree on: Google's, after a push, or as Google has it (edits not sent stay in the note).
    let agreed = google;
    let latest = person;
    if (!sameSynced(merged, google)) {
      if (!conn.canWrite) r.kept.push(note.path);
      else {
        try {
          const updated = await api.update(withSynced(person, merged), UPDATE_FIELDS);
          agreed = syncedOf(updated);
          latest = updated;
          r.pushed.push(note.path);
        } catch (e) {
          if (e instanceof PeopleError && (e.status === 409 || e.status === 400 || e.status === 412)) {
            r.kept.push(note.path); // it changed in Google since: the next sync merges again
          } else throw asVaultError(e);
        }
      }
    }
    this.remember(latest, note.path, agreed);
  }

  /** A new note for a contact that wasn't here: its details, the link, and Google's notes about them once. */
  private create(name: string, fields: Synced, person: GooglePerson, source: string): string | null {
    const notes = person.biographies?.[0]?.value?.trim();
    try {
      const made = this.vault.createContact({ ...emptyContact(name), ...fields, name, notes }, source);
      const text = this.vault.files.read(made.path) ?? "";
      this.vault.save(made.path, withLink(text, person.resourceName), { source, baseVersion: made.version });
      return made.path;
    } catch (e) {
      if (e instanceof VaultError) return null; // a note by that name that isn't a contact, say
      throw e;
    }
  }

  private unlink(path: string, source: string, r: SyncResult) {
    const before = this.vault.files.read(path);
    if (before === null || !linkOf(before)) return;
    this.vault.save(path, withLink(before, null), { source, baseVersion: this.vault.meta(path)?.version });
    r.unlinked.push(path);
  }

  private remember(person: GooglePerson, path: string, base: Synced) {
    this.db.run(
      `INSERT INTO google_contacts(owner, resource, person, path, base) VALUES (?,?,?,?,?)
       ON CONFLICT(owner, resource) DO UPDATE SET person = excluded.person, path = excluded.path, base = excluded.base`,
      this.owner, person.resourceName, JSON.stringify(person), path, JSON.stringify(base),
    );
  }
}

/** Google's trouble as words a person can act on. */
function asVaultError(e: unknown): Error {
  if (e instanceof VaultError) return e;
  if (e instanceof PeopleError) {
    if (e.status === 401 || e.status === 403) return new VaultError("Google Contacts access was taken back: connect it again from the Contacts page", "forbidden");
    return new VaultError(`Google Contacts: ${e.message}`);
  }
  return new VaultError("Google Contacts couldn't be reached");
}

/** A sync's result in a line or a few, for the CLI, agents and the app's toast. */
export function fmtSync(r: SyncResult): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    r.created.length && `${n(r.created.length, "new contact")}`,
    r.linked.length && `${n(r.linked.length, "note")} linked`,
    r.updated.length && `${n(r.updated.length, "note")} updated`,
    r.pushed.length && `${n(r.pushed.length, "edit")} sent to Google`,
  ].filter(Boolean);
  const lines = [`Synced with ${r.account}: ${parts.length ? parts.join(", ") : "nothing changed"}.`];
  if (r.kept.length) lines.push(`Edits here not sent to Google (allow editing to send them): ${r.kept.join(", ")}`);
  for (const c of r.conflicts) lines.push(`Changed on both sides, Google's kept: ${c.path} ${c.field} "${c.google}" (was "${c.note}" here; see its History)`);
  if (r.unlinked.length) lines.push(`Deleted in Google, notes kept: ${r.unlinked.join(", ")}`);
  if (r.skipped) lines.push(`${n(r.skipped, "contact")} skipped (no name, or a note by that name that isn't a contact)`);
  return lines.join("\n");
}
