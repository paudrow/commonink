// Choosing a template and answering its questions: the picker (type to filter, arrows and Enter,
// and ? for the help on every template option) and the {{ask:…}} form, whose fields follow each
// question's type: text, a people picker, a date picker, or a menu of choices. Making the note or
// inserting the text is the caller's (see main.ts and editor/complete.ts). Also the name prompt of
// Rename note, which uses the same dialog.
import type { Contact, Member } from "./api.ts";
import { contactLink, people } from "./people.ts";
import { peopleDirectory } from "../../src/core/contacts.ts";
import { el, icon } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { fillTemplate, handlesFor, localNow, type Ask, type PersonPick, type TemplateInfo } from "../../src/core/templates.ts";

/** A modal on the page; `close` takes it away. Escape or a click outside is `cancel`. */
function modal(title: string, children: HTMLElement[], cancel: () => void, head?: HTMLElement) {
  const box = el("div", { class: "ask-box tpl-box", role: "dialog", "aria-modal": "true", "aria-label": title }, el("div", { class: "tpl-head" }, el("h2", {}, title), head ?? null), ...children);
  const overlay = el("div", { class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && close(true) }, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };
  const close = (cancelled = false) => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (cancelled) cancel();
  };
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  return { box, close };
}

/** The help on every template option (docs/templates.md), loaded when it's asked for. */
export const openTemplateHelp = () => void import("./templateHelp.ts").then((m) => m.showTemplateHelp());

/** Pick one of `templates`; null if called off. `help` is what the ? button does. */
export function pickTemplate(templates: TemplateInfo[], title: string, opts: { help?: () => void } = {}): Promise<TemplateInfo | null> {
  return new Promise((resolve) => {
    const filter = el("input", { placeholder: "Find a template…", "aria-label": "Find a template", autocomplete: "off", spellcheck: "false" });
    const list = el("div", { class: "tpl-list", role: "listbox", "aria-label": "Templates" });
    let shown: TemplateInfo[] = [];
    let active = 0;
    const pick = (t: TemplateInfo) => (m.close(), resolve(t));
    const draw = () => {
      const q = filter.value.trim();
      shown = q ? templates.map((t) => ({ t, s: fuzzyScore(q, t.name) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.t) : templates;
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((t, i) =>
              el(
                "button",
                { type: "button", class: `tpl-item${i === active ? " is-active" : ""}`, role: "option", "aria-selected": String(i === active), onmousedown: (e: Event) => e.preventDefault(), onclick: () => pick(t) },
                icon("file", 15),
                el("b", {}, t.name),
                el("span", { class: "tpl-hint" }, [t.asks.length ? `asks ${t.asks.map((a) => a.label).join(", ")}` : "", t.appliesTo.length ? `for ${t.appliesTo.map((f) => `${f}/`).join(", ")}` : ""].filter(Boolean).join(" · ")),
              ),
            )
          : [el("p", { class: "tpl-none" }, templates.length ? "No template matches." : "No templates yet. A template is any note in Templates/; ? says how to write one.")]),
      );
    };
    filter.addEventListener("input", () => ((active = 0), draw()));
    filter.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (shown.length) active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        draw();
      } else if (e.key === "Enter" && shown[active]) {
        e.preventDefault();
        pick(shown[active]);
      }
    });
    const help = el("button", { type: "button", class: "icon-btn small tpl-help", title: "Every template option: placeholders, questions, frontmatter", "aria-label": "Help on templates", onclick: () => (opts.help ?? openTemplateHelp)() }, "?");
    const m = modal(title, [filter, list], () => resolve(null), help);
    draw();
    filter.focus();
  });
}

/** Ask for a new name, starting from `name`. Null if called off or left as it was. */
export function askName(title: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el("input", { name: "name", value: name, autocomplete: "off", spellcheck: "false", "aria-label": "Name" });
    const form = el("form", { class: "tpl-form" }, el("label", {}, el("span", {}, "Name"), input));
    const submit = () => {
      m.close();
      const typed = input.value.trim();
      resolve(typed && typed !== name ? typed : null);
    };
    form.addEventListener("submit", (e) => (e.preventDefault(), submit()));
    const actions = el(
      "div",
      { class: "ask-actions" },
      el("button", { type: "button", class: "qw-btn", onclick: () => (m.close(), resolve(null)) }, "Cancel"),
      el("button", { type: "button", class: "qw-btn primary", onclick: submit }, "Rename"),
    );
    const m = modal(title, [form, actions], () => resolve(null));
    input.focus();
    input.select();
  });
}

