// Contacts: the people in the workspace's notes. Each is a note in People/ (see
// src/core/contacts.ts), so a contact's details are its note's frontmatter and its page here is
// what the notes say about them: when they were last mentioned, and where. The list searches and
// filters by tag and company, says who looks like the same person twice (and merges them), and
// imports vCard and CSV exports. Online, members of the workspace with no contact are listed too.
// Online with Google set up, a bar connects Google Contacts and syncs it (src/core/googleContacts.ts):
// Google is the truth for how to reach someone, and the notes stay the workspace's own.
import type { Where } from "./panes.ts";
import { api, ApiError, currentWorkspace, type Contact, type GoogleContactsStatus, type Member, type TimelineItem } from "./api.ts";
import { leave, contactsConnectUrl } from "./calendar/google.ts";
import { avatar, el, icon } from "./dom.ts";
import { emptyState } from "./emptyState.ts";
import { ask } from "./modal.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { memberOf, membersWithoutContact, refreshPeople } from "./people.ts";
import { onVaultChange } from "./events.ts";
import { checkInEvery, describeCheckIn, duplicateContacts, handlesOf, matchContacts, peopleDirectory } from "../../src/core/contacts.ts";
import { mountTasks } from "./tasksView.ts";
import { today } from "./taskChips.ts";

interface Hooks {
  /** Open a note (at a line; `where`: here, in a new tab or in the other pane). */
  open(path: string, line?: number, where?: Where): void;
  /** Tasks with a tag, or one person's tasks (from a task's chips). */
  openTag(tag: string): void;
  openPerson(name: string): void;
  /** A contact's page, or the list: the address bar follows. */
  navigate(contact: Contact | null): void;
  /** Whether this person may change contacts (not a viewer). */
  canEdit(): boolean;
  toast(t: { text: string; icon?: string }): void;
  /** Settings → Integrations, at Google: what's connected, Allow editing, Disconnect. */
  manageGoogle(): void;
}

/** A synced contact's page on Google Contacts (as googleUrl in src/core/googleContacts.ts, which needs Node). */
const googleUrl = (resource: string) => `https://contacts.google.com/person/${resource.replace(/^people\//, "")}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The rhythms the contact page offers; a note can say any other (see checkInEvery). */
const RHYTHMS = ["weekly", "every 2 weeks", "monthly", "every 3 months", "every 6 months", "yearly"];

/** Whether a contact is due a check-in by today. */
export const dueForCheckIn = (c: Contact, day = today()) => !!c.checkInDue && c.checkInDue <= day;

/** A contact's check-in in words: "Every 2 weeks · due since Oct 4", "Every month · next Nov 2". */
export function checkInText(c: Contact, day = today()): string {
  const every = checkInEvery(c.checkIn);
  if (!every || !c.checkInDue) return c.checkIn;
  const words = describeCheckIn(every).replace(/^e/, "E");
  const on = shortDay(c.checkInDue, new Date(`${day}T12:00:00`));
  const when = c.checkInDue < day ? `due since ${on}` : c.checkInDue === day ? "due today" : `next ${on}`;
  return `${words} · ${when}`;
}

/** "Sep 20", or "Sep 20, 2025" for another year. */
export function shortDay(day: string, today = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${y === today.getFullYear() ? "" : `, ${y}`}`;
}

export class ContactsPage {
  readonly root: HTMLElement;
  private contacts: Contact[] = [];
  private members: Member[] = [];
  private shown: Contact | null = null;
  /** The contact page's task list, while it's showing. */
  private unmountTasks = () => {};
  private search = el("input", { placeholder: "Filter people…", spellcheck: "false", autocomplete: "off", "aria-label": "Filter people" });
  private tag = el("select", { class: "ct-select", "aria-label": "Tag" });
  private company = el("select", { class: "ct-select", "aria-label": "Company" });
  private due = el("select", { class: "ct-select", "aria-label": "Check-ins" }, el("option", { value: "" }, "Everyone"), el("option", { value: "due" }, "Due for a check-in"));
  private body = el("div", { class: "ct-body" });
  private loaded = false;
  /** Google Contacts here: null where this server has none (locally, or Google not set up). */
  private google: GoogleContactsStatus | null = null;
  private syncing = false;

