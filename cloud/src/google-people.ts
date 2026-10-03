// Google Contacts through the People API (https://developers.google.com/people/api/rest), for
// src/core/googleContacts.ts: the person's contacts, incrementally with sync tokens, and edits made
// here written back to them. Where Google isn't configured (Previews, local development), MockPeople
// stands in: demo contacts kept in D1 per person, so a sync and a push can be tried end to end, and
// /auth/google/contacts/mock edits them "in Google". No Workers imports beyond D1's types.
import { PeopleError, PERSON_FIELDS, type GooglePerson, type PeopleApi } from "../../src/core/googleContacts.ts";

export const PEOPLE_API = "https://people.googleapis.com/v1";

/** A token error from connections.ts ("feed:…") as Google refusing: the person must connect again. */
async function tokenOf(token: () => Promise<string>): Promise<string> {
  try {
    return await token();
  } catch (e) {
    throw new PeopleError((e as Error).message.replace(/^feed:/, "").replace("Google Calendar", "Google"), 401);
  }
}

export class PeopleClient implements PeopleApi {
  constructor(
    private token: () => Promise<string>,
    private api = PEOPLE_API,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetcher(`${this.api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await tokenOf(this.token)}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    if (!res.ok) {
      const message = data.error?.message ?? `Google answered ${res.status}`;
      // An expired sync token is a 400 FAILED_PRECONDITION that says so: start again, as Calendar's 410.
      if (res.status === 400 && /sync token/i.test(message)) throw new PeopleError(message, 410);
      throw new PeopleError(message, res.status);
    }
    return data as T;
  }

  async changes(syncToken: string | null) {
    const people: GooglePerson[] = [];
    let page: string | undefined;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: "1000", requestSyncToken: "true" });
      if (syncToken) q.set("syncToken", syncToken);
      if (page) q.set("pageToken", page);
      const r = await this.call<{ connections?: GooglePerson[]; nextPageToken?: string; nextSyncToken?: string }>(`/people/me/connections?${q}`);
      people.push(...(r.connections ?? []));
      page = r.nextPageToken;
      if (!page) {
        if (!r.nextSyncToken) break;
        return { people, syncToken: r.nextSyncToken, full: !syncToken };
      }
    }
    throw new PeopleError("Google didn't finish listing your contacts", 502);
  }

  update(person: GooglePerson, fields: string) {
    const q = new URLSearchParams({ updatePersonFields: fields, personFields: PERSON_FIELDS });
    const body = { resourceName: person.resourceName, etag: person.etag, emailAddresses: person.emailAddresses, phoneNumbers: person.phoneNumbers, organizations: person.organizations, urls: person.urls, nicknames: person.nicknames };
    return this.call<GooglePerson>(`/${person.resourceName}:updateContact?${q}`, { method: "PATCH", body: JSON.stringify(body) });
  }
}

// ------------------------------------------------------------------ the stand-in

/** The stand-in's address book. Jane, Priya and Omar overlap the Contacts demo (examples/preview/contacts). */
export const DEMO_PEOPLE: GooglePerson[] = [
  {
    resourceName: "people/c1001",
    names: [{ displayName: "Jane Doe" }],
    emailAddresses: [{ value: "jane@acme.example", type: "work" }],
    phoneNumbers: [{ value: "+1 555 0100", type: "mobile" }, { value: "+1 555 0142", type: "work" }],
    organizations: [{ name: "Acme", title: "Chief Technology Officer" }],
    urls: [{ value: "https://github.com/janedoe" }],
  },
  {
    resourceName: "people/c1002",
    names: [{ displayName: "Priya Shah" }],
    emailAddresses: [{ value: "priya@initech.example", type: "work" }, { value: "priya.shah@gmail.example", type: "home" }],
    organizations: [{ name: "Initech", title: "VP Engineering" }],
    nicknames: [{ value: "Priya" }],
  },
  {
    resourceName: "people/c1003",
    names: [{ displayName: "Lena Fischer" }],
    emailAddresses: [{ value: "lena@globex.example" }],
    phoneNumbers: [{ value: "+49 30 555 0123", type: "mobile" }],
    organizations: [{ name: "Globex", title: "Head of Partnerships" }],
    biographies: [{ value: "Met at the Berlin meetup. Interested in the team plan.", contentType: "TEXT_PLAIN" }],
  },
  {
    resourceName: "people/c1004",
    names: [{ displayName: "Marcus Webb" }],
    emailAddresses: [{ value: "marcus@webb.example" }],
    urls: [{ value: "https://marcuswebb.example" }],
  },
  {
    resourceName: "people/c1005",
    names: [{ displayName: "Sofia Rossi" }],
    emailAddresses: [{ value: "sofia@initech.example" }],
    organizations: [{ name: "Initech", title: "Product Manager" }],
  },
];

interface MockRow {
  resource: string;
  data: string;
  version: number;
  deleted: number;
}

/**
 * Google Contacts' stand-in: each person's address book in D1, seeded with DEMO_PEOPLE the first
 * time. Every change has a version; a sync token is the version it saw ("mock:7"), and an etag the
 * person's version ("e7"), so a push made against an old etag is refused as Google would.
 */
export class MockPeople implements PeopleApi {
  constructor(
    private db: D1Database,
    private user: string,
    private token: () => Promise<string> = async () => "",
  ) {}

  private async rows(): Promise<MockRow[]> {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS google_mock_people(user_id TEXT NOT NULL, resource TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, resource))").run();
    let { results } = await this.db.prepare("SELECT resource, data, version, deleted FROM google_mock_people WHERE user_id = ? ORDER BY resource").bind(this.user).all<MockRow>();
    if (!results.length) {
      await this.db.batch(DEMO_PEOPLE.map((p) => this.db.prepare("INSERT OR IGNORE INTO google_mock_people(user_id, resource, data, version) VALUES (?,?,?,1)").bind(this.user, p.resourceName, JSON.stringify(p))));
      ({ results } = await this.db.prepare("SELECT resource, data, version, deleted FROM google_mock_people WHERE user_id = ? ORDER BY resource").bind(this.user).all<MockRow>());
    }
    return results;
  }

  private person(r: MockRow): GooglePerson {
    return { ...(JSON.parse(r.data) as GooglePerson), resourceName: r.resource, etag: `e${r.version}`, ...(r.deleted ? { metadata: { deleted: true } } : {}) };
  }

  /** Every contact as it stands, deleted ones too (for the stand-in's own page). */
  async all(): Promise<GooglePerson[]> {
    return (await this.rows()).map((r) => this.person(r));
  }

  async changes(syncToken: string | null) {
    await tokenOf(this.token);
    const rows = await this.rows();
    const version = rows.reduce((n, r) => Math.max(n, r.version), 0);
    const since = syncToken?.match(/^mock:(\d+)$/) ? Number(syncToken.slice(5)) : null;
    if (syncToken && since === null) throw new PeopleError("Sync token is expired", 410);
    const people = rows.filter((r) => (since === null ? !r.deleted : r.version > since)).map((r) => this.person(r));
    return { people, syncToken: `mock:${version}`, full: since === null };
  }

  /** Change a contact "in Google": the fields given replace its own (null deletes it). */
  async edit(resource: string, fields: Partial<GooglePerson> | null) {
    const rows = await this.rows();
    const had = rows.find((r) => r.resource === resource);
    const version = rows.reduce((n, r) => Math.max(n, r.version), 0) + 1;
    const data = JSON.stringify({ ...(had ? JSON.parse(had.data) : { resourceName: resource }), ...(fields ?? {}) });
    await this.db
      .prepare("INSERT INTO google_mock_people(user_id, resource, data, version, deleted) VALUES (?,?,?,?,?) ON CONFLICT(user_id, resource) DO UPDATE SET data = excluded.data, version = excluded.version, deleted = excluded.deleted")
      .bind(this.user, resource, data, version, fields === null ? 1 : 0)
      .run();
  }

  async update(person: GooglePerson, fields: string) {
    await tokenOf(this.token);
    const had = (await this.rows()).find((r) => r.resource === person.resourceName && !r.deleted);
    if (!had) throw new PeopleError("Requested entity was not found.", 404);
    if (person.etag !== `e${had.version}`) throw new PeopleError("Request person.etag is different than the current person.etag. Clear local cache and get the latest person.", 400);
    const patch = Object.fromEntries(fields.split(",").map((f) => [f, (person as unknown as Record<string, unknown>)[f] ?? []]));
    await this.edit(person.resourceName, patch);
    return this.person((await this.rows()).find((r) => r.resource === person.resourceName)!);
  }
}