/** Someone a `people` question can offer: a workspace member, or a contact (with the link a note uses). */
export interface Offer {
  name: string;
  /** The @handle a task line gives them (the directory's, see peopleDirectory); someone new gets one from their name. */
  handle?: string;
  link?: string;
}

/**
 * A people question's field: chips for who's picked, and an input that suggests `people` (type to
 * find, arrows and Enter to pick; a name no one has is someone new). Backspace on an empty input
 * takes the last one off.
 */
function peopleField(a: Ask, people: Offer[]) {
  const picked: Offer[] = [];
  const chips = el("span", { class: "tpl-chips" });
  const input = el("input", { name: a.label, "aria-label": a.label, placeholder: a.fallback || "Type a name…", autocomplete: "off", spellcheck: "false" });
  const menu = el("div", { class: "tpl-people", role: "listbox", "aria-label": `${a.label}: suggestions` });
  let options: Array<{ offer: Offer; isNew: boolean }> = [];
  let active = 0;
  /** Someone's @handle: their own, or for someone new one that names only them among everyone offered and picked ("Sam-Lee" when there are two Sams). */
  const handleOf = (o: Offer) => {
    if (o.handle) return o.handle;
    const all = [...new Set([...people, ...picked, o].map((p) => p.name))];
    return handlesFor(all)[all.indexOf(o.name)];
  };
  const drawChips = () =>
    chips.replaceChildren(
      ...picked.map((p, i) =>
        el("span", { class: "tpl-chip" }, p.name, el("button", { type: "button", "aria-label": `Remove ${p.name}`, onclick: () => (picked.splice(i, 1), drawChips(), input.focus()) }, "×")),
      ),
    );
  const drawMenu = () => {
    const q = input.value.trim();
    const free = people.filter((p) => !picked.some((x) => x.name === p.name));
    const hits = q ? free.map((p) => ({ p, s: fuzzyScore(q, p.name) })).filter((x) => x.s >= 0).sort((x, y) => y.s - x.s).map((x) => x.p) : [];
    const exact = [...people, ...picked].some((p) => p.name.toLowerCase() === q.toLowerCase());
    options = [...hits.slice(0, 6).map((offer) => ({ offer, isNew: false })), ...(q && !exact ? [{ offer: { name: q }, isNew: true }] : [])];
    active = Math.min(active, Math.max(0, options.length - 1));
    menu.hidden = !options.length;
    menu.replaceChildren(
      ...options.map((o, i) =>
        el(
          "button",
          { type: "button", class: `tpl-people-opt${i === active ? " is-active" : ""}`, role: "option", "aria-selected": String(i === active), onmousedown: (e: Event) => e.preventDefault(), onclick: () => take(o.offer) },
          o.isNew ? `Add “${o.offer.name}”` : o.offer.name,
          el("span", { class: "tpl-hint" }, o.isNew ? "new" : `@${handleOf(o.offer)}`),
        ),
      ),
    );
  };
  const take = (o: Offer) => {
    picked.push(o);
    input.value = "";
    active = 0;
    drawChips();
    drawMenu();
    input.focus();
  };
  input.addEventListener("input", () => ((active = 0), drawMenu()));
  input.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      drawMenu();
    } else if (e.key === "Enter" && options[active]) {
      e.preventDefault();
      e.stopPropagation(); // picking someone, not making the note
      take(options[active].offer);
    } else if (e.key === "Backspace" && !input.value && picked.length) {
      picked.pop();
      drawChips();
    }
  });
  drawMenu();
  const field = el("label", {}, el("span", {}, a.label), el("div", { class: "tpl-people-box" }, chips, input), menu);
  const value = (): PersonPick[] => picked.map((p) => ({ name: p.name, handle: handleOf(p), ...(p.link ? { link: p.link } : {}) }));
  return { field, input, value };
}