  constructor(
    root: HTMLElement,
    private hooks: Hooks,
  ) {
    this.root = root;
    root.append(el("div", { class: "page ct-page" }, this.body));
    this.search.addEventListener("input", () => this.renderList());
    this.tag.addEventListener("change", () => this.renderList());
    this.company.addEventListener("change", () => this.renderList());
    this.due.addEventListener("change", () => this.renderList());
    onVaultChange(() => void this.refresh(), 600); // a new mention, a changed contact
  }

  get visible() {
    return !this.root.hidden;
  }

  /** The list, or one contact's page (by path or note ID). */
  async show(which: string | null = null) {
    this.root.hidden = false;
    await this.load();
    const c = which ? this.contacts.find((x) => x.path === which || x.id === which) ?? null : null;
    if (c) await this.openContact(c, false);
    else {
      this.shown = null;
      this.unmountTasks();
      this.renderList();
      this.search.focus({ preventScroll: true });
    }
  }

  /** The vault changed: fetch again, and redraw what's showing. */
  async refresh() {
    if (!this.visible) return;
    await this.load();
    if (this.shown) {
      const now = this.contacts.find((c) => c.id === this.shown!.id);
      if (now) await this.openContact(now, false);
      else this.hooks.navigate(null);
    } else if (!this.body.contains(document.activeElement) || document.activeElement === this.search) this.renderList();
  }

  private async load() {
    const [contacts, members, google] = await Promise.all([
      api.contacts().catch(() => this.contacts),
      api.members().catch(() => []),
      currentWorkspace() ? api.googleContacts().catch(() => null) : null,
    ]);
    this.contacts = contacts;
    this.members = members;
    this.google = google;
    this.loaded = true;
  }

  /** Back from connecting (/contacts?google=connected|denied|failed; main.ts reads it): say so, and sync straight away. */
  async backFromGoogle(outcome: string) {
    await this.load();
    if (outcome === "connected" && this.google?.connection) await this.syncGoogle();
    else this.hooks.toast({ text: outcome === "denied" ? "Google Contacts wasn't connected: access wasn't allowed" : "Couldn't connect Google Contacts. Try again." });
  }

  /** Leave for Google's consent page (or the stand-in's), coming back here. `write` also asks to edit contacts. */
  private connectGoogle(write: boolean) {
    leave.to(contactsConnectUrl(write));
  }

  private async syncGoogle() {
    if (this.syncing) return;
    this.syncing = true;
    this.renderList();
    try {
      const r = await api.syncGoogleContacts();
      const parts = [
        r.created.length && `${r.created.length} new`,
        r.linked.length && `${r.linked.length} linked`,
        r.updated.length && `${r.updated.length} updated`,
        r.pushed.length && `${r.pushed.length} sent to Google`,
      ].filter(Boolean);
      const extra = [r.conflicts.length && `${r.conflicts.length} changed on both sides (Google's kept)`, r.kept.length && `${r.kept.length} edited here only`].filter(Boolean);
      this.hooks.toast({ text: `Google Contacts: ${parts.length ? parts.join(", ") : "up to date"}${extra.length ? `; ${extra.join(", ")}` : ""}`, icon: "user" });
    } catch (e) {
      this.hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't sync Google Contacts" });
    } finally {
      this.syncing = false;
      await this.load();
      if (!this.shown) this.renderList();
    }
  }