/** The people `@` knows (contacts and members, one each), with their @handle and, for a contact, the link to their note. */
export function peopleOffers(contacts: Contact[], members: Member[]): Offer[] {
  return peopleDirectory(contacts, members).map((p) => ({ name: p.name, handle: p.handle, ...(p.contact ? { link: contactLink(p.contact) } : {}) }));
}

/** Who a template's people questions offer: contacts, and online the workspace's members (see peopleOffers). */
export async function templatePeople(t: TemplateInfo): Promise<Offer[]> {
  if (!t.asks.some((a) => a.type === "people")) return [];
  const { contacts, members } = await people();
  return peopleOffers(contacts, members);
}

/** The form's answers: text answers by label, and the people picked for `people` questions. */
export interface Answers {
  title?: string;
  answers: Record<string, string>;
  picks: Record<string, PersonPick[]>;
}

/**
 * Ask a template's questions (and the new note's title, with `title`), before it's filled in, each
 * with the field its type calls for; `people` is who a people question offers. A blank answer is
 * left out, so the template's default fills it or the placeholder stays to fill in later. A
 * template with nothing to ask resolves at once. Null if called off.
 */
export function askFor(t: TemplateInfo, opts: { title: boolean; people?: Offer[] }): Promise<Answers | null> {
  if (!t.asks.length && !opts.title) return Promise.resolve({ title: undefined, answers: {}, picks: {} });
  return new Promise((resolve) => {
    const text = (name: string, label: string, placeholder: string, type = "text") =>
      el("label", {}, el("span", {}, label), el("input", { name, type, placeholder, autocomplete: "off", "aria-label": label }));
    // Left blank, the title comes from the template: shown as it'll read, each answer by its label.
    const labels = Object.fromEntries(t.asks.map((a) => [a.label, `‹${a.label}›`]));
    const fromTemplate = t.title ? fillTemplate(t.title, { at: localNow(), answers: labels }).text : t.name;
    const titleField = opts.title ? text("__title", "Title", `Blank for “${fromTemplate}”`) : null;
    const pickers = new Map<string, ReturnType<typeof peopleField>>();
    const fields = t.asks.map((a) => {
      if (a.type === "people") {
        const p = peopleField(a, opts.people ?? []);
        pickers.set(a.label, p);
        return p.field;
      }
      if (a.type === "date") {
        const f = text(a.label, a.label, a.fallback, "date");
        const input = f.querySelector("input")!;
        input.value = /^\d{4}-\d\d-\d\d$/.test(a.fallback) ? a.fallback : "";
        return f;
      }
      if (a.type === "choice") {
        const select = el("select", { name: a.label, "aria-label": a.label }, el("option", { value: "" }, "—"), ...a.choices.map((c) => el("option", { value: c }, c)));
        select.value = a.choices.includes(a.fallback) ? a.fallback : "";
        return el("label", {}, el("span", {}, a.label), select);
      }
      return text(a.label, a.label, a.fallback);
    });
    const form = el("form", { class: "tpl-form" }, ...(titleField ? [titleField] : []), ...fields);
    const submit = () => {
      m.close();
      const value = (name: string) => ([...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].find((i) => i.name === name)?.value ?? "").trim();
      const answers = Object.fromEntries(t.asks.filter((a) => a.type !== "people").map((a) => [a.label, value(a.label)]).filter(([, v]) => v));
      const picks = Object.fromEntries([...pickers].map(([label, p]) => [label, p.value()]).filter(([, v]) => v.length));
      resolve({ title: opts.title ? value("__title") || undefined : undefined, answers, picks });
    };
    form.addEventListener("submit", (e) => (e.preventDefault(), submit()));
    form.addEventListener("keydown", (e) => e.key === "Enter" && !e.defaultPrevented && (e.preventDefault(), submit()));
    const actions = el(
      "div",
      { class: "ask-actions" },
      el("button", { type: "button", class: "qw-btn", onclick: () => (m.close(), resolve(null)) }, "Cancel"),
      el("button", { type: "button", class: "qw-btn primary", onclick: submit }, opts.title ? "Create" : "Insert"),
    );
    const m = modal(t.name, [form, actions], () => resolve(null));
    // The first question has the keyboard; the title can come from the template.
    (form.querySelector<HTMLElement>(fields.length ? "input:not([name='__title']), select" : "input") ?? form.querySelector("input"))?.focus();
  });
}