  /** The list's Google Contacts bar: connect, or who's synced, when, and Sync. */
  private googleBar(canEdit: boolean): HTMLElement | string {
    const g = this.google;
    if (!g || !canEdit) return "";
    if (!g.connection) {
      return el(
        "div",
        { class: "ct-google", role: "region", "aria-label": "Google Contacts" },
        icon("user", 15),
        el("span", {}, el("b", {}, "Google Contacts"), " as the source of truth: each contact becomes a note here, for your notes about them. Everyone in this workspace sees People/."),
        el("button", { type: "button", class: "qw-btn", onclick: () => this.connectGoogle(false) }, "Connect"),
      );
    }
    const when = g.lastSync ? `synced ${new Date(g.lastSync).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "not synced yet";
    return el(
      "div",
      { class: "ct-google", role: "region", "aria-label": "Google Contacts" },
      icon("user", 15),
      el(
        "span",
        {},
        el("b", {}, "Google Contacts"),
        ` · ${g.connection.account}`,
        el("br", {}),
        el("span", { class: "ct-google-sub" }, `${g.linked} linked, ${when}. ${g.connection.canWrite ? "Edits here go back to Google." : "Read only: edits here stay here."}`),
      ),
      el("button", { type: "button", class: "qw-btn", title: "Allow editing, or disconnect", onclick: () => this.hooks.manageGoogle() }, icon("gear", 14), "Manage"),
      el("button", { type: "button", class: "qw-btn", disabled: this.syncing, onclick: () => void this.syncGoogle() }, icon("refresh", 14), this.syncing ? "Syncing…" : "Sync now"),
    );
  }

  // ---------------------------------------------------------------- the list

  private renderList() {
    if (!this.loaded) return;
    const canEdit = this.hooks.canEdit();
    const head = el(
      "header",
      { class: "page-head ct-head" },
      el("div", {}, el("h1", {}, "Contacts"), el("p", { class: "page-sub" }, "The people in your notes. Each is a note in People/; type @ in a note to mention one.")),
      canEdit
        ? el(
            "div",
            { class: "ct-actions" },
            el("button", { type: "button", class: "qw-btn", title: "Add people from a vCard (.vcf) or CSV file: Apple, Outlook or a Google Contacts export", onclick: () => this.importFile() }, icon("upload", 14), "Import file…"),
            el("button", { type: "button", class: "qw-btn primary", onclick: () => void this.newContact() }, icon("plus", 14), "New contact"),
          )
        : null,
    );
    this.fillSelect(this.tag, "All tags", [...new Set(this.contacts.flatMap((c) => c.tags.map((t) => t.toLowerCase())))].sort(), (t) => `#${t}`);
    this.fillSelect(this.company, "All companies", [...new Set(this.contacts.map((c) => c.company).filter(Boolean))].sort((a, b) => a.localeCompare(b)), (c) => c);
    const q = this.search.value.trim();
    // The check-in filter shows once someone has a rhythm.
    this.due.hidden = !this.contacts.some((c) => c.checkInDue);
    if (this.due.hidden) this.due.value = "";
    let list = matchContacts(this.contacts, { tag: this.tag.value || undefined, company: this.company.value || undefined });
    if (this.due.value) list = list.filter((c) => dueForCheckIn(c)).sort((a, b) => a.checkInDue!.localeCompare(b.checkInDue!));
    if (q) {
      // Words anywhere, or a fuzzy match on the name (so "jdoe" finds Jane Doe).
      const words = matchContacts(list, { q });
      const fuzzy = list.filter((c) => !words.includes(c) && Math.max(fuzzyScore(q, c.name), ...c.aliases.map((a) => fuzzyScore(q, a))) >= 0);
      list = [...words, ...fuzzy];
    }
    const filtering = !!(q || this.tag.value || this.company.value || this.due.value);
    const dupes = canEdit && !filtering ? duplicateContacts(this.contacts) : [];
    const loose = membersWithoutContact(this.contacts, this.members);

    const rows = list.length
      ? el("div", { class: "ct-list", role: "list" }, ...list.map((c) => this.row(c)))
      : filtering
        ? el("div", { class: "feed-empty" }, this.due.value && !q && !this.tag.value && !this.company.value ? "No one is due a check-in." : "No one matches.")
        : emptyState({
            icon: "user",
            title: "No contacts yet",
            text: ["A contact is a note in People/ with their email, company and role. Type @ and a name in any note to make one, or import a vCard or CSV file."],
            action: canEdit ? { label: "New contact", icon: "plus", run: () => void this.newContact() } : null,
          });

    this.body.replaceChildren(
      head,
      el("div", { class: "ct-filters" }, el("label", { class: "feed-search ct-search" }, icon("search", 16), this.search), this.tag, this.company, this.due),
      this.googleBar(canEdit),
      ...dupes.map((g) => this.dupeBanner(g)),
      rows,
      loose.length && !filtering ? this.membersBlock(loose, canEdit) : "",
    );
  }

  private fillSelect(select: HTMLSelectElement, all: string, values: string[], label: (v: string) => string) {
    const had = select.value;
    select.replaceChildren(el("option", { value: "" }, all), ...values.map((v) => el("option", { value: v }, label(v))));
    select.value = values.includes(had) ? had : "";
    select.hidden = !values.length;
  }

  private row(c: Contact): HTMLElement {
    const member = memberOf(c, this.members);
    const who = [c.role, c.company].filter(Boolean).join(", ");
    return el(
      "button",
      { type: "button", class: "ct-row", role: "listitem", "data-path": c.path, onclick: () => void this.openContact(c) },
      avatar(c.name, 30),
      el(
        "span",
        { class: "ct-main" },
        el(
          "span",
          { class: "ct-name" },
          c.name,
          member ? el("span", { class: "ct-badge", title: `${member.name} has an account in this workspace` }, member.you ? "You" : "Member") : null,
          dueForCheckIn(c) ? el("span", { class: "ct-badge is-due", title: checkInText(c) }, "Check in") : null,
        ),
        el("span", { class: "ct-who" }, [who, c.email[0]].filter(Boolean).join(" · ") || " "),
      ),
      el("span", { class: "ct-tags" }, ...c.tags.slice(0, 3).map((t) => el("span", { class: "tag" }, `#${t}`))),
      el(
        "span",
        { class: "ct-seen", title: c.lastContacted ? `Last mentioned ${c.lastContacted}, in ${c.mentions} note${c.mentions === 1 ? "" : "s"}` : "Not mentioned in a note yet" },
        c.lastContacted ? shortDay(c.lastContacted) : "—",
      ),
    );
  }

  private dupeBanner(group: Contact[]): HTMLElement {
    // Keep the one more notes mention, then the one that knows more about them.
    const known = (c: Contact) => c.mentions * 100 + [c.company, c.role].filter(Boolean).length + c.email.length + c.phone.length + c.links.length + c.tags.length;
    const [keep, ...rest] = [...group].sort((a, b) => known(b) - known(a));
    const names = group.map((c) => c.name);
    const why = group.some((c) => c.email.some((e) => group.some((o) => o !== c && o.email.some((x) => x.toLowerCase() === e.toLowerCase())))) ? "the same email" : "the same name";
    return el(
      "div",
      { class: "ct-dupe", role: "status" },
      icon("user", 15),
      el("span", {}, el("b", {}, names.slice(0, -1).join(", "), " and ", names.at(-1)), ` have ${why}. One person?`),
      el("button", { type: "button", class: "qw-btn", onclick: () => void this.merge(keep, rest) }, `Merge into ${keep.name}`),
    );
  }

  private membersBlock(members: Member[], canEdit: boolean): HTMLElement {
    return el(
      "section",
      { class: "ct-members" },
      el("h2", {}, "In this workspace, without a contact"),
      ...members.map((m) =>
        el(
          "div",
          { class: "ct-member" },
          avatar(m.name, 24),
          el("span", { class: "ct-name" }, m.name, m.you ? el("span", { class: "ct-badge" }, "You") : null),
          el("span", { class: "ct-who" }, m.email),
          canEdit ? el("button", { type: "button", class: "qw-btn", onclick: () => void this.create({ name: m.name, email: [m.email] }) }, "Add as contact") : null,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- one contact

  private async openContact(c: Contact, push = true) {
    const r = await api.contact(c.path).catch((e) => (this.hooks.toast({ text: e instanceof Error ? e.message : "Couldn't open that contact" }), null));
    if (!r) return;
    this.shown = r.contact;
    if (push) this.hooks.navigate(r.contact);
    this.renderContact(r.contact, r.timeline);
  }

  private renderContact(c: Contact, timeline: TimelineItem[]) {
    this.unmountTasks();
    const member = memberOf(c, this.members);
    // Their tasks: every @name that's theirs (the server finds them all from one).
    const handle = peopleDirectory(this.contacts, this.members).find((p) => p.contact === c.path)?.handle ?? handlesOf(c)[0];
    const tasksHost = el("div", { class: "ct-tasks" });
    const canEdit = this.hooks.canEdit();
    const field = (label: string, values: Array<Node | string>) => (values.length ? [el("dt", {}, label), el("dd", {}, ...values)] : []);
    const join = (nodes: Node[]) => (nodes.length ? [el("span", {}, ...nodes.flatMap((n, i) => (i ? [", ", n] : [n])))] : []);
    const link = (href: string, text: string) => el("a", { href, target: href.startsWith("http") ? "_blank" : undefined, rel: "noopener" }, text);
    const details = el(
      "dl",
      { class: "ct-fields" },
      ...field("Email", join(c.email.map((e) => link(`mailto:${e}`, e)))),
      ...field("Phone", join(c.phone.map((p) => link(`tel:${p.replace(/[^\d+]/g, "")}`, p)))),
      ...field("Company", c.company ? [c.company] : []),
      ...field("Role", c.role ? [c.role] : []),
      ...field("Links", join(c.links.filter((l) => /^https?:\/\//i.test(l)).map((l) => link(l, l.replace(/^https?:\/\/(www\.)?/i, ""))))),
      ...field("Also", c.aliases.length ? [c.aliases.join(", ")] : []),
      ...field("Tags", c.tags.length ? [el("span", { class: "ct-taglist" }, ...c.tags.map((t) => el("span", { class: "tag" }, `#${t}`)))] : []),
      ...field("Check in", canEdit ? [this.rhythmPicker(c)] : c.checkIn ? [checkInText(c)] : []),
      ...field("Synced", c.google ? [link(googleUrl(c.google), "Google Contacts")] : []),
    );
    const mentions = timeline.filter((t) => t.kind === "note");
    this.body.replaceChildren(
      el("button", { type: "button", class: "ct-back", onclick: () => this.hooks.navigate(null) }, icon("back", 14), "Contacts"),
      el(
        "header",
        { class: "ct-person" },
        avatar(c.name, 56),
        el(
          "div",
          { class: "ct-person-text" },
          el("h1", {}, c.name),
          el("p", { class: "page-sub" }, [[c.role, c.company].filter(Boolean).join(", "), member ? (member.you ? "You, in this workspace" : "Member of this workspace") : ""].filter(Boolean).join(" · ") || "Contact"),
        ),
        el(
          "div",
          { class: "ct-actions" },
          el("button", { type: "button", class: "qw-btn", onclick: () => this.hooks.open(c.path) }, icon("edit", 14), canEdit ? "Edit note" : "Open note"),
          canEdit && this.contacts.length > 1 ? el("button", { type: "button", class: "qw-btn", onclick: () => void this.pickMerge(c) }, icon("user", 14), "Merge…") : null,
          // Synced: their details can be changed in Google too (Edit note changes them here).
          c.google ? el("a", { class: "qw-btn", href: googleUrl(c.google), target: "_blank", rel: "noopener" }, icon("open", 14), "Open in Google") : null,
        ),
      ),
      details.childElementCount ? details : el("p", { class: "ct-none" }, canEdit ? "No details yet. Edit the note to add an email, phone, company or role." : "No details yet."),
      handle
        ? el(
            "section",
            { class: "ct-timeline" },
            el("h2", {}, "Tasks", el("span", { class: "ct-handle" }, `@${handle}`)),
            tasksHost,
          )
        : "",
      el(
        "section",
        { class: "ct-timeline" },
        el("h2", {}, "Mentioned in", el("span", { class: "n" }, String(mentions.length))),
        mentions.length
          ? el("ol", { class: "ct-events" }, ...mentions.map((t) => this.event(t)))
          : el("p", { class: "ct-none" }, `No note mentions ${c.name} yet. Type @${c.name.split(" ")[0]} in one.`),
        el("p", { class: "ct-soon" }, "Meetings, email and GitHub activity will show here once they're connected."),
      ),
    );
    this.root.scrollTop = 0;
    if (handle) {
      this.unmountTasks = mountTasks(tasksHost, {
        limit: 20,
        assignee: handle,
        open: this.hooks.open,
        openTag: this.hooks.openTag,
        openPerson: this.hooks.openPerson,
        empty: () => el("p", { class: "ct-none" }, `No tasks for ${c.name.split(" ")[0]} yet. Put @${handle} on a task to give it to them.`),
      });
    }
  }

  /** How often to check in with `c`: a menu of rhythms, and when the next is due. */
  private rhythmPicker(c: Contact): HTMLElement {
    const options = c.checkIn && !RHYTHMS.includes(c.checkIn) ? [...RHYTHMS, c.checkIn] : RHYTHMS;
    const select = el(
      "select",
      { class: "ct-select ct-rhythm", "aria-label": "How often to check in" },
      el("option", { value: "" }, "Not set"),
      ...options.map((r) => {
        const every = checkInEvery(r);
        return el("option", { value: r }, every ? describeCheckIn(every).replace(/^e/, "E") : r);
      }),
    );
    select.value = c.checkIn;
    select.addEventListener("change", async () => {
      try {
        await api.updateContact(c.path, { checkIn: select.value });
        await this.load();
        const now = this.contacts.find((x) => x.id === c.id);
        if (now) await this.openContact(now, false);
      } catch (e) {
        select.value = c.checkIn;
        this.hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't change that" });
      }
    });
    const due = c.checkInDue ? checkInText(c).split(" · ")[1] : "";
    return el("span", { class: "ct-checkin" }, select, due ? el("span", { class: `ct-who${dueForCheckIn(c) ? " is-due" : ""}` }, due) : null);
  }

  private event(t: TimelineItem): HTMLElement {
    const text = t.text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target.split("/").pop()!);
    return el(
      "li",
      {},
      el(
        "button",
        { type: "button", class: "ct-event", onclick: () => this.hooks.open(t.path, t.line), title: `${t.path}, line ${t.line}` },
        el("span", { class: "ct-when" }, shortDay(t.date)),
        el("span", { class: "ct-event-text" }, el("b", {}, t.title), el("span", {}, text)),
      ),
    );
  }

  // ---------------------------------------------------------------- changes

  /** Ask for a name (and an email and company), add the contact, and open its page. */
  async newContact() {
    const name = el("input", { placeholder: "Name", "aria-label": "Name", autocomplete: "off" });
    const email = el("input", { placeholder: "Email (optional)", "aria-label": "Email", type: "email", autocomplete: "off" });
    const company = el("input", { placeholder: "Company (optional)", "aria-label": "Company", autocomplete: "off" });
    const form = el("div", { class: "ct-form" }, name, email, company);
    // Enter in any field is the Add button.
    form.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), form.closest(".ask-box")?.querySelector<HTMLButtonElement>(".qw-btn.primary")?.click()));
    const ok = await ask({ title: "New contact", body: [form], actions: [{ label: "Add", value: "add", kind: "primary" }], focus: name });
    if (!ok || !name.value.trim()) return;
    await this.create({ name: name.value, email: email.value.trim() ? [email.value.trim()] : [], company: company.value.trim() });
  }

  private async create(c: { name: string; email?: string[]; company?: string }) {
    try {
      const r = await api.createContact(c);
      refreshPeople();
      await this.load();
      const made = this.contacts.find((x) => x.path === r.path);
      if (made) await this.openContact(made);
    } catch (e) {
      this.hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't add that contact" });
    }
  }

  /** Pick a .vcf or .csv file and bring its people in. */
  importFile() {
    const input = el("input", { type: "file", accept: ".vcf,.vcard,.csv,text/vcard,text/csv" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const format = /\.csv$/i.test(file.name) || file.type === "text/csv" ? "csv" : "vcard";
      try {
        const r = await api.importContacts(format, await file.text());
        refreshPeople();
        await this.load();
        this.renderList();
        const parts = [r.created.length && `${r.created.length} new`, r.updated.length && `${r.updated.length} updated`, r.unchanged.length && `${r.unchanged.length} already here`].filter(Boolean);
        this.hooks.toast({ icon: "user", text: parts.length ? `Imported ${file.name}: ${parts.join(", ")}` : `No contacts in ${file.name}` });
      } catch (e) {
        this.hooks.toast({ text: e instanceof ApiError ? e.message : `Couldn't import ${file.name}` });
      }
    });
    input.click();
  }

  /** Pick who else `c` is, then merge them into `c`. */
  private async pickMerge(c: Contact) {
    const others = this.contacts.filter((o) => o.id !== c.id);
    const filter = el("input", { placeholder: "Who else is this?", "aria-label": "Find a contact", autocomplete: "off" });
    const list = el("div", { class: "ct-pick", role: "listbox" });
    let picked: Contact | null = null;
    const draw = () => {
      const q = filter.value.trim();
      const hits = (q ? others.filter((o) => Math.max(fuzzyScore(q, o.name), ...o.email.map((e) => fuzzyScore(q, e))) >= 0) : others).slice(0, 8);
      list.replaceChildren(
        ...hits.map((o) =>
          el(
            "button",
            { type: "button", class: `ct-pick-item${picked === o ? " is-on" : ""}`, role: "option", "aria-selected": String(picked === o), onclick: () => ((picked = o), draw()) },
            avatar(o.name, 20),
            el("span", {}, o.name),
            el("span", { class: "ct-who" }, o.email[0] ?? o.company),
          ),
        ),
      );
    };
    filter.addEventListener("input", () => ((picked = null), draw()));
    draw();
    const ok = await ask({
      focus: filter,
      title: `Merge into ${c.name}`,
      body: [filter, list, `${c.name} keeps their note and gains the other's emails, phones, links, tags and notes. Links to the other point at ${c.name}, and their note goes to Trash.`],
      actions: [{ label: "Merge", value: "merge", kind: "primary" }],
    });
    if (ok && picked) await this.merge(c, [picked]);
  }

  private async merge(keep: Contact, drop: Contact[]) {
    try {
      let relinked = 0;
      for (const d of drop) relinked += (await api.mergeContacts(keep.path, d.path)).updated.length;
      refreshPeople();
      await this.load();
      this.hooks.toast({ icon: "user", text: `Merged ${drop.map((d) => d.name).join(" and ")} into ${keep.name}${relinked ? `; links updated in ${relinked} note${relinked === 1 ? "" : "s"}` : ""}. The other note is in Trash.` });
      const now = this.contacts.find((c) => c.id === keep.id);
      if (now && this.shown) await this.openContact(now, false);
      else this.renderList();
    } catch (e) {
      this.hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't merge them" });
    }
  }
}
